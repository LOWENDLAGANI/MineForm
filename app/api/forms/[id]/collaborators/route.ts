import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { assertUuid, handleError, parseBody, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { apiError } from "@/lib/types";
import { requireFormAccess } from "@/lib/form-access";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

async function requireOwner(req: NextRequest, formId: string) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw apiError("UNAUTHORIZED", "Missing bearer token", 401);
  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw apiError("UNAUTHORIZED", "Invalid session", 401);
  const role = await requireFormAccess(supabase, formId, data.user.id, "viewer");
  if (role !== "owner") throw apiError("UNAUTHORIZED", "Only the form owner can manage collaborators", 403);
  return { supabase, user: data.user };
}

/* GET — list collaborators (owner only) */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "form id");
    rateLimit(req, "owner:collab", 60);
    const { supabase } = await requireOwner(req, id);
    const { data, error } = await supabase
      .from("form_collaborators")
      .select("id, email, role, created_at")
      .eq("form_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ collaborators: data ?? [] });
  } catch (err) {
    return handleError(err);
  }
}

const AddSchema = z.object({
  email: z.string().email().max(200),
  role: z.enum(["editor", "viewer"]),
});

/* POST — invite a collaborator by email (owner only) */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "form id");
    rateLimit(req, "owner:collab", 30);
    const { supabase, user } = await requireOwner(req, id);
    const body = await parseBody(req, AddSchema);
    const email = body.email.toLowerCase();

    if (user.email && email === user.email.toLowerCase()) {
      throw apiError("VALIDATION_ERROR", "That's your own account", 400);
    }

    // Resolve the email to a Supabase auth user (null until they sign up).
    let userId: string | null = null;
    try {
      // No direct email lookup available on this client version — profile
      // rows are linked lazily when the collaborator signs in.
      userId = null;
    } catch {
      // admin API unavailable — collaborator can still be linked by email later
    }

    const { data, error } = await supabase
      .from("form_collaborators")
      .upsert(
        { form_id: id, email, role: body.role, user_id: userId },
        { onConflict: "form_id,email" },
      )
      .select("id, email, role, created_at")
      .single();
    if (error) throw error;

    await logAudit(supabase, {
      form_id: id,
      actor: user.email ?? user.id,
      action: "collaborator.added",
      detail: { email, role: body.role },
    });

    return NextResponse.json({ collaborator: data }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

/* DELETE — remove a collaborator (owner only) */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "form id");
    rateLimit(req, "owner:collab", 30);
    const { supabase, user } = await requireOwner(req, id);
    const collaboratorId = new URL(req.url).searchParams.get("collaboratorId");
    if (!collaboratorId) throw apiError("VALIDATION_ERROR", "Missing collaboratorId", 400);

    const { error } = await supabase
      .from("form_collaborators")
      .delete()
      .eq("id", collaboratorId)
      .eq("form_id", id);
    if (error) throw error;

    await logAudit(supabase, {
      form_id: id,
      actor: user.email ?? user.id,
      action: "collaborator.removed",
      detail: { collaboratorId },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
