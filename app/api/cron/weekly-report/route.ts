import { NextResponse, type NextRequest } from "next/server";
import { handleError } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { computeFormStats } from "@/lib/stats";
import { sendWeeklyReportEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/weekly-report — Vercel Cron ( Mondays 08:00 UTC).
 * Emails every form owner who opted into weekly_report with a 7-day digest.
 * Protected by the CRON_SECRET env var (set it in Vercel).
 */
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "CRON_SECRET not configured" } }, { status: 401 });
    }
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Bad cron secret" } }, { status: 401 });
    }

    const supabase = createServiceClient();

    const { data: forms, error } = await supabase
      .from("forms")
      .select("id, user_id, title, slug, integrations");
    if (error) throw error;

    const optedIn = (forms ?? []).filter(
      (f) => (f.integrations as { weekly_report?: boolean } | null)?.weekly_report === true,
    );

    const now = new Date();
    const weekEnd = now.toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();

    // Owner emails via auth admin lookup.
    const ownerIds = [...new Set(optedIn.map((f) => f.user_id))];
    const emailByUser = new Map<string, string>();
    for (const uid of ownerIds) {
      try {
        const { data: found } = await supabase.auth.admin.getUserById(uid);
        if (found?.user?.email) emailByUser.set(uid, found.user.email);
      } catch {
        // skip — no admin read
      }
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
    const results: { userId: string; emailed: boolean; forms: number }[] = [];

    for (const uid of ownerIds) {
      const email = emailByUser.get(uid);
      if (!email) continue;
      const userForms = optedIn.filter((f) => f.user_id === uid);
      const rows: { title: string; slug: string; newResponses: number; prevResponses: number; total: number }[] = [];
      for (const f of userForms) {
        const stats = await computeFormStats(supabase, f.id);
        if (stats.last7Count === 0 && stats.totalResponses === 0) continue;
        rows.push({ title: f.title, slug: f.slug, newResponses: stats.last7Count, prevResponses: stats.prev7Count, total: stats.totalResponses });
      }
      if (rows.length === 0) continue;
      const emailed = await sendWeeklyReportEmail({ to: email, weekStart, weekEnd, forms: rows, baseUrl });
      results.push({ userId: uid, emailed, forms: rows.length });
    }

    return NextResponse.json({ ok: true, processed: results.length, results });
  } catch (err) {
    return handleError(err);
  }
}
