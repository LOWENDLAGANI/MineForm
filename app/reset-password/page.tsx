"use client";

// Set a new password after clicking the recovery link emailed by Supabase.
// The link lands here with the recovery session (implicit-flow hash or ?code=
// exchange); once a session exists, updateUser({ password }) changes it.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase-browser";

const input =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-1 focus:ring-inset focus:ring-zinc-900";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) { setError("Supabase not configured."); setReady(true); return; }
    (async () => {
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) setError("This reset link is invalid or expired.");
        else window.history.replaceState(null, "", window.location.pathname);
      }
      const { data } = await supabase.auth.getSession();
      setHasSession(!!data.session);
      setReady(true);
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true); setError(null);
    try {
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error("Supabase not configured.");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => { router.push("/"); router.refresh(); }, 1500);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update password."); }
    finally { setBusy(false); }
  }

  return (
    <div className="brand-backdrop">
      <main className="flex min-h-dvh items-center justify-center px-4">
        <div className="card-in w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl shadow-blue-950/20">
          <div className="bg-slate-800 px-6 py-4">
            <h1 className="text-base font-semibold text-white">MineForm</h1>
            <p className="mt-0.5 text-xs text-blue-200">Set a new password</p>
          </div>

          <div className="px-6 py-6">
            {!ready && <p className="text-sm text-zinc-500">Checking your link…</p>}

            {ready && done && (
              <p className="text-sm text-zinc-700">
                Password updated — taking you to your dashboard…
              </p>
            )}

            {ready && !done && !hasSession && (
              <div className="space-y-4">
                <p className="text-sm text-zinc-600">
                  {error ?? "This reset link is invalid or expired."}
                </p>
                <button
                  type="button" onClick={() => router.push("/login")}
                  className="w-full rounded-full bg-blue-600 px-3 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 transition-all hover:bg-blue-700 active:scale-[0.99]"
                >
                  Back to sign in
                </button>
              </div>
            )}

            {ready && !done && hasSession && (
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label htmlFor="password" className="mb-1 block text-xs font-medium text-zinc-600">
                    New password
                  </label>
                  <input
                    id="password" type="password" required minLength={6} autoComplete="new-password"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    className={`${input} !border-blue-100 !bg-blue-50/60 focus:!border-blue-500 focus:!ring-blue-500/30`}
                  />
                </div>
                <div>
                  <label htmlFor="confirm" className="mb-1 block text-xs font-medium text-zinc-600">
                    Confirm new password
                  </label>
                  <input
                    id="confirm" type="password" required minLength={6} autoComplete="new-password"
                    value={confirm} onChange={(e) => setConfirm(e.target.value)}
                    className={`${input} !border-blue-100 !bg-blue-50/60 focus:!border-blue-500 focus:!ring-blue-500/30`}
                  />
                </div>

                {error && <p className="text-xs text-red-600">{error}</p>}

                <button
                  type="submit" disabled={busy}
                  className="w-full rounded-full bg-blue-600 px-3 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 transition-all hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Update password"}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
