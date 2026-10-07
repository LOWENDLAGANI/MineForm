"use client";

export function SetupNotice() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-sm font-medium text-zinc-900">Setup required</h1>
      <p className="mt-2 text-xs text-zinc-500">
        Create <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono">.env.local</code> with:
      </p>
      <pre className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-700">
{`NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>`}
      </pre>
      <p className="mt-3 text-xs text-zinc-500">
        Get keys from Supabase dashboard → Settings → API. Restart <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono">npm run dev</code> after saving.
      </p>
    </main>
  );
}
