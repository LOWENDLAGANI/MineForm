import { NextResponse, type NextRequest } from "next/server";
import { handleError, parseBody, rateLimit } from "@/lib/api";
import { evaluateLogic, resolveVisibility, validateAnswers } from "@/lib/logic";
import { createServiceClient } from "@/lib/supabase";
import {
  QuestionSchema,
  SubmitPayloadSchema,
  apiError,
  type AnswerPayload,
  type Question,
} from "@/lib/types";
import { isFormClosed } from "@/lib/close";
import { answerPreview, sendConfirmationEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/forms/[slug]/submit
 *
 * Submission pipeline (all server-side):
 *  1. Rate limit
 *  2. Load form + questions (published only)
 *  3. Verify the response exists, belongs to this form, is unsubmitted,
 *     and is not past its server-stamped expires_at (quiz timer)
 *  4. Verify the response cap and close conditions haven't been hit
 *  5. Recompute conditional logic server-side — hidden questions can't
 *     smuggle answers, required-but-visible questions must be answered
 *  6. Insert answers, stamp submitted_at, return the sealed response
 *  7. Send the respondent a confirmation email when the form opts in
 *
 * If payment_config.required is true, submission is rejected with
 * PAYMENT_REQUIRED until the payments Edge Function webhook marks the
 * response's payment as succeeded (the DB trigger enforces this too).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    rateLimit(req, "submit", 20);
    const { slug } = await ctx.params;
    const body = await parseBody(req, SubmitPayloadSchema);

    const supabase = createServiceClient();

    const { data: form, error: formErr } = await supabase
      .from("forms")
      .select("id, is_published, response_cap, payment_config, close_config, send_confirmation_email, title")
      .eq("slug", slug)
      .single();

    if (formErr || !form) throw apiError("NOT_FOUND", "Form not found", 404);
    if (!form.is_published) {
      throw apiError("FORM_NOT_PUBLISHED", "Form is not accepting responses", 403);
    }

    const { data: questionRows, error: qErr } = await supabase
      .from("questions")
      .select("*")
      .eq("form_id", form.id)
      .order("order_index", { ascending: true });

    if (qErr) throw qErr;
    const questions: Question[] = (questionRows ?? []).map((r) => QuestionSchema.parse(r));

    // -- Load and verify the response row -------------------------------
    const { data: response, error: rErr } = await supabase
      .from("responses")
      .select("id, form_id, started_at, submitted_at, expires_at, respondent_meta")
      .eq("id", body.responseId)
      .single();

    if (rErr || !response) throw apiError("NOT_FOUND", "Response not found", 404);
    if (response.form_id !== form.id) {
      throw apiError("VALIDATION_ERROR", "Response does not belong to this form", 400);
    }
    if (response.submitted_at) {
      throw apiError("VALIDATION_ERROR", "Response already submitted", 409);
    }

    // NOTE on double-submit: the read above is advisory only. The authoritative
    // guard is the atomic UPDATE below (… .is("submitted_at", null)) — whichever
    // request flips the row first wins; the loser's seal matches 0 rows and is
    // rejected, so answers can never be inserted twice.

    // -- Quiz timer (server clock is authoritative) ----------------------
    const now = Date.now();
    if (response.expires_at && new Date(response.expires_at).getTime() < now) {
      throw apiError("RESPONSE_EXPIRED", "Time limit exceeded", 403);
    }

    // -- Response cap ----------------------------------------------------
    if (form.response_cap !== null) {
      const { count } = await supabase
        .from("responses")
        .select("id", { count: "exact", head: true })
        .eq("form_id", form.id)
        .not("submitted_at", "is", null);

      if ((count ?? 0) >= (form.response_cap ?? 0)) {
        throw apiError("RESPONSE_CAP_REACHED", "This form has reached its response limit", 403);
      }
    }

    // -- Close conditions (date / conditional) ---------------------------
    if (await isFormClosed(supabase, form.id, form.close_config)) {
      throw apiError("FORM_CLOSED", "This form is closed", 403);
    }

    // -- Conditional logic + validation (server recomputes everything) ---
    const answers: AnswerPayload[] = body.answers;
    const answersByQuestionId: Record<string, unknown> = {};
    for (const a of answers) {
      answersByQuestionId[a.questionId] = a.text ?? a.json ?? null;
    }

    const visibility = resolveVisibility(questions, answersByQuestionId);
    const issues = validateAnswers(questions, answers, visibility);
    if (issues.length > 0) {
      throw apiError(
        "VALIDATION_ERROR",
        `${issues.length} answer(s) failed validation: ${issues.map((i) => i.message).join("; ")}`,
        422,
      );
    }

    // -- Payment gate ------------------------------------------------------
    const pc = form.payment_config as { required?: boolean } | null;
    if (pc?.required) {
      const { data: payment } = await supabase
        .from("payments")
        .select("status")
        .eq("response_id", response.id)
        .eq("status", "succeeded")
        .limit(1);

      if (!payment || payment.length === 0) {
        throw apiError("PAYMENT_REQUIRED", "Complete payment before submitting", 402);
      }
    }

    // -- Commit -------------------------------------------------------------
    // Seal FIRST, atomically: only one concurrent request can flip
    // submitted_at from null. This is the authoritative double-submit guard.
    const { data: sealed, error: sealErr } = await supabase
      .from("responses")
      .update({ submitted_at: new Date().toISOString() })
      .eq("id", response.id)
      .is("submitted_at", null)
      .select("id, submitted_at, expires_at")
      .single();

    if (sealErr || !sealed) {
      // 0 rows updated => a concurrent request already sealed this response.
      throw apiError("VALIDATION_ERROR", "Response already submitted", 409);
    }

    const rows = answers.map((a) => ({
      response_id: response.id,
      question_id: a.questionId,
      answer_text: a.text ?? null,
      answer_json: a.json ?? null,
    }));

    const { error: aErr } = await supabase.from("answers").insert(rows);
    if (aErr) {
      // Best-effort rollback of the seal so the client can retry cleanly.
      await supabase
        .from("responses")
        .update({ submitted_at: null })
        .eq("id", response.id)
        .eq("submitted_at", sealed.submitted_at);
      throw aErr;
    }

    // Invalidate any draft recovery link — the response is final now.
    await supabase
      .from("responses")
      .update({ recovery_token: null })
      .eq("id", response.id);

    // -- Confirmation email (fire-and-forget; never blocks the response) --
    const meta = (response.respondent_meta ?? {}) as { email?: string };
    const emailQ = questions.find((q) => q.question_type === "email");
    const emailAnswer = emailQ
      ? answers.find((a) => a.questionId === emailQ.id)?.text ?? null
      : null;
    const respondentEmail = meta.email ?? emailAnswer;

    if (form.send_confirmation_email && respondentEmail) {
      const byId = new Map(questions.map((q) => [q.id, q]));
      const entries = answers
        .filter((a) => byId.has(a.questionId))
        .map((a) => ({
          question: byId.get(a.questionId)!.question_text,
          answer: answerPreview(a.text ?? null, a.json ?? null),
        }));

      // Awaited briefly so Vercel keeps the invocation alive, but failures
      // are swallowed — the submission must never fail because of email.
      await sendConfirmationEmail({
        to: respondentEmail,
        formTitle: form.title,
        submittedAt: sealed.submitted_at,
        entries,
      }).catch(() => undefined);
    }

    return NextResponse.json({ response: sealed });
  } catch (err) {
    return handleError(err);
  }
}
