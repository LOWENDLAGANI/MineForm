"use client";

/**
 * Public form renderer — respondent view. Loads a published form by slug,
 * starts a response (server stamps the quiz deadline), renders visible
 * questions with FieldRenderer, and submits through the gated public API.
 * Mobile-first: large touch targets, sticky timer bar, clear progress.
 *
 * Renderer modes: "classic" (all questions on one page) and "conversational"
 * (one question per screen with animations).
 *
 * Save-and-resume:
 *  - Local autosave: every answer change is mirrored to localStorage and
 *    deleted right after successful submission.
 *  - "Save & finish later": stores partial answers server-side and returns a
 *    recovery link (works across devices; ?resume=<token> reloads it).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { FieldRenderer } from "@/components/renderer/FieldRenderer";
import { ConversationalForm } from "@/components/renderer/ConversationalForm";
import { resolveVisibility, validateAnswers } from "@/lib/logic";
import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from "@/lib/local-draft";
import type { Question } from "@/lib/types";
import type { AnswerPayload } from "@/lib/types";

interface PublicForm {
  id: string;
  title: string;
  description: string | null;
  time_limit_minutes: number | null;
  response_cap: number | null;
  renderer_mode: "classic" | "conversational";
  submitted_count: number;
  is_capped: boolean;
  is_closed: boolean;
  close_at: string | null;
}

type FieldValue = string | string[] | number | null;

function normalizeAnswer(q: Question, value: FieldValue): AnswerPayload | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return { questionId: q.id, json: value };
  }
  if (typeof value === "number") {
    return { questionId: q.id, json: value };
  }
  if (q.question_type === "single_choice" || q.question_type === "dropdown" || q.question_type === "rating") {
    return { questionId: q.id, json: value };
  }
  return { questionId: q.id, text: value };
}

/** Restore raw field values from draft answer payloads. */
function hydrateValues(questions: Question[], answers: AnswerPayload[]): Record<string, FieldValue> {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const out: Record<string, FieldValue> = {};
  for (const a of answers) {
    const q = byId.get(a.questionId);
    if (!q) continue;
    if (a.text !== undefined && a.text !== null) {
      out[a.questionId] = a.text;
    } else if (a.json !== undefined && a.json !== null) {
      out[a.questionId] =
        q.question_type === "rating" || q.question_type === "number"
          ? Number(a.json)
          : (a.json as FieldValue);
    }
  }
  return out;
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function PublicFormPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const slug = params.slug;
  const resumeToken = searchParams.get("resume");

  const [form, setForm] = useState<PublicForm | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [responseId, setResponseId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const submittedRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);

  // Save-&-finish-later state
  const [savedLink, setSavedLink] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftCopied, setDraftCopied] = useState(false);
  const [resumedDraft, setResumedDraft] = useState(false);

  // Load published form definition
  useEffect(() => {
    fetch(`/api/public/forms/${slug}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("This form doesn't exist or is no longer available.");
        return res.json();
      })
      .then((d) => {
        setForm(d.form);
        setQuestions(d.questions ?? []);
      })
      .catch((e) => setLoadError(e.message));
  }, [slug]);

  // Resume from a recovery link BEFORE offering the start screen
  useEffect(() => {
    if (!resumeToken || questions.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/public/forms/${slug}/resume?token=${encodeURIComponent(resumeToken)}`);
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          if (!cancelled) {
            setLoadError(
              body?.error?.message === "This response was already submitted"
                ? "This draft was already submitted."
                : "This recovery link is no longer valid.",
            );
          }
          return;
        }
        if (cancelled) return;
        setResponseId(body.responseId);
        setExpiresAt(body.expiresAt ?? null);
        setValues(hydrateValues(questions, body.answers ?? []));
        setResumedDraft(true);
        // Clean the URL so a refresh doesn't re-fetch the draft forever.
        window.history.replaceState(null, "", window.location.pathname);
      } catch {
        if (!cancelled) setLoadError("Could not restore your draft.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeToken, questions, slug]);

  // Quiz timer countdown (server deadline, client displays)
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setRemaining(ms > 0 ? Math.floor(ms / 1000) : 0);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const answersByQuestionId = useMemo(() => {
    const map: Record<string, unknown> = {};
    for (const [qid, v] of Object.entries(values)) map[qid] = v;
    return map;
  }, [values]);

  const visibility = useMemo(
    () => (questions.length > 0 ? resolveVisibility(questions, answersByQuestionId) : null),
    [questions, answersByQuestionId],
  );

  const isVisible = useCallback(
    (q: Question) => (visibility ? visibility.get(q.id) !== false : true),
    [visibility],
  );

  const visibleQuestions = useMemo(
    () => questions.filter(isVisible),
    [questions, isVisible],
  );

  const answeredCount = useMemo(
    () =>
      visibleQuestions.filter((q) => {
        const v = values[q.id];
        if (v === null || v === undefined || v === "") return false;
        if (Array.isArray(v)) return v.length > 0;
        return true;
      }).length,
    [visibleQuestions, values],
  );

  const requiredMissing = useMemo(
    () =>
      visibleQuestions.filter((q) => {
        if (!q.is_required) return false;
        const v = values[q.id];
        const empty =
          v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
        return empty;
      }),
    [visibleQuestions, values],
  );

  const hasAnyAnswer = answeredCount > 0;

  // --- Local autosave (debounced) -----------------------------------------
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responseIdRef = useRef<string | null>(null);
  responseIdRef.current = responseId;

  useEffect(() => {
    if (!responseId || !hasAnyAnswer || submittedRef.current) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      // Guard again inside the callback: a submit may have completed while
      // this debounce was pending — never resurrect a cleared draft.
      if (submittedRef.current) return;
      saveLocalDraft(slug, {
        responseId,
        recoveryToken: null,
        values: { ...values },
      });
    }, 500);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [values, responseId, slug, hasAnyAnswer]);

  // Offer restoring a local draft once, on first render after questions load
  const [localDraftPrompt, setLocalDraftPrompt] = useState<Record<string, FieldValue> | null>(null);
  // localStorage drafts store raw JSON values; coerce back to FieldValue.
  const coerceDraftValues = (raw: Record<string, unknown>): Record<string, FieldValue> => {
    const out: Record<string, FieldValue> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v === null || typeof v === "string" || typeof v === "number") out[k] = v;
      else if (Array.isArray(v)) out[k] = v.map(String);
    }
    return out;
  };
  useEffect(() => {
    if (!form || responseId || resumeToken) return;
    const draft = loadLocalDraft(slug);
    if (draft && Object.keys(draft.values).length > 0) {
      setLocalDraftPrompt(coerceDraftValues(draft.values));
    }
  }, [form, slug, responseId, resumeToken]);

  const start = useCallback(
    async (withDraftValues?: Record<string, FieldValue>) => {
      setStarting(true);
      try {
        const res = await fetch(`/api/public/forms/${slug}/start`, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setLoadError(body?.error?.message ?? "Could not start this form. Please try again.");
          return;
        }
        const body = await res.json();
        setResponseId(body.response.id);
        setExpiresAt(body.response.expires_at ?? null);
        if (withDraftValues) {
          setValues(withDraftValues);
          setLocalDraftPrompt(null);
        }
      } finally {
        setStarting(false);
      }
    },
    [slug],
  );

  /** Save & finish later — persist partial answers server-side, show link. */
  async function saveAndFinishLater() {
    if (!responseId) return;
    setSavingDraft(true);
    setSubmitError(null);
    try {
      const answers = questions
        .map((q) => normalizeAnswer(q, values[q.id] ?? null))
        .filter((a): a is AnswerPayload => a !== null);

      const res = await fetch(`/api/public/forms/${slug}/save-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responseId, answers }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setSubmitError(body?.error?.message ?? "Could not save your progress.");
        return;
      }
      setSavedLink(body.recoveryUrl);
      // Keep the local draft in sync with the server draft's response id.
      saveLocalDraft(slug, { responseId, recoveryToken: body.recoveryToken, values: { ...values } });
    } finally {
      setSavingDraft(false);
    }
  }

  async function submit() {
    if (!responseId) return;
    setSubmitError(null);

    // Client-side validation first — instant feedback, no server round-trip.
    const answers = visibleQuestions
      .map((q) => normalizeAnswer(q, values[q.id] ?? null))
      .filter((a): a is AnswerPayload => a !== null);

    const issues = validateAnswers(questions, answers, visibility ?? new Map());
    if (issues.length > 0) {
      setErrors(
        Object.fromEntries(
          issues
            .filter((i, idx, arr) => arr.findIndex((x) => x.questionId === i.questionId) === idx)
            .map((i) => [i.questionId, i.message]),
        ),
      );
      setSubmitError("Some answers need attention below.");
      // Scroll to the first problem question.
      const first = document.querySelector("[data-has-error='true']");
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/forms/${slug}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responseId, answers }),
      });
      if (res.ok) {
        // Draft cleanup: local autosave is deleted immediately after a
        // successful submission, and the server-side recovery link is
        // invalidated by the submit endpoint itself.
        submittedRef.current = true;
        if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
        clearLocalDraft(slug);
        setSubmitted(true);
        window.scrollTo({ top: 0 });
        return;
      }
      const body = await res.json().catch(() => null);
      const msg: string = body?.error?.message ?? "Submission failed. Please try again.";
      if (res.status === 422) {
        setErrors(
          Object.fromEntries(visibleQuestions.map((q) => [q.id, "Please check this answer"])),
        );
        setSubmitError("Some answers need attention below.");
        return;
      }
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // --- States ------------------------------------------------------------

  if (loadError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <div className="rounded-lg border border-zinc-200 p-6 text-center">
          <p className="text-sm font-medium text-zinc-900">Can't open this form</p>
          <p className="mt-2 text-sm text-zinc-500">{loadError}</p>
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <div className="rounded-lg border border-zinc-200 p-8 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-zinc-900 text-xl">
            ✓
          </div>
          <p className="mt-4 text-base font-medium text-zinc-900">Response submitted</p>
          <p className="mt-1 text-sm text-zinc-500">Thanks — you can close this page now.</p>
        </div>
      </main>
    );
  }

  if (!form) {
    return (
      <main className="mx-auto max-w-md px-5 py-20">
        <p className="text-center text-sm text-zinc-400">Loading…</p>
      </main>
    );
  }

  if (form.is_closed || form.is_capped) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <div className="rounded-lg border border-zinc-200 p-6 text-center">
          <p className="text-sm font-medium text-zinc-900">This form is closed</p>
          <p className="mt-2 text-sm text-zinc-500">
            {form.is_capped
              ? `It has reached its limit of ${form.response_cap} responses.`
              : "It is no longer accepting responses."}
          </p>
        </div>
      </main>
    );
  }

  const expired = remaining === 0;

  // --- Landing / start screen ----------------------------------------------

  if (!responseId) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-10">
        <div>
          <h1 className="text-xl font-medium text-zinc-900">{form.title}</h1>
          {form.description && (
            <p className="mt-2 text-sm text-zinc-500">{form.description}</p>
          )}

          <div className="mt-6 space-y-2 rounded-lg border border-zinc-200 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Questions</span>
              <span className="font-medium text-zinc-900">{questions.length}</span>
            </div>
            {form.time_limit_minutes && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Time limit</span>
                <span className="font-medium text-zinc-900">{form.time_limit_minutes} min</span>
              </div>
            )}
            {form.response_cap !== null && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Spots left</span>
                <span className="font-medium text-zinc-900">
                  {Math.max(0, form.response_cap - form.submitted_count)}
                </span>
              </div>
            )}
          </div>

          {localDraftPrompt && (
            <div className="mt-4 rounded-lg border border-zinc-300 bg-zinc-50 p-4">
              <p className="text-sm font-medium text-zinc-900">Welcome back</p>
              <p className="mt-1 text-xs text-zinc-500">
                You have unsaved answers on this device from your last visit.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => start(localDraftPrompt)}
                  disabled={starting}
                  className="flex-1 rounded-md bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  Continue where I left off
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearLocalDraft(slug);
                    setLocalDraftPrompt(null);
                  }}
                  className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-600 hover:border-zinc-900"
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {form.time_limit_minutes && (
            <p className="mt-3 text-xs text-zinc-500">
              ⏱ The timer starts as soon as you tap the button below.
            </p>
          )}
          {!form.time_limit_minutes && (
            <p className="mt-3 text-xs text-zinc-500">
              Your progress is saved automatically on this device — you can finish later.
            </p>
          )}

          <button
            type="button"
            onClick={() => start()}
            disabled={starting}
            className="mt-6 w-full rounded-lg bg-zinc-900 px-4 py-4 text-base font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {starting
              ? "Starting…"
              : form.time_limit_minutes
                ? "Start timed form"
                : "Start"}
          </button>
        </div>
      </main>
    );
  }

  // --- Expired ---------------------------------------------------------------

  if (expired) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <div className="rounded-lg border border-zinc-200 p-6 text-center">
          <p className="text-sm font-medium text-red-600">Time's up</p>
          <p className="mt-2 text-sm text-zinc-500">
            This response can no longer be submitted because the time limit ran out.
          </p>
        </div>
      </main>
    );
  }

  const lowTime = remaining !== null && remaining <= 60;
  const accent = "#18181b";

  const footer = (
    <div className="space-y-2">
      {submitError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-center text-sm text-red-700" role="alert">
          {submitError}
        </p>
      )}
      {savedLink && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-left">
          <p className="text-xs font-medium text-emerald-800">Progress saved ✓</p>
          <p className="mt-1 break-all font-mono text-[11px] text-emerald-700">{savedLink}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(savedLink);
                  setDraftCopied(true);
                  setTimeout(() => setDraftCopied(false), 2000);
                } catch {
                  // Clipboard unavailable — the link is visible above.
                }
              }}
              className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-800"
            >
              {draftCopied ? "Copied!" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={() => setSavedLink(null)}
              className="rounded-md border border-emerald-300 px-2.5 py-1 text-xs text-emerald-800 hover:border-emerald-700"
            >
              Keep answering
            </button>
          </div>
        </div>
      )}
      {!savedLink && hasAnyAnswer && (
        <button
          type="button"
          onClick={saveAndFinishLater}
          disabled={savingDraft}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 disabled:opacity-50"
        >
          {savingDraft ? "Saving…" : "Save & finish later"}
        </button>
      )}
    </div>
  );

  // --- Conversational mode ---------------------------------------------------

  if (form.renderer_mode === "conversational") {
    return (
      <ConversationalForm
        title={form.title}
        description={form.description}
        questions={visibleQuestions}
        values={values}
        errors={errors}
        disabled={submitting}
        accent={accent}
        onChange={(qid, v) => {
          setValues((s) => ({ ...s, [qid]: v }));
          setErrors((s) => {
            if (!s[qid]) return s;
            const next = { ...s };
            delete next[qid];
            return next;
          });
        }}
        onSubmit={submit}
        submitting={submitting}
        footer={footer}
      />
    );
  }

  // --- Classic mode -----------------------------------------------------------

  return (
    <div className="min-h-screen pb-28 sm:pb-10">
      {/* Sticky header with progress + timer */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-md px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="min-w-0 truncate text-sm font-medium text-zinc-900">
              {form.title}
            </h1>
            {form.time_limit_minutes && (
              <span
                className={`shrink-0 rounded-md px-2.5 py-1 font-mono text-sm font-medium ${
                  lowTime
                    ? "bg-red-600 text-white"
                    : "bg-zinc-100 text-zinc-900"
                }`}
                aria-live={lowTime ? "assertive" : undefined}
              >
                {remaining === null ? "—" : formatTime(remaining)}
              </span>
            )}
          </div>
          {/* Progress */}
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-zinc-900 transition-all"
                style={{
                  width:
                    visibleQuestions.length === 0
                      ? "0%"
                      : `${Math.round((answeredCount / visibleQuestions.length) * 100)}%`,
                }}
              />
            </div>
            <span className="font-mono text-xs text-zinc-400">
              {answeredCount}/{visibleQuestions.length}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md px-5 pt-4">
        {form.description && (
          <p className="mb-2 text-sm text-zinc-500">{form.description}</p>
        )}
        {resumedDraft && (
          <div className="mb-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800" role="status">
            Draft restored — your previous answers are loaded below.
          </div>
        )}
        {submitError && (
          <div className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {submitError}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {visibleQuestions.map((q, i) => (
            <FieldRenderer
              key={q.id}
              question={q}
              index={i}
              value={values[q.id] ?? null}
              error={errors[q.id] ?? null}
              disabled={submitting}
              onChange={(v) => {
                setValues((s) => ({ ...s, [q.id]: v }));
                // Clear the question's error as soon as the user interacts.
                setErrors((s) => {
                  if (!s[q.id]) return s;
                  const next = { ...s };
                  delete next[q.id];
                  return next;
                });
              }}
            />
          ))}

          {requiredMissing.length > 0 && (
            <p className="text-xs text-zinc-400">
              {requiredMissing.length} required question
              {requiredMissing.length > 1 ? "s" : ""} left to answer
            </p>
          )}

          {/* Sticky-ish submit area */}
          <div className="mt-6">
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-zinc-900 px-4 py-4 text-base font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit answers"}
            </button>

            {footer}
          </div>
        </form>
      </main>
    </div>
  );
}
