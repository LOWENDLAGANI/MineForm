"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import type { FormTemplate } from "@/lib/templates";
import { templateToFormPayload } from "@/lib/templates";

const input =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-1 focus:ring-inset focus:ring-zinc-900 sm:py-1.5 sm:text-sm";
const btn =
  "rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition-all hover:bg-blue-700 active:scale-95 sm:px-3 sm:py-1.5 sm:text-xs";

interface TemplateListItem {
  key: string;
  name: string;
  description: string;
  author: string | null;
  definition?: unknown;
}

interface Usage {
  forms: number;
  publishedForms: number;
  responsesThisMonth: number;
  responsesTotal: number;
  plan: string;
  planLabel: string;
}

export function DashboardExtras({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const tokenGet = useCallback(async (): Promise<string | null> => {
    const supabase = getBrowserSupabase();
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  useEffect(() => {
    (async () => {
      const token = await tokenGet();
      if (!token) return;
      const tRes = await fetch("/api/templates", { headers: { Authorization: `Bearer ${token}` } });
      if (tRes.ok) {
        const t = await tRes.json();
        setTemplates([...(t.builtIn ?? []), ...(t.community ?? [])]);
      }
      const uRes = await fetch("/api/usage", { headers: { Authorization: `Bearer ${token}` } });
      if (uRes.ok) setUsage((await uRes.json()).usage);
    })();
  }, [tokenGet]);

  /** Create a form straight from a template payload. */
  async function createFromTemplate(item: TemplateListItem | null, importedPayload?: unknown) {
    let payload: unknown;
    if (importedPayload) {
      payload = importedPayload;
    } else if (item) {
      // Community templates ship their definition inline; built-ins use the key.
      const def = item.definition as FormTemplate | undefined;
      if (def?.questions) {
        payload = templateToFormPayload({ ...def, key: item.key.replace("community:", "tpl-") });
      } else {
        payload = templateToFormPayload({ name: item.name, description: item.description, key: item.key } as FormTemplate);
      }
    }
    if (!payload) return;
    const token = await tokenGet();
    if (!token) return;
    try {
      if (item) setBusyKey((k) => item.key || k);
      const res = await fetch("/api/forms", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not create form");
      onCreated();
      setShowTemplates(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyKey(null);
    }
  }

  async function runImport() {
    setImportError(null);
    setImporting(true);
    try {
      const res = await fetch("/api/import/google-forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "Import failed");
      const slug = "imported-" + Math.random().toString(36).slice(2, 7);
      await createFromTemplate(null, {
        title: body.title, description: body.description, slug,
        renderer_mode: "classic",
        questions: body.questions.map((q: Record<string, unknown>) => ({
          question_text: q.question_text, question_type: q.question_type,
          options: q.options, validation_rules: q.validation_rules, is_required: q.is_required,
        })),
      });
      setImportUrl("");
      setShowImport(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mt-6 mb-2 space-y-4">
      {/* Usage line */}
      {usage && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-600">
          <span><strong className="text-zinc-900">{usage.forms}</strong> forms</span>
          <span><strong className="text-zinc-900">{usage.publishedForms}</strong> published</span>
          <span><strong className="text-zinc-900">{usage.responsesThisMonth}</strong> responses this month</span>
          <span><strong className="text-zinc-900">{usage.responsesTotal}</strong> responses total</span>
          <span className="ml-auto rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">{usage.planLabel}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setShowTemplates((v) => !v)} className={btn + " sm:bg-white sm:text-blue-600 sm:border sm:border-blue-600 sm:shadow-none sm:hover:bg-blue-50"}>
          Browse templates
        </button>
        <button type="button" onClick={() => setShowImport((v) => !v)} className={btn + " sm:bg-white sm:text-zinc-700 sm:border sm:border-zinc-300 sm:shadow-none sm:hover:bg-zinc-50"}>
          Import from Google Forms
        </button>
      </div>

      {showImport && (
        <div className="rounded-lg border border-zinc-200 p-4">
          <p className="text-xs text-zinc-500">Paste a public Google Forms share link. The parser imports questions as best it can — review the result after creating.</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://docs.google.com/forms/d/e/…" className={`${input} flex-1`} />
            <button type="button" onClick={runImport} disabled={importing || importUrl.length === 0} className={btn + " disabled:opacity-50"}>
              {importing ? "Importing…" : "Import"}
            </button>
          </div>
          {importError && <p className="mt-2 text-xs text-red-600">{importError}</p>}
        </div>
      )}

      {showTemplates && (
        <div className="grid gap-3 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <button type="button" key={t.key} disabled={busyKey !== null}
              onClick={() => createFromTemplate(t)}
              className="rounded-lg border border-zinc-200 p-3 text-left transition-colors hover:border-blue-400 hover:bg-blue-50/40 disabled:opacity-50">
              <p className="text-sm font-medium text-zinc-900">{t.name}</p>
              <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{t.description}</p>
              {t.author && <p className="mt-2 text-[10px] text-zinc-400">by {t.author}</p>}
            </button>
          ))}
          {templates.length === 0 && <p className="text-xs text-zinc-400">No templates available.</p>}
        </div>
      )}
      {importError && !showImport && <p className="text-xs text-red-600">{importError}</p>}
    </div>
  );
}
