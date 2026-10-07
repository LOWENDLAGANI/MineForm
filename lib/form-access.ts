import { createServiceClient } from "@/lib/supabase";
import { apiError } from "@/lib/types";

export type FormRole = "owner" | "editor" | "viewer";

/**
 * Resolves the caller's relationship to a form: owner, invited collaborator
 * (editor/viewer), or null. Service-role client means RLS is bypassed here —
 * these checks ARE the access control.
 */
export async function getFormRole(
  supabase: ReturnType<typeof createServiceClient>,
  formId: string,
  userId: string,
): Promise<FormRole | null> {
  const { data: form, error } = await supabase
    .from("forms")
    .select("user_id")
    .eq("id", formId)
    .maybeSingle();
  if (error) throw error;
  if (form?.user_id === userId) return "owner";

  const { data: collab, error: cErr } = await supabase
    .from("form_collaborators")
    .select("role, user_id")
    .eq("form_id", formId)
    .eq("user_id", userId)
    .maybeSingle();
  if (cErr) throw cErr;
  if (collab) return collab.role as "editor" | "viewer";
  return null;
}

/** Throws 404 when the caller has no role, 403 when their role is too low. */
export async function requireFormAccess(
  supabase: ReturnType<typeof createServiceClient>,
  formId: string,
  userId: string,
  minimum: FormRole,
): Promise<FormRole> {
  const role = await getFormRole(supabase, formId, userId);
  if (!role) throw apiError("NOT_FOUND", "Form not found", 404);
  if (minimum === "editor" && role === "viewer") {
    throw apiError("UNAUTHORIZED", "You have view-only access to this form", 403);
  }
  return role;
}
