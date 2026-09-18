import { NextResponse, type NextRequest } from "next/server";
import { handleError, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { apiError } from "@/lib/types";
import { QuestionSchema, type Question } from "@/lib/types";
import type { AnswerPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/forms/[slug]/resume?token=...
 * Returns the saved draft answers for an unsubmitted response identified by
 * its recovery token. Unlisted in any UI — the token IS the credential.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    rateLimit(req, "resume", 30);
    const { slug } = await ctx.params;
    const token = new URL(req.url).searchParams.get("token");

    if (!token || token.length < 20 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      throw apiError("VALIDATION_ERROR", "Invalid recovery token", 400);
    }

    const supabase = createServiceClient();

    const { data: form } = await supabase
      .from("forms")
      .select("id, is_published")
      .eq("slug", slug)
      .single();

    if (!form || !form.is_published) throw apiError("NOT_FOUND", "Form not found", 404);

    const { data: response } = await supabase
      .from("responses")
      .select("id, form_id, submitted_at, expires_at, respondent_meta")
      .eq("recovery_token", token)
      .single();

    if (!response || response.form_id !== form.id) {
      throw apiError("DRAFT_NOT_FOUND", "No saved draft found for this link", 404);
    }
    if (response.submitted_at) {
      throw apiError("VALIDATION_ERROR", "This response was already submitted", 409);
    }
    if (response.expires_at && new Date(response.expires_at).getTime() < Date.now()) {
      throw apiError("RESPONSE_EXPIRED", "Time limit exceeded", 403);
    }

    const { data: answerRows, error } = await supabase
      .from("answers")
      .select("question_id, answer_text, answer_json")
      .eq("response_id", response.id);

    if (error) throw error;

    // Questions are served fresh (they may have changed since the draft).
    const { data: questionRows } = await supabase
      .from("questions")
      .select("*")
      .eq("form_id", form.id)
      .order("order_index", { ascending: true });

    let questions: Question[] = [];
    try {
      questions = (questionRows ?? []).map((q) => QuestionSchema.parse(q));
    } catch {
      questions = [];
    }

    const validIds = new Set(questions.map((q) => q.id));
    const answers: AnswerPayload[] = (answerRows ?? [])
      .filter((a) => validIds.has(a.question_id))
      .map((a) => ({
        questionId: a.question_id,
        ...(a.answer_text !== null ? { text: a.answer_text } : {}),
        ...(a.answer_json !== null ? { json: a.answer_json } : {}),
      }));

    return NextResponse.json({
      responseId: response.id,
      expiresAt: response.expires_at,
      answers,
    });
  } catch (err) {
    return handleError(err);
  }
}
