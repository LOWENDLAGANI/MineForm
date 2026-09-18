import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleError, parseBody, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { apiError } from "@/lib/types";
import { generateRecoveryToken } from "@/lib/drafts";

export const dynamic = "force-dynamic";

const SaveDraftSchema = z
  .object({
    responseId: z.string().uuid(),
    answers: z
      .array(
        z
          .object({
            questionId: z.string().uuid(),
            text: z.string().max(10000).nullable().optional(),
            json: z.unknown().nullable().optional(),
          })
          .refine((a) => a.text != null || a.json != null, {
            message: "answer must set either text or json",
          }),
      )
      .default([]),
    /** Optional email for the recovery link + confirmation on final submit. */
    email: z.string().email().max(320).nullable().optional(),
  })
  .strict();

/**
 * POST /api/public/forms/[slug]/save-draft
 * Upserts the respondent's in-progress answers on an unsubmitted response
 * and returns a recovery token. No validation beyond shape — drafts are
 * allowed to be partial, that's the entire point.
 *
 * Re-saving with the same responseId refreshes answers; a rotated recovery
 * token is returned each time (previous token keeps working until rotated —
 * acceptable: token theft equals response-theft, and links are single-user).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    rateLimit(req, "save-draft", 60);
    const { slug } = await ctx.params;
    const body = await parseBody(req, SaveDraftSchema);

    const supabase = createServiceClient();

    const { data: form } = await supabase
      .from("forms")
      .select("id, is_published")
      .eq("slug", slug)
      .single();

    if (!form || !form.is_published) {
      throw apiError("NOT_FOUND", "Form not found", 404);
    }

    const { data: response } = await supabase
      .from("responses")
      .select("id, form_id, submitted_at, expires_at, recovery_token")
      .eq("id", body.responseId)
      .single();

    if (!response || response.form_id !== form.id) {
      throw apiError("NOT_FOUND", "Response not found", 404);
    }
    if (response.submitted_at) {
      throw apiError("VALIDATION_ERROR", "Response already submitted", 409);
    }
    if (response.expires_at && new Date(response.expires_at).getTime() < Date.now()) {
      throw apiError("RESPONSE_EXPIRED", "Time limit exceeded", 403);
    }

    // Replace the draft answer set atomically-ish: delete + insert. Drafts
    // are only ever read through the resume endpoint, so a torn state between
    // delete and insert is invisible to respondents.
    const del = await supabase
      .from("answers")
      .delete()
      .eq("response_id", response.id);
    if (del.error) throw del.error;

    if (body.answers.length > 0) {
      const rows = body.answers.map((a) => ({
        response_id: response.id,
        question_id: a.questionId,
        answer_text: a.text ?? null,
        answer_json: (a.json ?? null) as never,
      }));
      const ins = await supabase.from("answers").insert(rows);
      if (ins.error) throw ins.error;
    }

    if (body.email) {
      const upd = await supabase
        .from("responses")
        .update({ respondent_meta: { email: body.email } })
        .eq("id", response.id)
        .is("submitted_at", null);
      if (upd.error) throw upd.error;
    }

    // Rotate the token on every save so an old link can't race a newer draft.
    const token = generateRecoveryToken();

    const upd = await supabase
      .from("responses")
      .update({
        recovery_token: token,
        recovery_token_created_at: new Date().toISOString(),
      })
      .eq("id", response.id)
      .is("submitted_at", null)
      .select("recovery_token")
      .single();

    if (upd.error || !upd.data) {
      throw apiError("VALIDATION_ERROR", "Could not save draft", 400);
    }

    const origin = new URL(req.url).origin;
    return NextResponse.json({
      saved: true,
      recoveryToken: upd.data.recovery_token,
      recoveryUrl: `${origin}/f/${slug}?resume=${upd.data.recovery_token}`,
    });
  } catch (err) {
    return handleError(err);
  }
}
