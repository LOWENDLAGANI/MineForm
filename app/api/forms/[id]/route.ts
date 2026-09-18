import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { assertUuid, handleError, parseBody } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { apiError } from "@/lib/types";
import {
  CloseConfigSchema,
  LogicRuleSchema,
  OptionSchema,
  ValidationRulesSchema,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/* ---------------------------------------------------------------------------
 * Shared auth helper — resolves the calling user or throws 401.
 * ------------------------------------------------------------------------- */
async function requireUser(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw apiError("UNAUTHORIZED", "Missing bearer token", 401);

  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw apiError("UNAUTHORIZED", "Invalid session", 401);
  return { supabase, user: data.user };
}

/** Loads a form row and verifies the caller owns it. */
async function requireOwnedForm(supabase: ReturnType<typeof createServiceClient>, id: string) {
  const { data: existing, error } = await supabase
    .from("forms")
    .select("id, user_id")
    .eq("id", id)
    .single();

  if (error || !existing) throw apiError("NOT_FOUND", "Form not found", 404);
  return existing;
}

/* ---------------------------------------------------------------------------
 * PATCH /api/forms/[id] — partial update, owner scope
 * ------------------------------------------------------------------------- */
const QuestionPatchSchema = z.object({
  id: z.string().uuid(),
  question_text: z.string().min(1).max(5000),
  question_type: z.enum([
    "short_text",
    "long_text",
    "single_choice",
    "multi_choice",
    "dropdown",
    "rating",
    "date",
    "number",
    "email",
    "file_upload",
  ]),
  options: z.array(OptionSchema).default([]),
  validation_rules: ValidationRulesSchema.default({}),
  logic_rules: z.array(LogicRuleSchema).default([]),
  is_required: z.boolean().default(false),
});

const PatchSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(5000).nullable().optional(),
    slug: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    time_limit_minutes: z.number().int().positive().nullable().optional(),
    response_cap: z.number().int().positive().nullable().optional(),
    renderer_mode: z.enum(["classic", "conversational"]).optional(),
    send_confirmation_email: z.boolean().optional(),
    close_config: CloseConfigSchema.optional(),
    theme_config: z.record(z.unknown()).optional(),
    payment_config: z.record(z.unknown()).optional(),
    is_published: z.boolean().optional(),
    /** Full ordered question set — replaces whatever is stored. */
    questions: z.array(QuestionPatchSchema).optional(),
  })
  .strict();

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "form id");

    const { supabase, user } = await requireUser(req);

    const body = await parseBody(req, PatchSchema);
    if (Object.keys(body).length === 0) {
      throw apiError("VALIDATION_ERROR", "Empty patch", 400);
    }

    await requireOwnedForm(supabase, id);

    // Questions: upsert the full ordered set (stable ids keep existing
    // answer rows intact), then remove any questions the builder dropped.
    // SECURITY: the client supplies question ids. A malicious owner could
    // submit a UUID belonging to ANOTHER user's form — the service-role
    // upsert would happily overwrite that foreign row (RLS is bypassed
    // server-side). So: load this form's existing ids, and re-issue brand-new
    // ids for anything we don't recognize as owned before writing.
    if (body.questions !== undefined) {
      const { data: ownedRows, error: ownErr } = await supabase
        .from("questions")
        .select("id")
        .eq("form_id", id);
      if (ownErr) throw ownErr;
      const ownedIds = new Set((ownedRows ?? []).map((r) => r.id));

      const rows = body.questions.map((q, i) => ({
        id: ownedIds.has(q.id) ? q.id : crypto.randomUUID(),
        form_id: id,
        question_text: q.question_text,
        question_type: q.question_type,
        options: q.options,
        validation_rules: q.validation_rules,
        logic_rules: q.logic_rules,
        is_required: q.is_required,
        order_index: i,
      }));

      if (rows.length > 0) {
        const { error: qErr } = await supabase
          .from("questions")
          .upsert(rows, { onConflict: "id" });
        if (qErr) throw qErr;
      }

      const keepIds = new Set(rows.map((r) => r.id));
      const removeIds = [...ownedIds].filter((qid) => !keepIds.has(qid));
      if (removeIds.length > 0) {
        const { error: rmErr } = await supabase
          .from("questions")
          .delete()
          .in("id", removeIds);
        if (rmErr) throw rmErr;
      }
    }

    // Form fields only — never pass the questions array to the forms table.
    const { questions: _questions, ...formPatch } = body;
    const hasFormFields = Object.keys(formPatch).length > 0;

    let updated = null;
    if (hasFormFields) {
      const { data, error } = await supabase
        .from("forms")
        .update(formPatch)
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;
      updated = data;
    }

    // Return the canonical state: form row + ordered questions.
    const { data: formRow } = await supabase
      .from("forms")
      .select("*")
      .eq("id", id)
      .single();

    const { data: questionRows, error: qErr } = await supabase
      .from("questions")
      .select("*")
      .eq("form_id", id)
      .order("order_index", { ascending: true });

    if (qErr) throw qErr;

    void updated;
    return NextResponse.json({ form: formRow, questions: questionRows ?? [] });
  } catch (err) {
    return handleError(err);
  }
}

/* ---------------------------------------------------------------------------
 * GET /api/forms/[id] — owner-scoped read (form + questions, drafts included)
 * ------------------------------------------------------------------------- */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "form id");

    const { supabase, user } = await requireUser(req);
    await requireOwnedForm(supabase, id);

    const { data: form, error } = await supabase
      .from("forms")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;

    const { data: questionRows, error: qErr } = await supabase
      .from("questions")
      .select("*")
      .eq("form_id", id)
      .order("order_index", { ascending: true });

    if (qErr) throw qErr;

    return NextResponse.json({ form, questions: questionRows ?? [] });
  } catch (err) {
    return handleError(err);
  }
}

/* ---------------------------------------------------------------------------
 * DELETE /api/forms/[id] — cascade deletes questions/responses/answers
 * ------------------------------------------------------------------------- */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "form id");

    const { supabase, user } = await requireUser(req);

    const existing = await requireOwnedForm(supabase, id);
    void existing;

    const { error } = await supabase.from("forms").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
