import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleError, parseBody, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { apiError } from "@/lib/types";
import { FormFeatureFieldsSchema, QuestionInputSchema } from "@/lib/form-payload";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/* ---------------------------------------------------------------------------
 * GET /api/forms — list forms owned by OR shared with the caller
 * ------------------------------------------------------------------------- */
export async function GET(req: NextRequest) {
  try {
    rateLimit(req, "owner:list", 120);
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) throw apiError("UNAUTHORIZED", "Missing bearer token", 401);

    const supabase = createServiceClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) {
      throw apiError("UNAUTHORIZED", "Invalid session", 401);
    }
    const userId = userData.user.id;

    // Owned forms…
    const { data: owned, error } = await supabase
      .from("forms")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    // …plus forms shared with the caller as collaborator.
    const { data: collabs, error: cErr } = await supabase
      .from("form_collaborators")
      .select("form_id, role, email")
      .eq("user_id", userId);
    if (cErr) throw cErr;

    let shared: (typeof owned & { role: string }) = [] as never;
    const collabRows = collabs ?? [];
    if (collabRows.length > 0) {
      const { data: sharedForms, error: sErr } = await supabase
        .from("forms")
        .select("*")
        .in("id", collabRows.map((c) => c.form_id));
      if (sErr) throw sErr;
      const roleByForm = new Map(collabRows.map((c) => [c.form_id, c.role]));
      shared = (sharedForms ?? []).map((f) => ({ ...f, role: roleByForm.get(f.id) ?? "viewer" })) as never;
    }

    return NextResponse.json({
      forms: (owned ?? []).map((f) => ({ ...f, role: "owner" })),
      shared,
      email: userData.user.email ?? null,
    });
  } catch (err) {
    return handleError(err);
  }
}

/* ---------------------------------------------------------------------------
 * POST /api/forms — create a form with questions in one round-trip
 * ------------------------------------------------------------------------- */
const CreateFormSchema = FormFeatureFieldsSchema
  .extend({
    title: z.string().min(1).max(300),
    description: z.string().max(5000).nullable().optional(),
    slug: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case"),
    theme_config: z.record(z.unknown()).default({}),
    questions: z.array(QuestionInputSchema).default([]),
  });

export async function POST(req: NextRequest) {
  try {
    rateLimit(req, "owner:create", 30);
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

    const { questions: questionsInput, theme_config, ...featureFields } = body;

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
        theme_config,
        settings: body.settings ?? {},
        scoring_config: body.scoring_config ?? {},
        ending_config: body.ending_config ?? {},
        design_config: body.design_config ?? {},
        integrations: body.integrations ?? {},
        access_config: body.access_config ?? {},
      })
      .select("*")
      .single();

    if (formErr || !form) throw formErr ?? new Error("form insert failed");

    if (questionsInput.length > 0) {
      const rows = questionsInput.map((q, i) => ({ ...q, form_id: form.id, order_index: i }));
      const { error: qErr } = await supabase.from("questions").insert(rows);
      if (qErr) throw qErr;
    }

    await logAudit(supabase, {
      form_id: form.id,
      actor: userData.user.email ?? userId,
      action: "form.created",
      detail: { title: form.title, questions: questionsInput.length },
    });

    return NextResponse.json({ form }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
