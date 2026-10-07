import { NextResponse, type NextRequest } from "next/server";
import { assertUuid, handleError, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { apiError } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/forms/[id]/responses — owner-only responses feed.
 * Supports ?status=submitted|abandoned and ?limit=&cursor= for paging.
 * Dense tabular shape: one row per response, answers keyed by question id.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "form id");
    rateLimit(req, "owner:responses", 120);

    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) throw apiError("UNAUTHORIZED", "Missing bearer token", 401);

    const supabase = createServiceClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) {
      throw apiError("UNAUTHORIZED", "Invalid session", 401);
    }

    const { data: form } = await supabase.from("forms").select("user_id").eq("id", id).single();
    if (!form) throw apiError("NOT_FOUND", "Form not found", 404);
    if (form.user_id !== userData.user.id) {
      throw apiError("UNAUTHORIZED", "Not the form owner", 403);
    }

    const url = new URL(req.url);
    const status = url.searchParams.get("status");

    // NaN/negative/absurd limits previously reached PostgREST as-is.
    const rawLimit = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(Math.floor(rawLimit), 200)
      : 50;

    const cursor = url.searchParams.get("cursor");
    if (cursor !== null && Number.isNaN(Date.parse(cursor))) {
      throw apiError("VALIDATION_ERROR", "Invalid cursor", 400);
    }

    let query = supabase
      .from("responses")
      .select(
        `id, form_id, started_at, submitted_at, expires_at, respondent_meta,
         answers ( id, question_id, answer_text, answer_json ),
         payments ( provider, amount_cents, currency, status )`,
      )
      .eq("form_id", id)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (status === "submitted") query = query.not("submitted_at", "is", null);
    if (status === "abandoned") query = query.is("submitted_at", null);
    if (cursor) query = query.lt("submitted_at", cursor);

    const { data, error } = await query;
    if (error) throw error;

    const nextCursor =
      data && data.length === limit ? (data[data.length - 1]?.submitted_at ?? null) : null;

    return NextResponse.json({ responses: data, nextCursor });
  } catch (err) {
    return handleError(err);
  }
}
