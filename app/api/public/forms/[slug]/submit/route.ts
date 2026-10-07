import { NextResponse, type NextRequest } from "next/server";
import { handleError, parseBody, rateLimit } from "@/lib/api";
import { evaluateLogic, resolveVisibility, validateAnswers } from "@/lib/logic";
import { createServiceClient } from "@/lib/supabase";
import {
  QuestionSchema,
  SubmitPayloadSchema,
  apiError,
  type AnswerPayload,
  type Ending,
  type Question,
} from "@/lib/types";
import { isFormClosed } from "@/lib/close";
import { answerPreview, sendConfirmationEmail, sendOwnerNotificationEmail } from "@/lib/email";
import { checkGeoDevice, isLinkExpired, verifyPassword } from "@/lib/access";
import { computeScore } from "@/lib/scoring";
import { fireIntegrations } from "@/lib/webhooks";
import { pipeText } from "@/lib/piping";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/forms/[slug]/submit
 *
 * Submission pipeline (all server-side):
 *  1. Rate limit
 *  2. Load form + questions (published only)
 *  3. Gates: link expiry, password, country/device allowlist
 *  4. Verify the response exists, belongs to this form, is unsubmitted,
 *     and is not past its server-stamped expires_at (quiz timer)
 *  5. Verify the response cap and close conditions haven't been hit
 *  6. Recompute conditional logic server-side — hidden questions can't
 *     smuggle answers, required-but-visible questions must be answered
 *  7. Insert answers, compute quiz score, pick the matching custom ending,
 *     seal the response
 *  8. Fire integrations: respondent confirmation email, owner notification,
 *     generic webhook, Slack/Discord, Google Sheets (all best-effort)
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    rateLimit(req, "submit", 20);
    const { slug } = await ctx.params;
    const body = await parseBody(req, SubmitPayloadSchema);

    const supabase = createServiceClient();

    const { data: form, error: formErr } = await supabase
      .from("forms")
      .select("*")
      .eq("slug", slug)
      .single();

    if (formErr || !form) throw apiError("NOT_FOUND", "Form not found", 404);
    if (!form.is_published) {
      throw apiError("FORM_NOT_PUBLISHED", "Form is not accepting responses", 403);
    }

    // -- Gates: expiry, password, geo/device -------------------------------
    if (isLinkExpired(form.access_config as Record<string, unknown> | null)) {
      throw apiError("LINK_EXPIRED", "This form link has expired", 403);
    }
    const passwordOk = await verifyPassword(
      form.access_config as Record<string, unknown> | null,
      req.headers.get("x-mineform-password"),
    );
    if (!passwordOk) throw apiError("PASSWORD_REQUIRED", "Wrong password", 401);
    const geo = checkGeoDevice(form.access_config as Record<string, unknown> | null, req.headers);
    if (!geo.ok) throw apiError(geo.code!, geo.message ?? "Not available for you", 403);

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
    // Dedupe by question id: repeated ids would insert duplicate answer rows
    // and inflate every chart + the funnel. Last value wins (matches the
    // client, which keeps a single value per question).
    const dedupedAnswers = new Map<string, AnswerPayload>();
    for (const a of body.answers) dedupedAnswers.set(a.questionId, a);
    const answers: AnswerPayload[] = [...dedupedAnswers.values()];
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

    // -- Quiz score (server-recomputed; client value is ignored) ----------
    const scoring = (form.scoring_config ?? {}) as { enabled?: boolean; show_score?: boolean };
    const score = scoring.enabled === true ? computeScore(questions, answers) : null;

    // -- Custom ending selection -------------------------------------------
    const endingCfg = (form.ending_config ?? {}) as {
      default_message?: string;
      endings?: Ending[];
    };
    let matchedEnding: Ending | null = null;
    for (const ending of endingCfg.endings ?? []) {
      const hit = (ending.conditions ?? []).every((cond) => {
        const value = answersByQuestionId[cond.question_id];
        const asText = (v: unknown): string =>
          Array.isArray(v) ? v.map(String).join(",") : v === null || v === undefined ? "" : String(v);
        return cond.operator === "eq"
          ? asText(value) === cond.value
          : asText(value).includes(cond.value);
      });
      if (hit) {
        matchedEnding = ending;
        break;
      }
    }

    // -- Commit -------------------------------------------------------------
    // Seal FIRST, atomically: only one concurrent request can flip
    // submitted_at from null. This is the authoritative double-submit guard.
    const { data: sealed, error: sealErr } = await supabase
      .from("responses")
      .update({
        submitted_at: new Date().toISOString(),
        score,
        ending_id: matchedEnding?.id ?? null,
      })
      .eq("id", response.id)
      .is("submitted_at", null)
      .select("id, submitted_at, expires_at, score")
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

    // -- Emails + webhooks (fire-and-forget; never block the response) -----
    const meta = (response.respondent_meta ?? {}) as {
      email?: string;
      verified_email?: string;
      hidden?: Record<string, string>;
      country?: string | null;
      device?: string | null;
    };
    const emailQ = questions.find((q) => q.question_type === "email");
    const emailAnswer = emailQ
      ? answers.find((a) => a.questionId === emailQ.id)?.text ?? null
      : null;
    const respondentEmail = meta.verified_email ?? meta.email ?? emailAnswer;

    const byId = new Map(questions.map((q) => [q.id, q]));
    const answerEntries = answers
      .filter((a) => byId.has(a.questionId))
      .map((a) => ({
        question: byId.get(a.questionId)!.question_text,
        answer: answerPreview(a.text ?? null, a.json ?? null),
      }));

    const integrations = (form.integrations ?? {}) as {
      notify_email?: boolean;
      webhook_url?: string | null;
      slack_webhook_url?: string | null;
      sheet_webhook_url?: string | null;
    };

    // Piping context: answers by 1-based position in form order.
    const answersByPosition: Record<number, string> = {};
    questions.forEach((q, i) => {
      const a = answers.find((x) => x.questionId === q.id);
      if (a) answersByPosition[i + 1] = answerPreview(a.text ?? null, a.json ?? null);
    });
    const hiddenFields = meta.hidden ?? {};

    const endingMessage = pipeText(
      matchedEnding?.message ?? endingCfg.default_message ?? "Thanks for your response!",
      answersByPosition,
      hiddenFields,
    );

    const emailJobs: Promise<boolean>[] = [];

    // Respondent confirmation
    if (form.send_confirmation_email && respondentEmail) {
      emailJobs.push(
        sendConfirmationEmail({
          to: respondentEmail,
          formTitle: form.title,
          submittedAt: sealed.submitted_at,
          entries: answerEntries,
        }).catch(() => false),
      );
    }

    // Owner notification
    if (integrations.notify_email) {
      emailJobs.push(
        (async () => {
          try {
            const { data: owner } = await supabase.auth.admin.getUserById(form.user_id);
            if (!owner?.user?.email) return false;
            const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
            return await sendOwnerNotificationEmail({
              to: owner.user.email,
              formTitle: form.title,
              responseUrl: `${origin}/forms/${form.id}/responses`,
              submittedAt: sealed.submitted_at,
              entries: answerEntries,
            });
          } catch {
            return false;
          }
        })(),
      );
    }

    // Awaited briefly so Vercel keeps the invocation alive; failures are
    // swallowed — the submission must never fail because of an integration.
    await Promise.all([
      ...emailJobs.map((p) => p.catch(() => undefined)),
      fireIntegrations(integrations, {
        event: "response.submitted",
        formId: form.id,
        formSlug: slug,
        formTitle: form.title,
        responseId: response.id,
        submittedAt: sealed.submitted_at,
        score,
        locale: null,
        answers: answerEntries,
        meta: {
          country: meta.country ?? null,
          device: meta.device ?? null,
          ...hiddenFields,
        },
      }),
    ]);

    // Echo the stored answers so the client can show respondents a receipt.
    return NextResponse.json({
      response: sealed,
      ending: {
        id: matchedEnding?.id ?? null,
        message: endingMessage,
      },
      score: sealed.score,
      answers: rows.map((r) => ({
        questionId: r.question_id,
        text: r.answer_text,
        json: r.answer_json,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
