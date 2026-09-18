"use client";

/**
 * Login page — dense, flat, keyboard-first. Email + password only; magic
 * link available as a secondary action. No glass, no gradients.
 */

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

  // Already signed in? Supabase persists the session (localStorage), so a
  // returning user lands here and goes straight to their dashboard.
  // Also handles the OAuth/magic-link return: supabase-js exchanges the
  // ?code= query param (PKCE verifier lives in browser cookies/localStorage).
  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        router.replace("/");
        return;
      }
      // OAuth return: exchange the authorization code if present.
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (!error) {
          window.history.replaceState(null, "", window.location.pathname);
          router.replace("/");
        } else {
          setError("Google sign-in failed. Please try again.");
        }
      }
    })();
  }, [router]);

  async function signInWithGoogle() {
    setError(null);
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setError("Supabase is not configured. Add env vars to .env.local.");
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
    if (error) setError(error.message);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error("Supabase is not configured. Add env vars to .env.local.");
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setNotice("Check your email to confirm your account.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="brand-backdrop">
      <main className="flex min-h-dvh items-center justify-center px-4">
        <div className="card-in w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl shadow-blue-950/20">
          <div className="bg-slate-800 px-6 py-4">
            <h1 className="text-base font-semibold text-white">MineForm</h1>
            <p className="mt-0.5 text-xs text-blue-200">
              {mode === "signin" ? "Sign in to your workspace" : "Create a new account"}
            </p>
          </div>

          <div className="px-6 py-6">
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label htmlFor="email" className="mb-1 block text-xs font-medium text-zinc-600">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`${input} !border-blue-100 !bg-blue-50/60 !placeholder:text-blue-300 focus:!border-blue-500 focus:!ring-blue-500/30`}
                />
              </div>
              <div>
                <label htmlFor="password" className="mb-1 block text-xs font-medium text-zinc-600">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${input} !border-blue-100 !bg-blue-50/60 focus:!border-blue-500 focus:!ring-blue-500/30`}
                />
              </div>

              {error && <p className="text-xs text-red-600">{error}</p>}
              {notice && <p className="text-xs text-zinc-600">{notice}</p>}

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-full bg-blue-600 px-3 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 transition-all hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50"
              >
                {busy ? "Working…" : mode === "signin" ? "Sign in" : "Sign up"}
              </button>
            </form>

            <div className="my-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-zinc-100" />
              <span className="text-xs text-zinc-400">or</span>
              <span className="h-px flex-1 bg-zinc-100" />
            </div>

            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-3 text-sm font-medium text-zinc-700 transition-colors hover:border-blue-400 hover:text-blue-700 disabled:opacity-50"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.29a12 12 0 0 0 0 10.76l3.98-3.1z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.43A11.98 11.98 0 0 0 1.29 6.62l3.98 3.1C6.22 6.88 8.87 4.77 12 4.77z"
                />
              </svg>
              Continue with Google
            </button>

            <button
              type="button"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
                setNotice(null);
              }}
              className="mt-4 text-left text-xs text-zinc-500 hover:text-blue-600"
            >
              {mode === "signin" ? "No account? Sign up →" : "Have an account? Sign in →"}
            </button>

            <p className="mt-5 text-[11px] leading-relaxed text-zinc-400">
              You stay signed in on this device — no need to log in again. Answering forms
              never requires an account.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
