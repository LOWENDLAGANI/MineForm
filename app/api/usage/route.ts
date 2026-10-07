import { NextResponse, type NextRequest } from "next/server";
import { handleError, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { apiError } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/usage — free-tier usage overview for the dashboard:
 * form count, response totals this month, storage-free summary.
 * MineForm is free forever, so there is no quota — just visibility.
 */
export async function GET(req: NextRequest) {
  try {
    rateLimit(req, "usage", 60);
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) throw apiError("UNAUTHORIZED", "Missing bearer token", 401);

    const supabase = createServiceClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) throw apiError("UNAUTHORIZED", "Invalid session", 401);
    const userId = userData.user.id;

    const { data: forms, error } = await supabase
      .from("forms")
      .select("id, is_published, created_at")
      .eq("user_id", userId);
    if (error) throw error;

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    let responsesThisMonth = 0;
    let responsesTotal = 0;
    for (const form of forms ?? []) {
      const { count: total } = await supabase
        .from("responses")
        .select("id", { count: "exact", head: true })
        .eq("form_id", form.id)
        .not("submitted_at", "is", null);
      responsesTotal += total ?? 0;
      const { count: monthly } = await supabase
        .from("responses")
        .select("id", { count: "exact", head: true })
        .eq("form_id", form.id)
        .not("submitted_at", "is", null)
        .gte("submitted_at", monthStart.toISOString());
      responsesThisMonth += monthly ?? 0;
    }

    return NextResponse.json({
      usage: {
        forms: forms?.length ?? 0,
        publishedForms: (forms ?? []).filter((f) => f.is_published).length,
        responsesThisMonth,
        responsesTotal,
        plan: "free",
        planLabel: "Free forever",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
