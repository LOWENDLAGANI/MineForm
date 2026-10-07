import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/callback?code=... — OAuth (Google) / magic-link return URL.
 *
 * The PKCE code verifier is stored in browser cookies by supabase-js, so the
 * exchange MUST happen on a browser-created anon client (createBrowserClient
 * from @supabase/ssr shares those cookies). We can't do that without the
 * @supabase/ssr package, so instead: bounce the code to the client and let
 * supabase-js detect it via detectSessionInUrl on the landing page.
 *
 * Simpler and correct: redirect to /login?code=... — the browser client on
 * that page exchanges the code automatically (PKCE flow, cookie-stored
 * verifier) and the session persists in localStorage.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  // `next` is attacker-controlled (it rides along OAuth redirect URLs).
  // Only accept same-site, root-relative paths — `//evil.com` and
  // `https://evil.com` resolve off-origin and would turn the OAuth return
  // into a phishing redirect.
  const rawNext = url.searchParams.get("next") ?? "/";
  const safeNext =
    rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\")
      ? rawNext
      : "/";

  const target = new URL(code ? "/login" : safeNext, url.origin);
  if (target.origin !== url.origin) target.href = `${url.origin}/`;
  if (code) target.searchParams.set("code", code);
  return NextResponse.redirect(target);
}
