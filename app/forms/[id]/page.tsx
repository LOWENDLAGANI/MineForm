"use client";

/**
 * Form builder — responsive, touch-first.
 * Mobile: stacked cards, always-visible reorder arrows, tappable question
 * text, sticky Save bar. Desktop: two-column layout.
 * Questions persist through PATCH /api/forms/[id] (full ordered set).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { QuestionRow } from "@/components/builder/QuestionRow";
import { OptionsEditor } from "@/components/builder/OptionsEditor";
import { CloseConditionsEditor, type CloseConfigValue } from "@/components/builder/CloseConditionsEditor";
import { HeaderBar } from "@/components/app/HeaderBar";
import { getBrowserSupabase, supabaseEnvMissing } from "@/lib/supabase-browser";
import type { Question, QuestionType } from "@/lib/types";

interface FormState {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  time_limit_minutes: number | null;
  response_cap: number | null;
  renderer_mode: "classic" | "conversational";
  send_confirmation_email: boolean;
  close_config: CloseConfigValue;
  is_published: boolean;
}

const input =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-1 focus:ring-inset focus:ring-zinc-900 sm:text-sm";

const label = "block text-xs font-medium text-zinc-600";

export default function FormBuilderPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const formId = params.id;

  const [form, setForm] = useState<FormState | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slug, setSlug] = useState("");
  const dirtyRef = useRef(false);
  const questionsRef = useRef<Question[]>([]);
  dirtyRef.current = dirty;
  questionsRef.current = questions;

  const authedFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error("Supabase is not configured");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.push("/login");
        throw new Error("unauthenticated");
      }
      const res = await fetch(path, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      return res.json();
    },
    [router],
  );

  // Load form + questions owner-side (works for drafts and published forms).
  useEffect(() => {
    (async () => {
      const data = await authedFetch(`/api/forms/${formId}`);
      setForm({
        id: data.form.id,
        title: data.form.title,
        description: data.form.description,
        slug: data.form.slug,
        time_limit_minutes: data.form.time_limit_minutes,
        response_cap: data.form.response_cap,
        renderer_mode: data.form.renderer_mode ?? "classic",
        send_confirmation_email: data.form.send_confirmation_email ?? false,
        close_config: data.form.close_config ?? { close_at: null, conditions: [] },
        is_published: data.form.is_published,
      });
      setSlug(data.form.slug);
      setQuestions(
        (data.questions ?? []).map((q: Question, i: number) => ({ ...q, order_index: i })),
      );
      setDirty(false);
    })().catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [authedFetch, formId]);

  /** Persist the full ordered question set (+ any form fields) to the server. */
  const saveQuestions = useCallback(async (): Promise<boolean> => {
    if (!form) return false;
    setSaving(true);
    setStatus("Saving…");
    setError(null);
    try {
      const data = await authedFetch(`/api/forms/${form.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          questions: questionsRef.current.map((q) => ({
            id: q.id,
            question_text: q.question_text,
            question_type: q.question_type,
            options: q.options,
            validation_rules: q.validation_rules,
            logic_rules: q.logic_rules,
            is_required: q.is_required,
          })),
        }),
      });
      setQuestions(
        (data.questions ?? []).map((q: Question, i: number) => ({ ...q, order_index: i })),
      );
      setDirty(false);
      setStatus("All changes saved");
      setTimeout(() => setStatus(null), 2000);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setStatus(null);
      return false;
    } finally {
      setSaving(false);
    }
  }, [authedFetch, form]);

  async function patchForm(patch: Partial<FormState>) {
    if (!form) return;
    setSaving(true);
    setStatus("Saving…");
    try {
      const data = await authedFetch(`/api/forms/${form.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setForm((f) =>
        f
          ? {
              ...f,
              title: data.form.title,
              description: data.form.description,
              slug: data.form.slug,
              time_limit_minutes: data.form.time_limit_minutes,
              response_cap: data.form.response_cap,
              renderer_mode: data.form.renderer_mode ?? f.renderer_mode,
              send_confirmation_email:
                data.form.send_confirmation_email ?? f.send_confirmation_email,
              close_config: data.form.close_config ?? f.close_config,
              is_published: data.form.is_published,
            }
          : f,
      );
      if (data.form.slug) setSlug(data.form.slug);
      setStatus("Saved");
      setTimeout(() => setStatus(null), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  /** Publish/unpublish — saves pending question edits first so nothing is lost. */
  async function togglePublish() {
    if (!form) return;
    if (!form.is_published && dirtyRef.current) {
      const ok = await saveQuestions();
      if (!ok) {
        setError("Fix the save error before publishing — your edits aren't stored yet.");
        return;
      }
    }
    await patchForm({ is_published: !form.is_published });
  }

  function patchQuestion(index: number, patch: Partial<Question>) {
    setQuestions((qs) => qs.map((q, i) => (i === index ? { ...q, ...patch } : q)));
    setDirty(true);
    setStatus("Unsaved changes");
  }

  function moveQuestion(index: number, dir: -1 | 1) {
    setQuestions((qs) => {
      const j = index + dir;
      if (index < 0 || j < 0 || index >= qs.length || j >= qs.length) return qs;
      const a = qs[index];
      const b = qs[j];
      if (!a || !b) return qs;
      const next: Question[] = qs.map((q, i) => (i === index ? b : i === j ? a : q));
      return next.map((q, i) => ({ ...q, order_index: i }));
    });
    setDirty(true);
    setStatus("Unsaved changes");
  }

  function addQuestion() {
    const q: Question = {
      id: crypto.randomUUID(),
      form_id: formId,
      question_text: "",
      question_type: "short_text" as QuestionType,
      options: [],
      validation_rules: {},
      logic_rules: [],
      is_required: false,
      order_index: questions.length,
    };
    setQuestions((qs) => [...qs, q]);
    setDirty(true);
    setStatus("Unsaved changes — remember to save");
  }

  function deleteQuestion(index: number) {
    setQuestions((qs) => qs.filter((_, i) => i !== index));
    setDirty(true);
    setStatus("Unsaved changes");
  }

  if (supabaseEnvMissing) {
    return (
      <div className="min-h-screen bg-white">
        <HeaderBar />
        <main className="mx-auto max-w-5xl px-6 py-8 text-sm text-red-600">
          Supabase is not configured. Add env vars to .env.local and restart.
        </main>
      </div>
    );
  }

  if (error && !form) {
    return (
      <div className="min-h-screen bg-white">
        <HeaderBar />
        <main className="mx-auto max-w-5xl px-6 py-8 text-sm text-red-600">{error}</main>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="min-h-screen bg-white">
        <HeaderBar />
        <main className="mx-auto max-w-5xl px-6 py-8 text-xs text-zinc-400">Loading…</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-24 sm:pb-0">
      <HeaderBar />

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Mobile: back link + status */}
        <div className="mb-4 flex items-center justify-between sm:hidden">
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-900">
            ← All forms
          </Link>
          {status && <span className="text-xs text-zinc-400">{status}</span>}
        </div>

        <div className="grid gap-6 sm:grid-cols-[16rem_1fr] sm:gap-8">
          {/* Settings — stacked on mobile, sidebar on desktop */}
          <aside className="order-1 divide-y divide-zinc-200 rounded-lg border border-zinc-200 sm:rounded-none sm:border-0 sm:border-y">
            <section className="px-4 py-3 sm:px-0">
              <h2 className="text-xs font-medium text-zinc-900">Settings</h2>
            </section>
            <section className="space-y-3 px-4 py-3 sm:px-0">
              <div>
                <label className={label} htmlFor="f-title">Title</label>
                <input
                  id="f-title"
                  defaultValue={form.title}
                  onBlur={(e) =>
                    e.target.value !== form.title && patchForm({ title: e.target.value })
                  }
                  className={`mt-1 ${input}`}
                />
              </div>
              <div>
                <label className={label} htmlFor="f-desc">Description</label>
                <textarea
                  id="f-desc"
                  rows={3}
                  defaultValue={form.description ?? ""}
                  onBlur={(e) =>
                    e.target.value !== (form.description ?? "") &&
                    patchForm({ description: e.target.value || null })
                  }
                  className={`mt-1 ${input} resize-y`}
                />
              </div>
            </section>
            <section className="grid grid-cols-2 gap-3 px-4 py-3 sm:px-0">
              <div>
                <label className={label} htmlFor="f-timer">Time limit (min)</label>
                <input
                  id="f-timer"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  defaultValue={form.time_limit_minutes ?? ""}
                  onBlur={(e) =>
                    patchForm({
                      time_limit_minutes: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className={`mt-1 ${input}`}
                />
              </div>
              <div>
                <label className={label} htmlFor="f-cap">Response cap</label>
                <input
                  id="f-cap"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  defaultValue={form.response_cap ?? ""}
                  onBlur={(e) =>
                    patchForm({ response_cap: e.target.value ? Number(e.target.value) : null })
                  }
                  className={`mt-1 ${input}`}
                />
              </div>
            </section>
            <section className="space-y-3 px-4 py-3 sm:px-0">
              <div>
                <label className={label}>Renderer</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {(
                    [
                      { value: "classic", label: "Classic", hint: "All questions on one page" },
                      { value: "conversational", label: "Conversational", hint: "One question per screen" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={saving}
                      onClick={() => patchForm({ renderer_mode: opt.value })}
                      className={`rounded-md border px-2 py-2 text-left text-xs ${
                        form.renderer_mode === opt.value
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-zinc-300 bg-white text-zinc-700 hover:border-blue-400"
                      } disabled:opacity-50`}
                    >
                      <span className="block font-medium">{opt.label}</span>
                      <span
                        className={`block text-[11px] ${
                          form.renderer_mode === opt.value ? "text-zinc-300" : "text-zinc-400"
                        }`}
                      >
                        {opt.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
            <section className="px-4 py-3 sm:px-0">
              <label className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-xs font-medium text-zinc-900">
                    Confirmation email
                  </span>
                  <span className="block text-[11px] text-zinc-400">
                    Send respondents a copy of their answers
                  </span>
                </span>
                <input
                  type="checkbox"
                  disabled={saving}
                  checked={form.send_confirmation_email}
                  onChange={(e) =>
                    patchForm({ send_confirmation_email: e.target.checked })
                  }
                  className="h-4 w-4 shrink-0 accent-zinc-900"
                />
              </label>
              <p className="mt-1 text-[11px] text-zinc-400">
                Uses the first email question's answer, or the email respondents enter
                when saving progress.
              </p>
            </section>
            <section className="px-4 py-3 sm:px-0">
              <h2 className="mb-2 text-xs font-medium text-zinc-900">Close conditions</h2>
              <CloseConditionsEditor
                value={form.close_config}
                questions={questions}
                disabled={saving}
                onChange={(close_config) => patchForm({ close_config })}
              />
            </section>
            <section className="flex items-center justify-between px-4 py-3 sm:px-0">
              <span className="text-xs font-medium text-zinc-900">
                {form.is_published ? "Live" : "Draft"}
              </span>
              <button
                type="button"
                onClick={togglePublish}
                disabled={saving}
                className={`rounded-full border px-4 py-2 text-xs font-semibold shadow-sm transition-all active:scale-95 ${
                  form.is_published
                    ? "border-blue-600 bg-blue-600 text-white shadow-blue-600/30"
                    : "border-zinc-300 bg-white text-zinc-700 hover:border-blue-500 hover:text-blue-600"
                } disabled:opacity-50`}
              >
                {form.is_published ? "Unpublish" : "Publish"}
              </button>
            </section>
            {form.is_published && (
              <section className="px-4 py-3 sm:px-0">
                <span className="text-xs text-zinc-500">Public link</span>
                <div className="mt-1 flex items-center gap-2">
                  <a
                    href={`/f/${slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-900 hover:underline"
                  >
                    /f/{slug}
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(
                        `${window.location.origin}/f/${slug}`,
                      );
                      setStatus("Link copied");
                      setTimeout(() => setStatus(null), 1500);
                    }}
                    className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-zinc-900"
                  >
                    Copy
                  </button>
                </div>
                <Link
                  href={`/forms/${form.id}/responses`}
                  className="mt-2 block text-xs text-zinc-500 hover:text-zinc-900"
                >
                  View responses →
                </Link>
              </section>
            )}
          </aside>

          {/* Questions column */}
          <section className="order-2">
            <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
              <h2 className="text-xs font-medium text-zinc-900">
                Questions <span className="ml-1 font-mono text-zinc-400">{questions.length}</span>
              </h2>
              <div className="hidden items-center gap-3 sm:flex">
                {status && <span className="text-xs text-zinc-400">{status}</span>}
                <button
                  type="button"
                  onClick={addQuestion}
                  className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-blue-600/30 hover:bg-blue-700"
                >
                  Add question
                </button>
              </div>
            </div>

            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

            {questions.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-zinc-500">No questions yet.</p>
                <button
                  type="button"
                  onClick={addQuestion}
                  className="mt-3 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 hover:bg-blue-700"
                >
                  Add your first question
                </button>
              </div>
            ) : (
              questions.map((q, i) => (
                <div key={q.id} className="mt-3 sm:mt-0">
                  <QuestionRow
                    question={q}
                    index={i}
                    total={questions.length}
                    onChange={(patch) => patchQuestion(i, patch)}
                    onMove={(dir) => moveQuestion(i, dir)}
                    onDelete={() => deleteQuestion(i)}
                  />
                  <OptionsEditor question={q} onChange={(patch) => patchQuestion(i, patch)} />
                </div>
              ))
            )}

            {/* Mobile add button — full-width, thumb-friendly */}
            <button
              type="button"
              onClick={addQuestion}
              className="mt-4 w-full rounded-md border border-dashed border-zinc-300 py-3 text-sm font-medium text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 sm:hidden"
            >
              + Add question
            </button>
          </section>
        </div>
      </main>

      {/* Sticky mobile save bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur sm:hidden">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
            {error ?? status ?? (dirty ? "Unsaved changes" : "All changes saved")}
          </span>            <button
              type="button"
              onClick={saveQuestions}
              disabled={saving || !dirty}
              className="shrink-0 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 active:scale-[0.98] disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
        </div>
      </div>

      {/* Desktop save bar */}
      <div className="mx-auto mt-6 hidden max-w-5xl items-center gap-3 px-6 pb-8 sm:flex">
        <button
          type="button"
          onClick={saveQuestions}
          disabled={saving || !dirty}
          className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 hover:bg-blue-700 disabled:opacity-40"
        >
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
        <span className="text-xs text-zinc-400">
          {dirty ? "You have unsaved edits" : "Everything is stored"}
        </span>
      </div>
    </div>
  );
}
