import { NextResponse, type NextRequest } from "next/server";
import { handleError } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { QuestionSchema, type Question } from "@/lib/types";
import type { Database } from "@/lib/db-types";

export const dynamic = "force-dynamic";

type FormRow = Database["public"]["Tables"]["forms"]["Row"];
type QuestionRow = Database["public"]["Tables"]["questions"]["Row"];

/**
 * GET /api/public/forms/[slug]
 * Returns the renderable form definition for a published form, plus live
 * availability so the client can decide what to show before rendering.
 * No auth. Unpublished or unknown slugs return an identical 404 (no probing).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;

    const supabase = createServiceClient();
    const { data: form, error } = await supabase
      .from("forms")
      .select("*")
      .eq("slug", slug)
      .eq("is_published", true)
      .single<FormRow>();

    if (error || !form) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Form not found" } },
        { status: 404 },
      );
    }

    const { data: questionRows, error: qErr } = await supabase
      .from("questions")
      .select("*")
      .eq("form_id", form.id)
      .order("order_index", { ascending: true });

    if (qErr) throw qErr;

    const questions: Question[] = (questionRows ?? []).map((q) =>
      QuestionSchema.parse(q as unknown as QuestionRow),
    );

    // Live availability
    let submittedCount = 0;
    if (form.response_cap !== null) {
      const { count } = await supabase
        .from("responses")
        .select("id", { count: "exact", head: true })
        .eq("form_id", form.id)
        .not("submitted_at", "is", null);
      submittedCount = count ?? 0;
    }

    const capped =
      form.response_cap !== null && submittedCount >= (form.response_cap ?? 0);

    // Close conditions: date is evaluated here; conditional close needs the
    // answers tables, so the client only gets the date part up front — the
    // authoritative check still happens server-side on start/submit.
    const closeCfg = (form.close_config ?? {}) as { close_at?: string | null };
    const closedByDate =
      closeCfg.close_at != null && Date.now() > new Date(closeCfg.close_at).getTime();

    return NextResponse.json({
      form: {
        id: form.id,
        title: form.title,
        description: form.description,
        time_limit_minutes: form.time_limit_minutes,
        response_cap: form.response_cap,
        renderer_mode: form.renderer_mode,
        theme_config: form.theme_config,
        payment_config: form.payment_config,
        submitted_count: submittedCount,
        is_capped: capped,
        is_closed: closedByDate,
        close_at: closeCfg.close_at ?? null,
      },
      questions,
    });
  } catch (err) {
    return handleError(err);
  }
}
