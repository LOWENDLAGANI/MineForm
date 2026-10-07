"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { QuestionRow } from "@/components/builder/QuestionRow";
import { OptionsEditor } from "@/components/builder/OptionsEditor";
import { CloseConditionsEditor, type CloseConfigValue } from "@/components/builder/CloseConditionsEditor";
import { DesignEditor } from "@/components/builder/DesignEditor";
import { SharePanel } from "@/components/builder/SharePanel";
import { AccessEditor } from "@/components/builder/AccessEditor";
import { IntegrationsEditor } from "@/components/builder/IntegrationsEditor";
import { EndingsEditor } from "@/components/builder/EndingsEditor";
import { ScoringEditor } from "@/components/builder/ScoringEditor";
import { HiddenFieldsEditor } from "@/components/builder/HiddenFieldsEditor";
import { TranslationsEditor } from "@/components/builder/TranslationsEditor";
import { CollaboratorsPanel } from "@/components/builder/CollaboratorsPanel";
import { AuditPanel } from "@/components/builder/AuditPanel";
import { PreviewModal } from "@/components/builder/PreviewModal";
import { HeaderBar } from "@/components/app/HeaderBar";
import { getBrowserSupabase, supabaseEnvMissing } from "@/lib/supabase-browser";
import type {
  AccessConfig,
  DesignConfig,
  EndingConfig,
  FormSettings,
  Integrations,
  Question,
  QuestionType,
  ScoringConfig,
} from "@/lib/types";

interface FormState {
  id: string; title: string; description: string | null; slug: string;
  time_limit_minutes: number | null; response_cap: number | null;
  renderer_mode: "classic" | "conversational";
  theme_config: Record<string, unknown>;
  settings: Partial<FormSettings>;
  scoring_config: Partial<ScoringConfig>;
  ending_config: EndingConfig;
  design_config: Partial<DesignConfig>;
  integrations: Partial<Integrations>;
  access_config: Partial<AccessConfig>;
  send_confirmation_email: boolean; close_config: CloseConfigValue; is_published: boolean;
}

type Tab = "build" | "design" | "settings" | "share" | "access" | "integrate" | "team";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "build", label: "Build", icon: "🧱" },
  { id: "design", label: "Design", icon: "🎨" },
  { id: "settings", label: "Settings", icon: "⚙️" },
  { id: "share", label: "Share", icon: "🚀" },
  { id: "access", label: "Access", icon: "🔐" },
  { id: "integrate", label: "Integrate", icon: "⚡" },
  { id: "team", label: "Team", icon: "👥" },
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const input = "w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-1 focus:ring-inset focus:ring-zinc-900 sm:text-sm";
const label = "block text-xs font-medium text-zinc-600";

export default function FormBuilderPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const formId = params.id;
  const [form, setForm] = useState<FormState | null>(null);
  const [role, setRole] = useState<string>("owner");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("build");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const questionsRef = useRef<Question[]>([]);
  dirtyRef.current = dirty;
  questionsRef.current = questions;

  const readOnly = role === "viewer";

  const authedFetch = useCallback(async (path: string, init?: RequestInit) => {
    const supabase = getBrowserSupabase();
    if (!supabase) throw new Error("Supabase not configured");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) { router.push("/login"); throw new Error("unauthenticated"); }
    const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
    if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.error?.message ?? `Request failed (${res.status})`); }
    return res.json();
  }, [router]);

  useEffect(() => {
    (async () => {
      const data = (await authedFetch(`/api/forms/${formId}`)) as {
        form: Record<string, unknown>; questions: Question[]; role?: string;
      };
      setRole(data.role ?? "owner");
      setForm({
        id: data.form.id as string, title: data.form.title as string,
        description: data.form.description as string | null,
        slug: data.form.slug as string,
        time_limit_minutes: (data.form.time_limit_minutes as number | null) ?? null,
        response_cap: (data.form.response_cap as number | null) ?? null,
        renderer_mode: (data.form.renderer_mode as "classic" | "conversational") ?? "classic",
        theme_config: (data.form.theme_config as Record<string, unknown>) ?? {},
        settings: (data.form.settings as Partial<FormSettings>) ?? {},
        scoring_config: (data.form.scoring_config as Partial<ScoringConfig>) ?? {},
        ending_config: (data.form.ending_config as EndingConfig) ?? { default_message: "Thanks for your response!", endings: [] },
        design_config: (data.form.design_config as Partial<DesignConfig>) ?? {},
        integrations: (data.form.integrations as Partial<Integrations>) ?? {},
        access_config: (data.form.access_config as Partial<AccessConfig>) ?? {},
        send_confirmation_email: (data.form.send_confirmation_email as boolean) ?? false,
        close_config: (data.form.close_config as CloseConfigValue) ?? { close_at: null, conditions: [] },
        is_published: (data.form.is_published as boolean) ?? false,
      });
      setQuestions((data.questions ?? []).map((q: Question, i: number) => ({ ...q, order_index: i })));
      setDirty(false);
      const supabase = getBrowserSupabase();
      if (supabase) {
        const { data: u } = await supabase.auth.getUser();
        setOwnerEmail(u?.user?.email ?? null);
      }
    })().catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [authedFetch, formId]);

  const saveQuestions = useCallback(async (): Promise<boolean> => {
    if (!form) return false;
    setSaving(true); setStatus("Saving…"); setError(null);
    try {
      const data = await authedFetch(`/api/forms/${form.id}`, {
        method: "PATCH", body: JSON.stringify({ questions: questionsRef.current.map((q) => ({
          id: q.id, question_text: q.question_text, question_type: q.question_type,
          options: q.options, validation_rules: q.validation_rules, logic_rules: q.logic_rules,
          translations: q.translations, shuffle_options: q.shuffle_options ?? false, is_required: q.is_required,
        })) }),
      });
      setQuestions((data.questions ?? []).map((q: Question, i: number) => ({ ...q, order_index: i })));
      setDirty(false); setStatus("All changes saved"); setTimeout(() => setStatus(null), 2000);
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); setStatus(null); return false; }
    finally { setSaving(false); }
  }, [authedFetch, form]);

  async function patchForm(patch: Record<string, unknown>, patchState?: (f: FormState) => FormState) {
    if (!form) return;
    setSaving(true); setStatus("Saving…");
    try {
      const data = await authedFetch(`/api/forms/${form.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setForm((f) => {
        if (!f) return f;
        const next: FormState = {
          ...f,
          title: data.form.title, description: data.form.description, slug: data.form.slug,
          time_limit_minutes: data.form.time_limit_minutes, response_cap: data.form.response_cap,
          renderer_mode: data.form.renderer_mode ?? f.renderer_mode,
          send_confirmation_email: data.form.send_confirmation_email ?? f.send_confirmation_email,
          close_config: data.form.close_config ?? f.close_config, is_published: data.form.is_published,
          theme_config: data.form.theme_config ?? f.theme_config,
          settings: data.form.settings ?? f.settings,
          scoring_config: data.form.scoring_config ?? f.scoring_config,
          ending_config: data.form.ending_config ?? f.ending_config,
          design_config: data.form.design_config ?? f.design_config,
          integrations: data.form.integrations ?? f.integrations,
          access_config: data.form.access_config ?? f.access_config,
        };
        return patchState ? patchState(next) : next;
      });
      if (data.form.slug) { setStatus("Saved"); setTimeout(() => setStatus(null), 1500); }
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  async function togglePublish() {
    if (!form) return;
    if (!form.is_published && dirtyRef.current) {
      const ok = await saveQuestions();
      if (!ok) { setError("Fix the save error before publishing."); return; }
    }
    await patchForm({ is_published: !form.is_published });
  }

  function patchQuestion(index: number, patch: Partial<Question>) {
    setQuestions((qs) => qs.map((q, i) => (i === index ? { ...q, ...patch } : q)));
    setDirty(true); setStatus("Unsaved changes");
  }

  function moveQuestion(index: number, dir: -1 | 1) {
    setQuestions((qs) => {
      const j = index + dir;
      if (index < 0 || j < 0 || index >= qs.length || j >= qs.length) return qs;
      const a = qs[index]; const b = qs[j];
      if (!a || !b) return qs;
      const next: Question[] = qs.map((q, i) => (i === index ? b : i === j ? a : q));
      return next.map((q, i) => ({ ...q, order_index: i }));
    });
    setDirty(true); setStatus("Unsaved changes");
  }

  function duplicateQuestion(index: number) {
    setQuestions((qs) => {
      const src = qs[index];
      if (!src) return qs;
      const copy: Question = {
        ...src,
        id: crypto.randomUUID(),
        options: src.options.map((o) => ({ ...o, id: crypto.randomUUID() })),
      };
      const next = [...qs.slice(0, index + 1), copy, ...qs.slice(index + 1)];
      return next.map((q, i) => ({ ...q, order_index: i }));
    });
    setDirty(true); setStatus("Unsaved changes");
  }

  function addQuestion() {
    const q: Question = {
      id: crypto.randomUUID(), form_id: formId, question_text: "", question_type: "short_text" as QuestionType,
      options: [], validation_rules: {}, logic_rules: [], translations: {}, shuffle_options: false, is_required: false, order_index: questions.length,
    };
    setQuestions((qs) => [...qs, q]);
    setDirty(true); setStatus("Unsaved changes");
  }

  function deleteQuestion(index: number) {
    setQuestions((qs) => qs.filter((_, i) => i !== index));
    setDirty(true); setStatus("Unsaved changes");
  }

  if (supabaseEnvMissing) return (
    <div className="min-h-screen bg-white"><HeaderBar /><main className="mx-auto max-w-5xl px-6 py-8 text-sm text-red-600">Supabase not configured.</main></div>
  );

  if (error && !form) return (
    <div className="min-h-screen bg-white"><HeaderBar /><main className="mx-auto max-w-5xl px-6 py-8 text-sm text-red-600">{error}</main></div>
  );

  if (!form) return (
    <div className="min-h-screen bg-white"><HeaderBar /><main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mx-auto max-w-3xl space-y-3" aria-hidden="true">
        <div className="h-8 w-56 animate-pulse rounded bg-zinc-100" />
        <div className="h-32 animate-pulse rounded-lg bg-zinc-100" />
        <div className="h-64 animate-pulse rounded-lg bg-zinc-100" />
      </div>
    </main></div>
  );

  const storedAccent = form.theme_config?.accent;
  const currentAccent = typeof storedAccent === "string" && HEX_RE.test(storedAccent)
    ? storedAccent
    : "#2563eb";

  const locales = form.settings.locales ?? [];

  return (
    <div className="min-h-screen bg-white pb-24 sm:pb-0">
      <HeaderBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-900">← All forms</Link>
            {status && <span className="text-xs text-zinc-400">{status}</span>}
          </div>
          <div className="flex items-center gap-2">
            {readOnly && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">View-only</span>}
            <button type="button" onClick={() => setPreviewOpen(true)}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-900">
              Preview
            </button>
            <Link href={`/forms/${form.id}/responses`}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-900">
              Responses ↗
            </Link>
          </div>
        </div>

        <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-zinc-200 pb-px" aria-label="Builder sections">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-selected={tab === t.id} role="tab"
              className={`whitespace-nowrap rounded-t-lg px-3 py-2 text-xs font-medium ${tab === t.id ? "border-b-2 border-zinc-900 text-zinc-900" : "text-zinc-500 hover:text-zinc-900"}`}>
              <span className="mr-1" aria-hidden="true">{t.icon}</span>{t.label}
            </button>
          ))}
        </nav>

        {tab === "build" && (
          <div className="grid gap-6 sm:grid-cols-[16rem_1fr] sm:gap-8">
            <aside className="order-1 divide-y divide-zinc-200 rounded-lg border border-zinc-200 sm:rounded-none sm:border-0 sm:border-y">
              <section className="px-4 py-3 sm:px-0"><h2 className="text-xs font-medium text-zinc-900">Basics</h2></section>
              <section className="space-y-3 px-4 py-3 sm:px-0">
                <div>
                  <label className={label} htmlFor="f-title">Title</label>
                  <input id="f-title" defaultValue={form.title} disabled={saving || readOnly} onBlur={(e) => e.target.value !== form.title && patchForm({ title: e.target.value })} className={`mt-1 ${input}`} />
                </div>
                <div>
                  <label className={label} htmlFor="f-desc">Description</label>
                  <textarea id="f-desc" rows={3} defaultValue={form.description ?? ""} disabled={saving || readOnly} onBlur={(e) => e.target.value !== (form.description ?? "") && patchForm({ description: e.target.value || null })} className={`mt-1 ${input} resize-y`} />
                </div>
              </section>
              <section className="grid grid-cols-2 gap-3 px-4 py-3 sm:px-0">
                <div>
                  <label className={label} htmlFor="f-timer">Time limit (min)</label>
                  <input id="f-timer" type="number" inputMode="numeric" min={1} defaultValue={form.time_limit_minutes ?? ""} disabled={saving || readOnly} onBlur={(e) => patchForm({ time_limit_minutes: e.target.value ? Number(e.target.value) : null })} className={`mt-1 ${input}`} />
                </div>
                <div>
                  <label className={label} htmlFor="f-cap">Response cap</label>
                  <input id="f-cap" type="number" inputMode="numeric" min={1} defaultValue={form.response_cap ?? ""} disabled={saving || readOnly} onBlur={(e) => patchForm({ response_cap: e.target.value ? Number(e.target.value) : null })} className={`mt-1 ${input}`} />
                </div>
              </section>
              <section className="space-y-3 px-4 py-3 sm:px-0">
                <div>
                  <label className={label}>Renderer</label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {([{ value: "classic", label: "Classic", hint: "All questions on one page" }, { value: "conversational", label: "Conversational", hint: "One per screen" }] as const).map((opt) => (
                      <button key={opt.value} type="button" disabled={saving || readOnly} onClick={() => patchForm({ renderer_mode: opt.value })}
                        className={`rounded-md border px-2 py-2 text-left text-xs ${form.renderer_mode === opt.value ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-blue-400"} disabled:opacity-50`}>
                        <span className="block font-medium">{opt.label}</span>
                        <span className={`block text-[11px] ${form.renderer_mode === opt.value ? "text-zinc-300" : "text-zinc-400"}`}>{opt.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
              <section className="px-4 py-3 sm:px-0">
                <h2 className="mb-2 text-xs font-medium text-zinc-900">Quiz scoring</h2>
                <ScoringEditor value={form.scoring_config} saving={saving || readOnly} questionCount={questions.length}
                  onChange={(scoring_config) => patchForm({ scoring_config: { ...form.scoring_config, ...scoring_config } })} />
              </section>
              <section className="px-4 py-3 sm:px-0">
                <h2 className="mb-2 text-xs font-medium text-zinc-900">Close conditions</h2>
                <CloseConditionsEditor value={form.close_config} questions={questions} disabled={saving || readOnly} onChange={(close_config) => patchForm({ close_config })} />
              </section>
              <section className="flex items-center justify-between px-4 py-3 sm:px-0">
                <span className="text-xs font-medium text-zinc-900">{form.is_published ? "Live" : "Draft"}</span>
                <button type="button" onClick={togglePublish} disabled={saving || readOnly}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold shadow-sm transition-all active:scale-95 ${form.is_published ? "border-blue-600 bg-blue-600 text-white shadow-blue-600/30" : "border-zinc-300 bg-white text-zinc-700 hover:border-blue-500 hover:text-blue-600"} disabled:opacity-50`}>
                  {form.is_published ? "Unpublish" : "Publish"}
                </button>
              </section>
            </aside>
            <section className="order-2">
              <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
                <h2 className="text-xs font-medium text-zinc-900">Questions <span className="ml-1 font-mono text-zinc-400">{questions.length}</span></h2>
                <label className="hidden items-center gap-1.5 text-[11px] text-zinc-500 sm:flex">
                  <input type="checkbox" checked={form.settings.shuffle_questions ?? false} disabled={saving || readOnly}
                    onChange={(e) => patchForm({ settings: { ...form.settings, shuffle_questions: e.target.checked } })}
                    className="h-3.5 w-3.5 accent-zinc-900" />
                  Shuffle order
                </label>
                <button type="button" onClick={addQuestion} disabled={readOnly} className="hidden rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-blue-600/30 hover:bg-blue-700 disabled:opacity-40 sm:block">Add question</button>
              </div>
              {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
              {questions.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-sm text-zinc-500">No questions yet.</p>
                  <button type="button" onClick={addQuestion} disabled={readOnly} className="mt-3 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 hover:bg-blue-700 disabled:opacity-40">Add your first question</button>
                </div>
              ) : (
                questions.map((q, i) => (
                  <div key={q.id} className="mt-3 sm:mt-0">
                    <QuestionRow question={q} index={i} total={questions.length}
                      onChange={(patch) => patchQuestion(i, patch)} onMove={(dir) => moveQuestion(i, dir)}
                      onDuplicate={() => duplicateQuestion(i)}
                      onDelete={() => deleteQuestion(i)} />
                    <OptionsEditor question={q} scoringEnabled={form.scoring_config.enabled ?? false} onChange={(patch) => patchQuestion(i, patch)} />
                    <TranslationsEditor question={q} locales={locales} saving={saving || readOnly} onChange={(patch) => patchQuestion(i, patch)} />
                  </div>
                ))
              )}
              <button type="button" onClick={addQuestion} disabled={readOnly} className="mt-4 w-full rounded-md border border-dashed border-zinc-300 py-3 text-sm font-medium text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 disabled:opacity-40 sm:hidden">+ Add question</button>
            </section>
          </div>
        )}

        {tab === "design" && (
          <div className="max-w-xl space-y-6">
            <div>
              <label className={label}>Confirmation email to respondents</label>
              <label className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3">
                <span className="text-xs text-zinc-700">Send respondents a copy of their answers</span>
                <input type="checkbox" disabled={saving || readOnly} checked={form.send_confirmation_email}
                  onChange={(e) => patchForm({ send_confirmation_email: e.target.checked })}
                  className="h-4 w-4 shrink-0 accent-zinc-900" />
              </label>
              <p className="mt-1 text-[11px] text-zinc-400">Uses the respondent's email question or verified email.</p>
            </div>
            <DesignEditor value={form.design_config} accent={currentAccent} saving={saving || readOnly}
              onDesignChange={(patch) => patchForm({ design_config: { ...form.design_config, ...patch } })}
              onAccentChange={(accent) => patchForm({ theme_config: { ...form.theme_config, accent } })} />
            <section>
              <h2 className="mb-2 text-xs font-medium text-zinc-900">Custom ending screens</h2>
              <EndingsEditor value={form.ending_config} questions={questions} saving={saving || readOnly}
                onChange={(ending_config) => patchForm({ ending_config })} />
            </section>
          </div>
        )}

        {tab === "settings" && (
          <div className="max-w-xl space-y-8">
            <section>
              <h2 className="mb-3 text-xs font-medium text-zinc-900">Behavior</h2>
              <div className="space-y-3">
                <label className="flex items-center justify-between gap-3">
                  <span className="text-xs text-zinc-700">Show the answered/total progress bar</span>
                  <input type="checkbox" disabled={saving || readOnly} checked={form.settings.progress_bar ?? true}
                    onChange={(e) => patchForm({ settings: { ...form.settings, progress_bar: e.target.checked } })}
                    className="h-4 w-4 shrink-0 accent-zinc-900" />
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-xs text-zinc-700">Autofill hints on name/email fields</span>
                  <input type="checkbox" disabled={saving || readOnly} checked={form.settings.autocomplete ?? true}
                    onChange={(e) => patchForm({ settings: { ...form.settings, autocomplete: e.target.checked } })}
                    className="h-4 w-4 shrink-0 accent-zinc-900" />
                </label>
              </div>
            </section>
            <section>
              <h2 className="mb-2 text-xs font-medium text-zinc-900">Hidden fields</h2>
              <HiddenFieldsEditor fields={form.settings.hidden_fields ?? []} saving={saving || readOnly}
                onChange={(hidden_fields) => patchForm({ settings: { ...form.settings, hidden_fields } })} />
            </section>
            <section>
              <h2 className="mb-2 text-xs font-medium text-zinc-900">Languages</h2>
              <p className="mb-2 text-[11px] text-zinc-400">
                Add locale codes (e.g. <code className="font-mono">es</code>, <code className="font-mono">de</code>, <code className="font-mono">ar</code> — first is the default).
                Then translate each question in the Build tab. RTL locales render right-to-left automatically.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(locales.length > 0 ? locales : ["en"]).map((l, i) => (
                  <span key={`${l}-${i}`} className="flex items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-1 font-mono text-[11px] text-zinc-700">
                    {l}{i === 0 && <span className="text-[10px] text-zinc-400">(default)</span>}
                    {!readOnly && i > 0 && (
                      <button type="button" disabled={saving} onClick={() => patchForm({ settings: { ...form.settings, locales: locales.filter((_, j) => j !== i) } })}
                        className="text-zinc-400 hover:text-red-600" aria-label={`Remove ${l}`}>×</button>
                    )}
                  </span>
                ))}
              </div>
              <form className="mt-2 flex max-w-xs gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const el = (e.currentTarget.elements.namedItem("newLocale") as HTMLInputElement);
                  const v = el.value.trim().toLowerCase().slice(0, 8);
                  if (v && !locales.includes(v)) patchForm({ settings: { ...form.settings, locales: [...locales, v] } });
                  el.value = "";
                }}>
                <input name="newLocale" placeholder="es, de, pt-BR…" disabled={saving || readOnly} className={input} />
                <button type="submit" disabled={saving || readOnly} className="shrink-0 rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-900 disabled:opacity-40">Add</button>
              </form>
            </section>
          </div>
        )}

        {tab === "share" && (
          <div className="max-w-xl">
            <SharePanel slug={form.slug} published={form.is_published} saving={saving || readOnly}
              onSlugChange={(slug) => patchForm({ slug })}
              linkExpiresAt={form.access_config.link_expires_at ?? null}
              onExpiryChange={(link_expires_at) => patchForm({ access_config: { ...form.access_config, link_expires_at } })} />
            <div className="mt-6 border-t border-zinc-200 pt-4">
              <h2 className="mb-2 text-xs font-medium text-zinc-900">Share as template</h2>
              <PublishTemplateButton formId={form.id} questionCount={questions.length}
                onDone={(msg) => { setStatus(msg); setTimeout(() => setStatus(null), 3000); }} />
            </div>
          </div>
        )}

        {tab === "access" && (
          <div className="max-w-xl">
            <AccessEditor value={form.access_config} saving={saving || readOnly} uniqueEmail={form.settings.unique_email ?? false}
              onChange={(access_config) => patchForm({ access_config: { ...form.access_config, ...access_config } })}
              onSettingsChange={(patch) => patchForm({ settings: { ...form.settings, ...patch } })} />
          </div>
        )}

        {tab === "integrate" && (
          <div className="max-w-xl">
            <IntegrationsEditor value={form.integrations} saving={saving} emailConfigured
              onChange={(integrations) => patchForm({ integrations: { ...form.integrations, ...integrations } })} />
          </div>
        )}

        {tab === "team" && (
          <div className="max-w-xl space-y-8">
            <section>
              <h2 className="mb-3 text-xs font-medium text-zinc-900">Collaborators {readOnly && <span className="text-[11px] font-normal text-amber-700">(owner access required)</span>}</h2>
              {!readOnly ? <CollaboratorsPanel formId={form.id} ownerEmail={ownerEmail} authedFetch={authedFetch} saving={saving} />
                : <p className="text-xs text-zinc-400">Only the form owner can manage collaborators.</p>}
            </section>
            <section>
              <h2 className="mb-3 text-xs font-medium text-zinc-900">Activity log</h2>
              <AuditPanel formId={form.id} authedFetch={authedFetch} />
            </section>
          </div>
        )}
      </main>

      {previewOpen && (
        <PreviewModal title={form.title} description={form.description} questions={questions}
          accent={currentAccent} design={form.design_config} onClose={() => setPreviewOpen(false)} />
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur sm:hidden">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{error ?? status ?? (dirty ? "Unsaved changes" : "All changes saved")}</span>
          <button type="button" onClick={saveQuestions} disabled={saving || !dirty || readOnly} className="shrink-0 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 active:scale-[0.98] disabled:opacity-40">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <div className="mx-auto mt-6 hidden max-w-5xl items-center gap-3 px-6 pb-8 sm:flex">
        <button type="button" onClick={saveQuestions} disabled={saving || !dirty || readOnly} className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 hover:bg-blue-700 disabled:opacity-40">
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
        <span className="text-xs text-zinc-400">{dirty ? "Unsaved edits" : "Saved"}</span>
      </div>
    </div>
  );
}

function PublishTemplateButton({ formId, questionCount, onDone }: {
  formId: string; questionCount: number; onDone: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    setBusy(true); setError(null);
    try {
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error("Supabase not configured");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`/api/forms/${formId}/publish-template`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: "" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Publish failed");
      }
      onDone("Template published to the community gallery");
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-[11px] text-zinc-400">Free community marketplace — anyone browsing MineForm can start from your question set.</p>
      <div className="mt-2 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" maxLength={120}
          className={input} aria-label="Template name" />
        <button type="button" onClick={publish} disabled={busy || !name.trim() || questionCount === 0}
          className="shrink-0 rounded-full bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-40">
          Publish
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
