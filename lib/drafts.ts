import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Draft / recovery-token helpers. Tokens are 24 random bytes, url-safe
 * base64 — generated server-side only, never client-supplied.
 */

export function generateRecoveryToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function issueRecoveryToken(
  supabase: SupabaseClient,
  responseId: string,
): Promise<string | null> {
  // Only unsubmitted responses get a token; the WHERE guard makes double
  // issue attempts race-safe (a submitted response can never be resumed).
  const { data, error } = await supabase
    .from("responses")
    .update({
      recovery_token: generateRecoveryToken(),
      recovery_token_created_at: new Date().toISOString(),
    })
    .eq("id", responseId)
    .is("submitted_at", null)
    .select("recovery_token")
    .single();

  if (error || !data) return null;
  return data.recovery_token;
}
