"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Browser Supabase client (anon key, RLS-scoped). Singleton per page load.
 * Returns null instead of throwing when env vars are missing so the UI can
 * render and show a setup prompt instead of crashing the whole tree.
 */
export function getBrowserSupabase(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return cached;
}

export const supabaseEnvMissing = !(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
