import { NextResponse, type NextRequest } from "next/server";
import { assertUuid, handleError, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { requireFormAccess } from "@/lib/form-access";

export const dynamic = "force-dynamic";

/** GET /api/forms/[id]/audit — last 50 activity entries (owner/editor). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "form id");
    rateLimit(req, "owner:audit", 60);

    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) throw new Error("unauthenticated");
    const supabase = createServiceClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) throw new Error("unauthenticated");

    await requireFormAccess(supabase, id, userData.user.id, "viewer");

    const { data, error } = await supabase
      .from("audit_log")
      .select("id, actor, action, detail, created_at")
      .eq("form_id", id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    return NextResponse.json({ entries: data ?? [] });
  } catch (err) {
    if (err instanceof Error && err.message === "unauthenticated") {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid session" } }, { status: 401 });
    }
    return handleError(err);
  }
}
