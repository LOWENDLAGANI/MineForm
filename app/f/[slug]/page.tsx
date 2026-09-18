"use client";

/**
 * Public form renderer — respondent view. Loads a published form by slug,
 * starts a response (server stamps the quiz deadline), renders visible
 * questions with FieldRenderer, and submits through the gated public API.
 *
 * Visual language: white card floating on the blue diagonal brand backdrop,
 * blue accents. Mobile-first: the card fills the viewport edge-to-edge with a
 * small gutter; the submit bar docks to the bottom.
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

const ACCENT = "#2563eb"; // blue-600

/* Full-viewport message states share one centered white card. */
function StateCard({
  icon,
  title,
  body,
  children,
}: {
  icon: string;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="card-in w-full max-w-md rounded-2xl bg-white p-7 text-center shadow-xl shadow-blue-950/20">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-blue-50 text-2xl">
          {icon}
        </div>
        <p className="mt-4 text-base font-semibold text-zinc-900">{title}</p>
        {body && <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{body}</p>}
        {children}
      </div>
    </main>
  );
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
  useEffect(() => {
    if (!form || responseId || resumeToken) return;
    const draft = loadLocalDraft(slug);
    if (draft && Object.keys(draft.values).length > 0) {
      // localStorage drafts store raw JSON values; coerce back to FieldValue.
      const out: Record<string, FieldValue> = {};
      for (const [k, v] of Object.entries(draft.values)) {
        if (v === null || typeof v === "string" || typeof v === "number") out[k] = v;
        else if (Array.isArray(v)) out[k] = v.map(String);
      }
      setLocalDraftPrompt(out);
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
      <div className="brand-backdrop">
        <StateCard
          icon="⚠️"
          title="Can't open this form"
          body={loadError}
        />
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="brand-backdrop">
        <StateCard
          icon="✓"
          title="Response submitted"
          body="Thanks — you can close this page now."
        />
      </div>
    );
  }

  if (!form) {
    return (
      <div className="brand-backdrop">
        <main className="flex min-h-dvh items-center justify-center">
          <div className="flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm text-white backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            Loading…
          </div>
        </main>
      </div>
    );
  }

  if (form.is_closed || form.is_capped) {
    return (
      <div className="brand-backdrop">
        <StateCard
          icon="🔒"
          title="This form is closed"
          body={
            form.is_capped
              ? `It has reached its limit of ${form.response_cap} responses.`
              : "It is no longer accepting responses."
          }
        />
      </div>
    );
  }

  const expired = remaining === 0;

  // --- Landing / start screen ----------------------------------------------

  if (!responseId) {
    return (
      <div className="brand-backdrop">
        <main className="flex min-h-dvh items-center justify-center px-4 py-10">
          <div className="card-in w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl shadow-blue-950/20">
            {/* Dark header band, like the reference */}
            <div className="bg-slate-800 px-6 py-4">
              <h1 className="truncate text-base font-semibold text-white">{form.title}</h1>
            </div>

            <div className="px-6 py-6">
              {form.description && (
                <p className="text-sm leading-relaxed text-zinc-500">{form.description}</p>
              )}

              <div className="mt-5 space-y-2.5">
                <div className="flex items-center justify-between rounded-lg bg-blue-50/70 px-3.5 py-2.5 text-sm">
                  <span className="text-zinc-500">Questions</span>
                  <span className="font-semibold text-zinc-900">{questions.length}</span>
                </div>
                {form.time_limit_minutes && (
                  <div className="flex items-center justify-between rounded-lg bg-blue-50/70 px-3.5 py-2.5 text-sm">
                    <span className="text-zinc-500">Time limit</span>
                    <span className="font-semibold text-zinc-900">{form.time_limit_minutes} min</span>
                  </div>
                )}
                {form.response_cap !== null && (
                  <div className="flex items-center justify-between rounded-lg bg-blue-50/70 px-3.5 py-2.5 text-sm">
                    <span className="text-zinc-500">Spots left</span>
                    <span className="font-semibold text-zinc-900">
                      {Math.max(0, form.response_cap - form.submitted_count)}
                    </span>
                  </div>
                )}
              </div>

              {localDraftPrompt && (
                <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/70 p-4">
                  <p className="text-sm font-semibold text-zinc-900">Welcome back</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    You have answers on this device from your last visit.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => start(localDraftPrompt)}
                      disabled={starting}
                      className="flex-1 rounded-full bg-blue-600 px-3 py-2.5 text-xs font-semibold text-white shadow-sm shadow-blue-600/30 hover:bg-blue-700 disabled:opacity-50"
                    >
                      Continue where I left off
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        clearLocalDraft(slug);
                        setLocalDraftPrompt(null);
                      }}
                      className="rounded-full border border-zinc-200 px-3 py-2.5 text-xs text-zinc-500 hover:border-zinc-400"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}

              <p className="mt-4 text-xs leading-relaxed text-zinc-400">
                {form.time_limit_minutes
                  ? "⏱ The timer starts as soon as you tap the button below."
                  : "Your progress is saved automatically on this device — you can finish later."}
              </p>

              <button
                type="button"
                onClick={() => start()}
                disabled={starting}
                className="mt-5 w-full rounded-full bg-blue-600 px-4 py-4 text-base font-semibold text-white shadow-lg shadow-blue-600/30 transition-all hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50"
              >
                {starting
                  ? "Starting…"
                  : form.time_limit_minutes
                    ? "Start timed form"
                    : "Start"}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // --- Expired ---------------------------------------------------------------

  if (expired) {
    return (
      <div className="brand-backdrop">
        <StateCard
          icon="⏱"
          title="Time's up"
          body="This response can no longer be submitted because the time limit ran out."
        />
      </div>
    );
  }

  const lowTime = remaining !== null && remaining <= 60;

  // Shared "Save & finish later" block
  const saveAndResumeBlock = (
    <div className="space-y-2">
      {submitError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {submitError}
        </p>
      )}
      {savedLink && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-left">
          <p className="text-xs font-semibold text-emerald-800">Progress saved ✓</p>
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
              className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              {draftCopied ? "Copied!" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={() => setSavedLink(null)}
              className="rounded-full border border-emerald-300 px-3 py-1.5 text-xs text-emerald-800 hover:border-emerald-600"
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
          className="w-full rounded-full border border-zinc-200 px-3 py-2.5 text-xs font-semibold text-zinc-500 transition-colors hover:border-blue-400 hover:text-blue-600 disabled:opacity-50"
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
        accent={ACCENT}
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
        footer={saveAndResumeBlock}
      />
    );
  }

  // --- Classic mode -----------------------------------------------------------

  const pct =
    visibleQuestions.length === 0
      ? 0
      : Math.round((answeredCount / visibleQuestions.length) * 100);

  return (
    <div className="brand-backdrop">
      {/* Sticky progress + timer bar — translucent over the backdrop */}
      <header className="sticky top-0 z-30 bg-white/10 backdrop-blur-md">
        <div className="mx-auto max-w-md px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <h1 className="min-w-0 truncate text-sm font-semibold text-white">
              {form.title}
            </h1>
            <div className="flex shrink-0 items-center gap-2">
              {form.time_limit_minutes && (
                <span
                  className={`rounded-full px-2.5 py-1 font-mono text-xs font-semibold ${
                    lowTime ? "animate-pulse bg-red-500 text-white" : "bg-white/20 text-white"
                  }`}
                  aria-live={lowTime ? "assertive" : undefined}
                >
                  {remaining === null ? "—" : formatTime(remaining)}
                </span>
              )}
              <span className="rounded-full bg-white/20 px-2.5 py-1 font-mono text-xs text-white">
                {answeredCount}/{visibleQuestions.length}
              </span>
            </div>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-white transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md px-3 pb-32 pt-4 sm:pb-10">
        <div className="card-in rounded-2xl bg-white p-4 shadow-xl shadow-blue-950/20 sm:p-6">
          {form.description && (
            <p className="mb-2 text-sm leading-relaxed text-zinc-500">{form.description}</p>
          )}
          {resumedDraft && (
            <div className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800" role="status">
              Draft restored — your previous answers are loaded below.
            </div>
          )}
          {submitError && (
            <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
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

            {/* Desktop submit (mobile uses the docked bar below) */}
            <div className="mt-6 hidden sm:block">
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-full bg-blue-600 px-4 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-600/30 transition-all hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Submit answers"}
              </button>
              {saveAndResumeBlock}
            </div>
          </form>
        </div>
      </main>

      {/* Mobile: docked submit bar — always in thumb reach */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-100 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            onClick={submit}
            className="min-w-0 flex-1 rounded-full bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 active:scale-[0.99] disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit answers"}
          </button>
          <button
            type="button"
            onClick={saveAndFinishLater}
            disabled={savingDraft || !hasAnyAnswer}
            aria-label="Save and finish later"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-zinc-200 text-zinc-500 active:scale-95 disabled:opacity-40"
          >
            {savingDraft ? "…" : "⏸"}
          </button>
        </div>
        {(submitError || savedLink) && (
          <div className="mx-auto mt-2 max-w-md">{saveAndResumeBlock}</div>
        )}
      </div>
    </div>
  );
}
