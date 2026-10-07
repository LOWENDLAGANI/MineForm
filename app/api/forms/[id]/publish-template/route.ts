import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { assertUuid, handleError, parseBody, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { apiError } from "@/lib/types";
import { requireFormAccess } from "@/lib/form-access";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const PublishSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(""),
});

/**
 * POST /api/forms/[id]/publish-template — shares the form's question set as a
 * public template (free community marketplace). Only the owner can publish.
 * The definition snapshot never includes responses or integrations.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "form id");
    rateLimit(req, "owner:template", 20);

    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) throw apiError("UNAUTHORIZED", "Missing bearer token", 401);
    const supabase = createServiceClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) throw apiError("UNAUTHORIZED", "Invalid session", 401);

    await requireFormAccess(supabase, id, userData.user.id, "owner");

    const body = await parseBody(req, PublishSchema);

    const { data: questions, error: qErr } = await supabase
      .from("questions")
      .select("question_text, question_type, options, validation_rules, logic_rules, translations, shuffle_options, is_required, order_index")
      .eq("form_id", id)
      .order("order_index", { ascending: true });
    if (qErr) throw qErr;
    if (!questions || questions.length === 0) {
      throw apiError("VALIDATION_ERROR", "Add questions before publishing a template", 400);
    }

    const definition = { renderer_mode: "classic", questions };

    const { data: template, error } = await supabase
      .from("public_templates")
      .insert({
        user_id: userData.user.id,
        author_email: userData.user.email ?? null,
        name: body.name,
        description: body.description,
        definition,
      })
      .select("id, name, description, created_at")
      .single();
    if (error) throw error;

    await logAudit(supabase, {
      form_id: id,
      actor: userData.user.email ?? userData.user.id,
      action: "template.published",
      detail: { templateName: body.name },
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
