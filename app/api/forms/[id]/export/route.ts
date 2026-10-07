import { NextResponse, type NextRequest } from "next/server";
import { assertUuid, handleError, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { apiError } from "@/lib/types";
import { requireFormAccess } from "@/lib/form-access";

export const dynamic = "force-dynamic";

function csvCell(value: string): string {
  // Neutralize spreadsheet formula injection, then quote.
  const sanitized = value.replace(/^[=+\-@\t\r]/, "'");
  return `"${sanitized.replace(/"/g, '""')}"`;
}

/**
 * GET /api/forms/[id]/export?format=csv|json — server-side export of every
 * submitted response. One row per response; columns are the questions in
 * form order.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "form id");
    rateLimit(req, "owner:export", 20);

    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) throw apiError("UNAUTHORIZED", "Missing bearer token", 401);
    const supabase = createServiceClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) throw apiError("UNAUTHORIZED", "Invalid session", 401);

    await requireFormAccess(supabase, id, userData.user.id, "viewer");

    const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "csv";

    const { data: questionRows, error: qErr } = await supabase
      .from("questions")
      .select("id, question_text, order_index")
      .eq("form_id", id)
      .order("order_index", { ascending: true });
    if (qErr) throw qErr;

    const { data: responseRows, error: rErr } = await supabase
      .from("responses")
      .select("id, started_at, submitted_at, score, locale, respondent_meta, answers ( question_id, answer_text, answer_json )")
      .eq("form_id", id)
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false });
    if (rErr) throw rErr;

    const questions = questionRows ?? [];
    const rows = (responseRows ?? []).map((r) => {
      const byQ = new Map<string, { answer_text: string | null; answer_json: unknown }>();
      for (const a of (r.answers as { question_id: string; answer_text: string | null; answer_json: unknown }[]) ?? []) {
        byQ.set(a.question_id, a);
      }
      const cells = questions.map((q) => {
        const a = byQ.get(q.id);
        if (!a) return "";
        if (a.answer_text !== null && a.answer_text !== undefined) return a.answer_text;
        const j = a.answer_json;
        if (Array.isArray(j)) return j.join(", ");
        if (j === null || j === undefined) return "";
        if (typeof j === "object") return JSON.stringify(j);
        return String(j);
      });
      return { id: r.id, submitted_at: r.submitted_at, score: r.score, locale: r.locale, cells };
    });

    if (format === "json") {
      return NextResponse.json({
        formId: id,
        exportedAt: new Date().toISOString(),
        questions: questions.map((q) => q.question_text),
        responses: rows,
      });
    }

    const header = ["response_id", "submitted_at", "score", ...questions.map((q) => q.question_text)];
    const lines = [header.map(csvCell).join(",")];
    for (const row of rows) {
      lines.push([row.id, row.submitted_at ?? "", row.score === null ? "" : String(row.score), ...row.cells].map(csvCell).join(","));
    }

    return new NextResponse("\uFEFF" + lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="responses-${id}.csv"`,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
