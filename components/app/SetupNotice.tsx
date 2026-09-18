"use client";

/**
 * SetupNotice — rendered when Supabase env vars are missing so the app
 * explains itself instead of crashing at runtime.
 */
export function SetupNotice() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-sm font-medium text-zinc-900">Setup required</h1>
      <p className="mt-2 text-xs text-zinc-500">
        Supabase environment variables are not set. Create{" "}
        <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono">.env.local</code> in the
        project root with:
      </p>
      <pre className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-700">
{`NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>`}
      </pre>
      <p className="mt-3 text-xs text-zinc-500">
        Find both keys in your Supabase dashboard under Settings → API. Restart{" "}
        <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono">npm run dev</code> after saving.
      </p>
    </main>
  );
}
