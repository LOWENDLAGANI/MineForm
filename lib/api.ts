import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type output } from "zod";
import { ApiErrorFactory } from "@/lib/types";

/**
 * Shared helpers for App Router route handlers.
 * Every failure returns the ApiError envelope; every success returns JSON.
 */

export function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function handleError(err: unknown) {
  if (err instanceof ApiErrorFactory) {
    return jsonError(err.code, err.message, err.status);
  }
  if (err instanceof ZodError) {
    return jsonError("VALIDATION_ERROR", err.issues[0]?.message ?? "Invalid payload", 422);
  }
  console.error("[api]", err);
  return jsonError("INTERNAL", "Internal server error", 500);
}

export async function parseBody<S extends ZodTypeAny>(
  req: NextRequest,
  schema: S,
): Promise<output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiErrorFactory("VALIDATION_ERROR", "Body must be valid JSON", 400);
  }
  return schema.parse(raw);
}

/** RFC 4122 v4 parse — cheap guard before the DB ever sees a uuid. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function assertUuid(value: string, label = "id"): string {
  if (!UUID_RE.test(value)) {
    throw new ApiErrorFactory("VALIDATION_ERROR", `Invalid ${label}`, 400);
  }
  return value;
}

/**
 * Naive fixed-window rate limiter keyed by IP.
 * Good enough at the edge; swap for Upstash/Redis if a route gets hammered.
 *
 * Security: buckets are evicted on expiry and the map is capped — a client
 * rotating spoofed x-forwarded-for values can neither exhaust memory nor
 * bypass the limit indefinitely.
 */
const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

function pruneBuckets(now: number) {
  for (const [k, b] of buckets) {
    if (now > b.resetAt) buckets.delete(k);
  }
}

export function rateLimit(req: NextRequest, key: string, limit: number): void {
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const bucketKey = `${key}:${ip}`;
  const now = Date.now();

  if (buckets.size > MAX_BUCKETS) pruneBuckets(now);

  const bucket = buckets.get(bucketKey);

  if (!bucket || now > bucket.resetAt) {
    // Hard cap: drop the oldest entry when full (renewal under attack).
    if (!bucket && buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest) buckets.delete(oldest);
    }
    buckets.set(bucketKey, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    throw new ApiErrorFactory("RATE_LIMITED", "Too many requests. Try again shortly.", 429);
  }
}
