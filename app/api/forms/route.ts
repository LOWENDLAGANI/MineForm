import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleError, parseBody } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import {
  CloseConfigSchema,
  LogicRuleSchema,
  OptionSchema,
  ValidationRulesSchema,
  apiError,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/* ---------------------------------------------------------------------------
 * GET /api/forms — list the caller's forms (owner scope, RLS-backed)
 * ------------------------------------------------------------------------- */
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) throw apiError("UNAUTHORIZED", "Missing bearer token", 401);

    const supabase = createServiceClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) {
      throw apiError("UNAUTHORIZED", "Invalid session", 401);
    }

    const { data, error } = await supabase
      .from("forms")
      .select("*")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ forms: data });
  } catch (err) {
    return handleError(err);
  }
}

/* ---------------------------------------------------------------------------
 * POST /api/forms — create a form with questions in one round-trip
 * ------------------------------------------------------------------------- */
const QuestionInputSchema = z.object({
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

const CreateFormSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  slug: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case"),
  time_limit_minutes: z.number().int().positive().nullable().optional(),
  response_cap: z.number().int().positive().nullable().optional(),
  renderer_mode: z.enum(["classic", "conversational"]).default("classic"),
  send_confirmation_email: z.boolean().default(false),
  close_config: CloseConfigSchema.default({ conditions: [] }),
  theme_config: z.record(z.unknown()).default({}),
  payment_config: z.record(z.unknown()).default({}),
  questions: z.array(QuestionInputSchema).default([]),
});

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) throw apiError("UNAUTHORIZED", "Missing bearer token", 401);

    const body = await parseBody(req, CreateFormSchema);

    const supabase = createServiceClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) {
      throw apiError("UNAUTHORIZED", "Invalid session", 401);
    }
    const userId = userData.user.id;

    // Slug must be globally unique — check before insert for a clean 409.
    const { data: slugTaken } = await supabase
      .from("forms")
      .select("id")
      .eq("slug", body.slug)
      .limit(1);

    if (slugTaken && slugTaken.length > 0) {
      throw apiError("VALIDATION_ERROR", "Slug already in use", 409);
    }

    const { data: form, error: formErr } = await supabase
      .from("forms")
      .insert({
        user_id: userId,
        title: body.title,
        description: body.description ?? null,
        slug: body.slug,
        time_limit_minutes: body.time_limit_minutes ?? null,
        response_cap: body.response_cap ?? null,
        renderer_mode: body.renderer_mode,
        send_confirmation_email: body.send_confirmation_email,
        close_config: body.close_config,
        theme_config: body.theme_config,
        payment_config: body.payment_config,
      })
      .select("*")
      .single();

    if (formErr || !form) throw formErr ?? new Error("form insert failed");

    if (body.questions.length > 0) {
      const rows = body.questions.map((q, i) => ({ ...q, form_id: form.id, order_index: i }));
      const { error: qErr } = await supabase.from("questions").insert(rows);
      if (qErr) throw qErr;
    }

    return NextResponse.json({ form }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
