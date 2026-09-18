"use client";

/**
 * Draft autosave — browser localStorage only, keyed by form slug + response
 * id. The draft is deleted immediately after a successful submission and
 * whenever the user discards it. Values only (no PII beyond what the user
 * typed); the server-side recovery token handles cross-device resume.
 */

export interface StoredDraft {
  responseId: string;
  recoveryToken: string | null;
  /** QuestionId -> raw field value. */
  values: Record<string, unknown>;
  savedAt: string;
}

const PREFIX = "mineform:draft:";

function key(slug: string): string {
  return `${PREFIX}${slug}`;
}

export function loadLocalDraft(slug: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(key(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (!parsed || typeof parsed.responseId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLocalDraft(
  slug: string,
  draft: Omit<StoredDraft, "savedAt">,
): void {
  try {
    window.localStorage.setItem(
      key(slug),
      JSON.stringify({ ...draft, savedAt: new Date().toISOString() }),
    );
  } catch {
    // Storage full / private mode — autosave is best-effort.
  }
}

export function clearLocalDraft(slug: string): void {
  try {
    window.localStorage.removeItem(key(slug));
  } catch {
    // ignore
  }
}
