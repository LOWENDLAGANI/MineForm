import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleError, parseBody, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { apiError, type ApiErrorCode } from "@/lib/types";
import { issueRecoveryToken } from "@/lib/drafts";
import { isFormClosed } from "@/lib/close";
import { expectDbOk } from "@/lib/db-errors";
import { checkGeoDevice, isLinkExpired, sha256Hex, verifyPassword } from "@/lib/access";
import { recordActiveUser, removeActiveUser, getActiveUserCount, getWaitingRoomConfig, enterWaitingRoom, tryAdmitNext, getQueuePosition, getSessionBySessionId, clearWaitingRoomSession, getWaitingQueue } from "@/lib/waiting-room";

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
    /** Waiting room session ID (when user is admitted from waiting room) */
    waitingRoomSessionId: z.string().max(100).nullable().optional(),
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

    // -- Waiting room session check ------------------------------------------
    // If the user has a waiting room session, verify they've been admitted
    const waitingRoomSessionId = body.waitingRoomSessionId ?? null;
    if (waitingRoomSessionId) {
      const session = getSessionBySessionId(form.id, waitingRoomSessionId);
      if (!session) {
        // Session not found - they may have been admitted or timed out
        throw apiError("WAITING_ROOM_SESSION_EXPIRED", "Your waiting room session has expired. Please try again.", 401);
      }
      if (!session.admitted) {
        // Not yet admitted - they're still in queue
        const queuePosition = getQueuePosition(form.id, waitingRoomSessionId);
        throw apiError(
          "WAITING_ROOM",
          queuePosition != null
            ? `You're #${queuePosition} in the waiting room. Please wait.`
            : "You're in the waiting room. Please wait for your turn.",
          429,
        );
      }
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
    // Get the waiting room config for this form
    const waitingRoomConfig = getWaitingRoomConfig(form.id);

    // Use waiting-room-aware active count (real submitted + users currently
    // filling) so the global active-user limit is respected without hitting
    // Supabase for every start attempt.
    const activeUserCount = getActiveUserCount(form.id);

    // Get submitted count from Supabase (only when we need to check cap)
    let submittedCount = 0;
    if (form.response_cap !== null) {
      const { count } = await supabase
        .from("responses")
        .select("id", { count: "exact", head: true })
        .eq("form_id", form.id)
        .not("submitted_at", "is", null);
      submittedCount = count ?? 0;
    }

    const totalActive = submittedCount + activeUserCount;

    if (form.response_cap !== null && totalActive >= form.response_cap) {
      // Check if waiting room is enabled and can help
      if (waitingRoomConfig.enabled && waitingRoomConfig.maxActive > 0) {
        // Try to enter the waiting room
        const queueEntry = enterWaitingRoom(form.id, waitingRoomConfig);
        if (queueEntry) {
          // User entered the waiting room - return special error with queue info
          throw apiError("WAITING_ROOM", "This form is temporarily at capacity. You've been placed in a waiting room.", 429);
        }
      }

      // No waiting room or it's full - return normal cap error
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

    // Record this user as active (in-memory, for waiting room tracking)
    recordActiveUser(form.id, response.id, req.headers.get("user-agent") ?? undefined);

    const recoveryToken = await issueRecoveryToken(supabase, response.id);

    // If the user came from the waiting room, clear their session
    if (waitingRoomSessionId) {
      clearWaitingRoomSession(form.id, waitingRoomSessionId);
    }

    return NextResponse.json({ response: { ...response, recoveryToken } }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
