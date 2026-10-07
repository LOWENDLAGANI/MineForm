"use client";

import { nanoid } from "@/lib/nanoid";
import type { EndingConfig } from "@/lib/types";

const input = "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 sm:text-sm";
const label = "block text-xs font-medium text-zinc-600";

export function EndingsEditor({
  value, questions, saving, onChange,
}: {
  value: EndingConfig;
  questions: { id: string; question_text: string; question_type: string }[];
  saving: boolean;
  onChange: (next: EndingConfig) => void;
}) {
  const endings = value.endings ?? [];

  function update(id: string, patch: Partial<(typeof endings)[number]>) {
    onChange({ ...value, endings: endings.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  }

  return (
    <div className="space-y-4">
      <section>
        <label className={label} htmlFor="e-default">Default ending message</label>
        <textarea id="e-default" rows={2} disabled={saving} defaultValue={value.default_message ?? "Thanks for your response!"}
          onBlur={(e) => onChange({ ...value, default_message: e.target.value || "Thanks for your response!" })}
          className={`mt-1 ${input} resize-y`} />
        <p className="mt-1 text-[11px] text-zinc-400">
          Pipe answers in with <code className="font-mono">{"{{answer:1}}"}</code> (question position) or hidden fields with <code className="font-mono">{"{{field:utm_source}}"}</code>.
        </p>
      </section>

      {endings.map((e) => (
        <section key={e.id} className="rounded-lg border border-zinc-200 p-3">
          <div className="flex items-center justify-between">
            <input value={e.name} disabled={saving} onChange={(ev) => update(e.id, { name: ev.target.value })}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs font-semibold text-zinc-900 outline-none" aria-label="Ending name" />
            <button type="button" disabled={saving} onClick={() => onChange({ ...value, endings: endings.filter((x) => x.id !== e.id) })}
              className="text-xs text-zinc-400 hover:text-red-600" aria-label="Remove ending">Remove</button>
          </div>
          <textarea rows={2} disabled={saving} value={e.message} onChange={(ev) => update(e.id, { message: ev.target.value })}
            className={`mt-2 ${input} resize-y`} aria-label="Ending message" />
          <div className="mt-2 space-y-2">
            <span className="text-[11px] font-medium text-zinc-500">Show when…</span>
            {e.conditions.map((c, ci) => (
              <div key={ci} className="flex flex-wrap items-center gap-1.5">
                <select disabled={saving} value={c.question_id}
                  onChange={(ev) => update(e.id, { conditions: e.conditions.map((x, i) => i === ci ? { ...x, question_id: ev.target.value } : x) })}
                  className="max-w-44 rounded-md border border-zinc-300 px-2 py-1 text-[11px]" aria-label="Question">
                  {questions.map((q) => <option key={q.id} value={q.id}>{q.question_text.slice(0, 40)}</option>)}
                </select>
                <select disabled={saving} value={c.operator}
                  onChange={(ev) => update(e.id, { conditions: e.conditions.map((x, i) => i === ci ? { ...x, operator: ev.target.value as "eq" | "contains" } : x) })}
                  className="rounded-md border border-zinc-300 px-1.5 py-1 text-[11px]" aria-label="Operator">
                  <option value="eq">is</option>
                  <option value="contains">contains</option>
                </select>
                <input value={c.value} disabled={saving}
                  onChange={(ev) => update(e.id, { conditions: e.conditions.map((x, i) => i === ci ? { ...x, value: ev.target.value } : x) })}
                  className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 text-[11px]" aria-label="Value" />
                <button type="button" disabled={saving} onClick={() => update(e.id, { conditions: e.conditions.filter((_, i) => i !== ci) })}
                  className="text-xs text-zinc-400 hover:text-red-600" aria-label="Remove condition">×</button>
              </div>
            ))}
            {questions.length > 0 && (
              <button type="button" disabled={saving}
                onClick={() => update(e.id, { conditions: [...e.conditions, { question_id: questions[0]?.id ?? "", operator: "eq", value: "" }] })}
                className="text-[11px] font-medium text-blue-600 hover:underline">
                + Add condition
              </button>
            )}
          </div>
        </section>
      ))}

      <button type="button" disabled={saving || questions.length === 0}
        onClick={() => onChange({ ...value, endings: [...endings, { id: nanoid(), name: `Ending ${endings.length + 1}`, conditions: [], message: "Thanks for your response!" }] })}
        className="w-full rounded-md border border-dashed border-zinc-300 py-2.5 text-xs font-medium text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 disabled:opacity-40">
        + Add custom ending screen
      </button>
    </div>
  );
}
