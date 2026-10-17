"use client";

// Login page — email + password only.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getBrowserSupabase, supabaseEnvMissing } from "@/lib/supabase-browser";
const input =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-1 focus:ring-inset focus:ring-zinc-900";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) { router.replace("/"); return; }
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (!error) {
          window.history.replaceState(null, "", window.location.pathname);
          router.replace("/");
        } else setError("Sign-in failed.");
      }
    })();
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error("Supabase not configured.");
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setNotice("Check your email to confirm.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/");
        router.refresh();
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Authentication failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="brand-backdrop">
      <main className="flex min-h-dvh items-center justify-center px-4">
        <div className="card-in w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl shadow-blue-950/20">
          <div className="bg-slate-800 px-6 py-4">
            <h1 className="text-base font-semibold text-white">MineForm</h1>
            <p className="mt-0.5 text-xs text-blue-200">
              {mode === "signin" ? "Sign in" : "Create account"}
            </p>
          </div>

          <div className="px-6 py-6">
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label htmlFor="email" className="mb-1 block text-xs font-medium text-zinc-600">
                  Email
                </label>
                <input
                  id="email" type="email" required autoComplete="email"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  className={`${input} !border-blue-100 !bg-blue-50/60 !placeholder:text-blue-300 focus:!border-blue-500 focus:!ring-blue-500/30`}
                />
              </div>
              <div>
                <label htmlFor="password" className="mb-1 block text-xs font-medium text-zinc-600">
                  Password
                </label>
                <input
                  id="password" type="password" required minLength={6}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className={`${input} !border-blue-100 !bg-blue-50/60 focus:!border-blue-500 focus:!ring-blue-500/30`}
                />
              </div>

              {error && <p className="text-xs text-red-600">{error}</p>}
              {notice && <p className="text-xs text-zinc-600">{notice}</p>}

              <button
                type="submit" disabled={busy}
                className="w-full rounded-full bg-blue-600 px-3 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 transition-all hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50"
              >
                {busy ? "Working…" : mode === "signin" ? "Sign in" : "Sign up"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); setNotice(null); }}
              className="mt-4 text-left text-xs text-zinc-500 hover:text-blue-600"
            >
              {mode === "signin" ? "No account? Sign up →" : "Have an account? Sign in →"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
