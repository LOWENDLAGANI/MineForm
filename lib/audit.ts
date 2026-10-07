import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Append-only activity trail. Best-effort: a failed audit insert is logged
 * but never blocks the mutation it describes.
 */
export async function logAudit(
  supabase: SupabaseClient,
  entry: {
    form_id: string;
    actor: string;
    action: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    form_id: entry.form_id,
    actor: entry.actor,
    action: entry.action,
    detail: entry.detail ?? {},
  });
  if (error) console.error("[audit] insert failed", error.message);
}
