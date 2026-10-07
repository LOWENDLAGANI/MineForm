import { NextResponse, type NextRequest } from "next/server";
import { assertUuid, handleError, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { requireFormAccess } from "@/lib/form-access";
import { computeFormStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

/**
 * GET /api/forms/[id]/stats — owner/collaborator analytics:
 * 30-day trend, completion times, word cloud, quiz scores, geo/device split.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "form id");
    rateLimit(req, "owner:stats", 60);

    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) throw new Error("unauthenticated");
    const supabase = createServiceClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) throw new Error("unauthenticated");

    await requireFormAccess(supabase, id, userData.user.id, "viewer");

    const stats = await computeFormStats(supabase, id, { wordCloud: true });
    return NextResponse.json({ stats });
  } catch (err) {
    if (err instanceof Error && err.message === "unauthenticated") {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid session" } }, { status: 401 });
    }
    return handleError(err);
  }
}
