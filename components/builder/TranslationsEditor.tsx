"use client";

import { useState } from "react";
import type { Question, Translation } from "@/lib/types";

const input = "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 sm:text-xs";

/**
 * Per-question translations for the locales configured on the form
 * (settings.locales[1:]). The default locale uses the original text.
 */
export function TranslationsEditor({
  question, locales, saving, onChange,
}: {
  question: Question;
  locales: string[];
  saving: boolean;
  onChange: (patch: Partial<Question>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [locale, setLocale] = useState(locales[0] ?? "");

  if (locales.length < 2 || !locale) return null;

  const translations: Record<string, Translation> = question.translations ?? {};
  const current = translations[locale] ?? {};

  function update(patch: Partial<Translation>) {
    onChange({
      translations: {
        ...translations,
        [locale]: { ...(current ?? {}), ...patch },
      },
    });
  }

  const hasOptions = ["single_choice", "multi_choice", "dropdown"].includes(question.question_type);

  return (
    <div className="mx-3 mb-3 sm:mx-0 sm:px-10">
      <button type="button" onClick={() => setOpen((s) => !s)}
        className="text-[11px] font-medium text-blue-600 hover:underline">
        {open ? "Hide translations ▲" : "Translations 🌐 ▼"}
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-zinc-200 bg-white p-2">
          <div className="flex flex-wrap gap-1.5">
            {locales.map((l) => (
              <button key={l} type="button" onClick={() => setLocale(l)}
                className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${locale === l ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-600"}`}>
                {l}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-zinc-400">
            Leave empty to fall back to the default language text.
          </p>
          <input value={current.text ?? ""} disabled={saving} placeholder={`Question text (${locale})`}
            onChange={(e) => update({ text: e.target.value || undefined })}
            className={`mt-2 ${input}`} aria-label={`Translated question text (${locale})`} />
          {hasOptions && question.options.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {question.options.map((o) => (
                <div key={o.id} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 truncate text-[11px] text-zinc-400">{o.label}</span>
                  <input
                    value={current.options?.[o.id] ?? ""} disabled={saving}
                    placeholder={`${o.label} (${locale})`} aria-label={`Translated label for ${o.label}`}
                    onChange={(e) => {
                      const next = { ...(current.options ?? {}) };
                      if (e.target.value) next[o.id] = e.target.value;
                      else delete next[o.id];
                      update({ options: next });
                    }}
                    className={input} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
