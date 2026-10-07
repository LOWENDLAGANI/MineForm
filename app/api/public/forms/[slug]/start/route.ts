import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleError, parseBody, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { apiError } from "@/lib/types";
import { issueRecoveryToken } from "@/lib/drafts";
import { isFormClosed } from "@/lib/close";
import { expectDbOk } from "@/lib/db-errors";
import { checkGeoDevice, isLinkExpired, sha256Hex, verifyPassword } from "@/lib/access";

export const dynamic = "force-dynamic";

const StartSchema = z
  .object({
    /** Plaintext password for password-protected forms. */
    password: z.string().max(200).nullable().optional(),
    /** Verified email for unique-email forms (from the verify-email flow). */
    verifiedEmail: z.string().email().max(200).nullable().optional(),
    /** Hidden URL params (UTM etc.) captured by the client. */
    hidden: z.record(z.string().max(300)).optional(),
    locale: z.string().max(8).nullable().optional(),
  })
  .strict();

/**
 * POST /api/public/forms/[slug]/start
 * Creates a response row. Server stamps started_at and (via trigger)
 * expires_at from the form's time_limit_minutes — the client never sends a
 * deadline. Gates (all server-side): published, not closed, under cap, link
 * not expired, password correct, country/device allowed, email verified
 * when the form requires one-response-per-email.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    rateLimit(req, "start", 30);

    const { slug } = await ctx.params;
    const body = await parseBody(req, StartSchema).catch(() => ({}) as z.infer<typeof StartSchema>);
    const supabase = createServiceClient();

    const { data: form } = await supabase
      .from("forms")
      .select("id, is_published, response_cap, time_limit_minutes, close_config, settings, access_config")
      .eq("slug", slug)
      .single();

    if (!form) throw apiError("NOT_FOUND", "Form not found", 404);
    if (!form.is_published) throw apiError("FORM_NOT_PUBLISHED", "Form is not accepting responses", 403);

    // -- Link expiry --------------------------------------------------------
    if (isLinkExpired(form.access_config as Record<string, unknown> | null)) {
      throw apiError("LINK_EXPIRED", "This form link has expired", 403);
    }

    // -- Password gate --------------------------------------------------------
    const ok = await verifyPassword(
      form.access_config as Record<string, unknown> | null,
      body.password ?? null,
    );
    if (!ok) throw apiError("PASSWORD_REQUIRED", "Wrong password", 401);

    // -- Country / device allowlist -------------------------------------------
    const geo = checkGeoDevice(form.access_config as Record<string, unknown> | null, req.headers);
    if (!geo.ok) throw apiError(geo.code!, geo.message ?? "Not available for you", 403);

    // -- Close conditions (date / conditional) — pre-check for a clean error.
    if (await isFormClosed(supabase, form.id, form.close_config)) {
      throw apiError("FORM_CLOSED", "This form is closed", 403);
    }

    // -- One response per verified email ---------------------------------------
    const settings = (form.settings ?? {}) as { unique_email?: boolean; hidden_fields?: string[] };
    const verifiedEmail = body.verifiedEmail?.toLowerCase() ?? null;
    if (settings.unique_email) {
      if (!verifiedEmail) {
        throw apiError("EMAIL_VERIFICATION_REQUIRED", "Verify your email to start", 401);
      }
      const tokenHash = await sha256Hex(verifiedEmail);
      // A verified row for this email must exist (created by verify-email).
      const { data: verRows } = await supabase
        .from("email_verifications")
        .select("id")
        .eq("form_id", form.id)
        .eq("email", verifiedEmail)
        .not("verified_at", "is", null)
        .limit(1);
      if (!verRows || verRows.length === 0) {
        throw apiError("EMAIL_VERIFICATION_REQUIRED", "Verify your email to start", 401);
      }
      void tokenHash;

      const { data: dup } = await supabase
        .from("responses")
        .select("id")
        .eq("form_id", form.id)
        .not("submitted_at", "is", null)
        .eq("respondent_meta->>verified_email", verifiedEmail)
        .limit(1);
      if (dup && dup.length > 0) {
        throw apiError("DUPLICATE_EMAIL", "This email already submitted a response", 409);
      }
    }

    // -- Response cap ------------------------------------------------------------
    const { count } = await supabase
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("form_id", form.id)
      .not("submitted_at", "is", null);

    if (form.response_cap !== null && (count ?? 0) >= form.response_cap) {
      throw apiError("RESPONSE_CAP_REACHED", "This form has reached its response limit", 403);
    }

    // Respondent metadata: hidden fields, country/device (self-reported by
    // server headers), locale, verified email.
    const allowedHidden = new Set(settings.hidden_fields ?? []);
    const hidden: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.hidden ?? {})) {
      if (allowedHidden.has(k)) hidden[k] = String(v).slice(0, 300);
    }

    const meta: Record<string, unknown> = {
      hidden,
      country: req.headers.get("x-vercel-ip-country") ?? null,
      device: /Android|iPhone|iPad|iPod|Mobile/i.test(req.headers.get("user-agent") ?? "") ? "mobile" : "desktop",
    };
    if (verifiedEmail) meta.verified_email = verifiedEmail;
    if (body.locale) meta.locale = body.locale;

    // The DB gate triggers are the authoritative backstop (e.g. a conditional
    // close raced between our pre-check and this insert) — map their
    // exceptions to clean API errors instead of a 500.
    const response = await expectDbOk<{ id: string; started_at: string; expires_at: string | null }>(
      "start:insert response",
      () =>
        supabase
          .from("responses")
          .insert({ form_id: form.id, respondent_meta: meta })
          .select("id, started_at, expires_at")
          .single(),
    );
    if (!response) throw apiError("INTERNAL", "Could not start response", 500);

    const recoveryToken = await issueRecoveryToken(supabase, response.id);

    return NextResponse.json({ response: { ...response, recoveryToken } }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
