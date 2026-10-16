import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleError, parseBody, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { apiError } from "@/lib/types";
import { getWaitingRoomConfig, getWaitingQueue, getSessionBySessionId, leaveWaitingRoom, getQueuePosition, getActiveUserCount } from "@/lib/waiting-room";

export const dynamic = "force-dynamic";

const CheckSchema = z.object({
  sessionId: z.string().max(100).nullable().optional(),
}).strict();

/**
 * GET /api/public/forms/[slug]/waiting-room
 * Returns the current waiting room status for the form.
 * No auth required - anonymous access for respondents.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    rateLimit(req, "waiting-room:check", 30);

    const { slug } = await ctx.params;

    // Load the form to get its ID
    const { data: form } = await createServiceClient()
      .from("forms")
      .select("id, response_cap")
      .eq("slug", slug)
      .single();

    if (!form) {
      throw apiError("NOT_FOUND", "Form not found", 404);
    }

    const config = getWaitingRoomConfig(form.id);
    const queue = getWaitingQueue(form.id);
    const activeCount = getActiveUserCount(form.id);

    // Get submitted count from Supabase
    let submittedCount = 0;
    if (form.response_cap !== null) {
      const { count } = await createServiceClient()
        .from("responses")
        .select("id", { count: "exact", head: true })
        .eq("form_id", form.id)
        .not("submitted_at", "is", null);
      submittedCount = count ?? 0;
    }

    const totalActive = submittedCount + activeCount;
    const spotsLeft = Math.max(0, (form.response_cap ?? 0) - totalActive);

    return NextResponse.json({
      enabled: config.enabled,
      maxActive: config.maxActive,
      activeCount,
      submittedCount,
      totalActive,
      spotsLeft,
      queueLength: queue.length,
      waitingRoomOpen: config.enabled && spotsLeft === 0 && queue.length > 0,
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/public/forms/[slug]/waiting-room
 * Actions: leave the waiting room, or check queue position.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    rateLimit(req, "waiting-room:action", 30);

    const { slug } = await ctx.params;
    const body = await parseBody(req, CheckSchema).catch(() => ({ sessionId: null as string | null | undefined }));

    const { data: form } = await createServiceClient()
      .from("forms")
      .select("id, response_cap")
      .eq("slug", slug)
      .single();

    if (!form) {
      throw apiError("NOT_FOUND", "Form not found", 404);
    }

    const sessionId = body.sessionId ?? null;

    if (sessionId) {
      // User wants to leave the waiting room
      const left = leaveWaitingRoom(form.id, sessionId);
      if (!left) {
        // Not in queue - might have been admitted already or never joined
        return NextResponse.json({ left: false, message: "Not in waiting room" });
      }

      return NextResponse.json({ left: true });
    }

    // Just checking queue status
    const config = getWaitingRoomConfig(form.id);
    const queue = getWaitingQueue(form.id);
    const activeCount = getActiveUserCount(form.id);

    return NextResponse.json({
      enabled: config.enabled,
      maxActive: config.maxActive,
      activeCount,
      queueLength: queue.length,
    });
  } catch (err) {
    return handleError(err);
  }
}
