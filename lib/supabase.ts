import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client (service role). NEVER import from client code —
 * this bypasses RLS entirely. API routes and Edge Functions only.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Browser / RLS-scoped client. Subject to Row Level Security. */
export function createAnonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}
