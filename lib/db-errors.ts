/**
 * Utility that wraps Supabase PostgREST calls and translates DB trigger
 * exceptions (RAISE EXCEPTION 'CODE') into typed ApiErrorFactory instances.
 * Trigger errors arrive as PostgREST error codes like
 * "P0001: RESPONSE_CAP_REACHED" (via `details`/`message`).
 */
import { apiError } from "./types";
import type { ApiErrorCode } from "./types";

const TRIGGER_CODES = [
  "FORM_NOT_PUBLISHED",
  "FORM_CLOSED",
  "RESPONSE_CAP_REACHED",
  "RESPONSE_EXPIRED",
  "PAYMENT_REQUIRED",
  "ANSWER_FORM_MISMATCH",
] as const;

/** DB trigger codes mapped onto the public ApiErrorCode union. */
const CODE_MAP: Record<TriggerCode, ApiErrorCode> = {
  FORM_NOT_PUBLISHED: "FORM_NOT_PUBLISHED",
  FORM_CLOSED: "FORM_CLOSED",
  RESPONSE_CAP_REACHED: "RESPONSE_CAP_REACHED",
  RESPONSE_EXPIRED: "RESPONSE_EXPIRED",
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
  ANSWER_FORM_MISMATCH: "VALIDATION_ERROR",
};

const MESSAGES: Record<keyof typeof CODE_MAP, { message: string; status: number }> = {
  FORM_NOT_PUBLISHED: { message: "Form is not accepting responses", status: 403 },
  FORM_CLOSED: { message: "This form is closed", status: 403 },
  RESPONSE_CAP_REACHED: { message: "This form has reached its response limit", status: 403 },
  RESPONSE_EXPIRED: { message: "Time limit exceeded", status: 403 },
  PAYMENT_REQUIRED: { message: "Complete payment before submitting", status: 402 },
  ANSWER_FORM_MISMATCH: { message: "Answer does not belong to this form", status: 400 },
};

type TriggerCode = (typeof TRIGGER_CODES)[number];

/** Extract a known trigger code from a PostgREST error, if any. */
function matchTriggerCode(err: unknown): TriggerCode | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { message?: unknown; details?: unknown; hint?: unknown };
  const haystack = [e.message, e.details, e.hint]
    .filter((s): s is string => typeof s === "string")
    .join(" | ");
  return TRIGGER_CODES.find((code) => haystack.includes(code)) ?? null;
}

/**
 * Run a Supabase query and throw the mapped ApiErrorFactory when the DB
 * rejected the write with a gate-trigger exception.
 */
export async function expectDbOk<T>(
  op: string,
  fn: () => PromiseLike<{ data: T | null; error: { message: string; details?: string | null; hint?: string | null } | null }>,
): Promise<T> {
  const { data, error } = await fn();
  if (!error) {
    if (data === null) {
      throw new Error(`[db] ${op} returned no data and no error`);
    }
    return data;
  }
  const code = matchTriggerCode(error);
  if (code) {
    const m = MESSAGES[code];
    throw apiError(CODE_MAP[code], m.message, m.status);
  }
  throw error;
}
