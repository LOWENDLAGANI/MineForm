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
  const next = url.searchParams.get("next") ?? "/";

  const target = new URL(code ? "/login" : next, url.origin);
  if (code) target.searchParams.set("code", code);
  return NextResponse.redirect(target);
}
