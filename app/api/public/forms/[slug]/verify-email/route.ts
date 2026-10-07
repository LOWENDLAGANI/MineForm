import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleError, parseBody, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { apiError } from "@/lib/types";
import { sha256Hex } from "@/lib/access";
import { sendVerificationEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  email: z.string().email().max(200),
  /** When present, confirms a token from the email link instead of sending one. */
  token: z.string().max(200).optional(),
});

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * POST /api/public/forms/[slug]/verify-email
 *  - { email }                → create + email a verification link
 *  - { email, token }         → confirm the link, mark verified
 * Without RESEND_API_KEY the verification auto-approves (duplicate-email
 * protection still applies at start/submit) and the API says so, so the
 * form never becomes unusable just because email is unconfigured.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    rateLimit(req, "verify-email", 10);
    const { slug } = await ctx.params;
    const body = await parseBody(req, RequestSchema);
    const supabase = createServiceClient();

    const { data: form } = await supabase
      .from("forms")
      .select("id, title, is_published, settings")
      .eq("slug", slug)
      .single();
    if (!form || !form.is_published) throw apiError("NOT_FOUND", "Form not found", 404);

    const settings = (form.settings ?? {}) as { unique_email?: boolean };
    if (!settings.unique_email) {
      throw apiError("VALIDATION_ERROR", "This form doesn't require email verification", 400);
    }

    const email = body.email.toLowerCase();

    // Confirming a token from the email link.
    if (body.token) {
      const tokenHash = await sha256Hex(body.token);
      const { data: row } = await supabase
        .from("email_verifications")
        .select("id, email, verified_at")
        .eq("form_id", form.id)
        .eq("token_hash", tokenHash)
        .maybeSingle();

      if (!row) throw apiError("VALIDATION_ERROR", "This verification link is invalid or was already used", 400);

      if (!row.verified_at) {
        await supabase
          .from("email_verifications")
          .update({ verified_at: new Date().toISOString() })
          .eq("id", row.id);
      }

      // A second token for the same email may exist (retry) — approve all
      // unverified rows for this email so either link works.
      await supabase
        .from("email_verifications")
        .update({ verified_at: new Date().toISOString() })
        .eq("form_id", form.id)
        .eq("email", row.email)
        .is("verified_at", null);

      return NextResponse.json({ verified: true, email: row.email });
    }

    // Requesting a verification link.
    const token = generateToken();
    const tokenHash = await sha256Hex(token);

    // Has this email already submitted? Tell them now, not after the quiz.
    const { data: existing } = await supabase
      .from("responses")
      .select("id")
      .eq("form_id", form.id)
      .not("submitted_at", "is", null)
      .eq("respondent_meta->>verified_email", email)
      .limit(1);
    if (existing && existing.length > 0) {
      throw apiError("DUPLICATE_EMAIL", "This email already submitted a response", 409);
    }

    await supabase.from("email_verifications").insert({
      form_id: form.id,
      email,
      token_hash: tokenHash,
    });

    const origin = req.headers.get("origin") ?? new URL(req.url).origin;
    const verifyUrl = `${origin}/f/${slug}?ev=${encodeURIComponent(token)}`;

    const sent = await sendVerificationEmail({ to: email, verifyUrl, formTitle: form.title });
    if (!sent) {
      // No email provider configured (free tier without Resend): auto-approve
      // so the form stays usable, and dedupe still applies by email.
      return NextResponse.json({
        verified: true,
        email,
        autoApproved: true,
        message: "Email delivery isn't configured for this form — you can continue right away.",
      });
    }

    return NextResponse.json({ verified: false, email, message: "Check your inbox for a verification link." });
  } catch (err) {
    return handleError(err);
  }
}
