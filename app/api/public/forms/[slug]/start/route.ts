import { NextResponse, type NextRequest } from "next/server";
import { handleError, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { apiError } from "@/lib/types";
import { issueRecoveryToken } from "@/lib/drafts";
import { isFormClosed } from "@/lib/close";
import { expectDbOk } from "@/lib/db-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/forms/[slug]/start
 * Creates a response row. Server stamps started_at and (via trigger)
 * expires_at from the form's time_limit_minutes — the client never sends a
 * deadline. RLS + gate triggers reject unpublished / capped / closed forms.
 * A recovery token is minted immediately so save-and-resume works even for
 * respondents who never enter an email.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    rateLimit(req, "start", 30);

    const { slug } = await ctx.params;
    const supabase = createServiceClient();

    const { data: form } = await supabase
      .from("forms")
      .select("id, is_published, response_cap, time_limit_minutes, close_config")
      .eq("slug", slug)
      .single();

    if (!form) throw apiError("NOT_FOUND", "Form not found", 404);
    if (!form.is_published) throw apiError("FORM_NOT_PUBLISHED", "Form is not accepting responses", 403);

    // Close conditions (date / conditional) — pre-check for a clean error.
    if (await isFormClosed(supabase, form.id, form.close_config)) {
      throw apiError("FORM_CLOSED", "This form is closed", 403);
    }

    const { count } = await supabase
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("form_id", form.id)
      .not("submitted_at", "is", null);

    if (form.response_cap !== null && (count ?? 0) >= form.response_cap) {
      throw apiError("RESPONSE_CAP_REACHED", "This form has reached its response limit", 403);
    }

    // The DB gate triggers are the authoritative backstop (e.g. a conditional
    // close raced between our pre-check and this insert) — map their
    // exceptions to clean API errors instead of a 500.
    const response = await expectDbOk<{ id: string; started_at: string; expires_at: string | null }>(
      "start:insert response",
      () =>
        supabase
          .from("responses")
          .insert({ form_id: form.id, respondent_meta: {} })
          .select("id, started_at, expires_at")
          .single(),
    );
    if (!response) throw apiError("INTERNAL", "Could not start response", 500);

    const recoveryToken = await issueRecoveryToken(supabase, response.id);

    return NextResponse.json({ response: { ...response, recoveryToken } }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
