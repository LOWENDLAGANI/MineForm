import { NextResponse, type NextRequest } from "next/server";
import { assertUuid, handleError } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { apiError } from "@/lib/types";

export const dynamic = "force-dynamic";

interface FunnelStep {
  questionId: string;
  questionText: string;
  orderIndex: number;
  /** Responses (submitted or abandoned) that answered this question. */
  reached: number;
  /** Of those reached, how many answered it. */
  answered: number;
  /** 1 - answered/reached, as a percentage. */
  dropOffPct: number;
}

/**
 * GET /api/forms/[id]/funnel — owner-only drop-off analytics.
 *
 * Every response (submitted or abandoned) is a "session". Walking the form's
 * question order, each question's "reached" count is the number of sessions
 * that answered at least one question at or after its position — i.e. the
 * respondent actually got to it. Drop-off is then visible per question:
 * a big gap between reached and answered is where people quit.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "form id");

    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) throw apiError("UNAUTHORIZED", "Missing bearer token", 401);

    const supabase = createServiceClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) {
      throw apiError("UNAUTHORIZED", "Invalid session", 401);
    }

    const { data: form } = await supabase
      .from("forms")
      .select("user_id, title")
      .eq("id", id)
      .single();
    if (!form) throw apiError("NOT_FOUND", "Form not found", 404);
    if (form.user_id !== userData.user.id) {
      throw apiError("UNAUTHORIZED", "Not the form owner", 403);
    }

    const { data: questionRows, error: qErr } = await supabase
      .from("questions")
      .select("id, question_text, order_index")
      .eq("form_id", id)
      .order("order_index", { ascending: true });
    if (qErr) throw qErr;

    const { data: responseRows, error: rErr } = await supabase
      .from("responses")
      .select("id, submitted_at, answers ( question_id )")
      .eq("form_id", id);
    if (rErr) throw rErr;

    const order = new Map((questionRows ?? []).map((q) => [q.id, q.order_index]));
    const reachedCounts = new Map<string, number>(questionRows?.map((q) => [q.id, 0]) ?? []);
    const answeredCounts = new Map<string, number>(questionRows?.map((q) => [q.id, 0]) ?? []);

    let started = 0;

    for (const r of responseRows ?? []) {
      const answeredIds = (r.answers ?? [])
        .map((a: { question_id: string }) => a.question_id)
        .filter((qid: string) => order.has(qid));
      if (answeredIds.length === 0) continue; // never answered anything — not a funnel participant
      started += 1;

      // Highest-order question this respondent actually answered.
      const maxOrder = Math.max(...answeredIds.map((qid) => order.get(qid) ?? 0));
      for (const qid of answeredIds) answeredCounts.set(qid, (answeredCounts.get(qid) ?? 0) + 1);

      // Every question at or before their furthest point was "reached".
      for (const q of questionRows ?? []) {
        if (q.order_index <= maxOrder) {
          reachedCounts.set(q.id, (reachedCounts.get(q.id) ?? 0) + 1);
        }
      }
    }

    const steps: FunnelStep[] = (questionRows ?? []).map((q) => {
      const reached = reachedCounts.get(q.id) ?? 0;
      const answered = answeredCounts.get(q.id) ?? 0;
      return {
        questionId: q.id,
        questionText: q.question_text,
        orderIndex: q.order_index,
        reached,
        answered,
        dropOffPct: reached === 0 ? 0 : Math.round(((reached - answered) / reached) * 100),
      };
    });

    const submittedCount = (responseRows ?? []).filter((r) => r.submitted_at).length;

    return NextResponse.json({
      funnel: {
        started,
        completed: submittedCount,
        completionPct: started === 0 ? 0 : Math.round((submittedCount / started) * 100),
        steps,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
