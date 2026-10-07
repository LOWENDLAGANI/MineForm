"use client";

import { nanoid } from "@/lib/nanoid";

const input = "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 sm:text-sm";

export function HiddenFieldsEditor({
  fields, saving, onChange,
}: {
  fields: string[];
  saving: boolean;
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-zinc-400">
        Capture URL params like <code className="font-mono">?utm_source=x</code> with each response. Use them in ending
        messages with <code className="font-mono">{"{{field:utm_source}}"}</code>.
      </p>
      {fields.map((f, i) => (
        <div key={i} className="flex items-center gap-2">
          <code className="shrink-0 font-mono text-xs text-zinc-400">{"{{field:"}</code>
          <input value={f} disabled={saving} aria-label={`Hidden field ${i + 1}`}
            onChange={(e) => onChange(fields.map((x, j) => j === i ? e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") : x))}
            className={input} />
          <code className="shrink-0 font-mono text-xs text-zinc-400">{"}}"}</code>
          <button type="button" disabled={saving} onClick={() => onChange(fields.filter((_, j) => j !== i))}
            className="text-xs text-zinc-400 hover:text-red-600" aria-label={`Remove ${f}`}>×</button>
        </div>
      ))}
      {fields.length < 20 && (
        <button type="button" disabled={saving} onClick={() => onChange([...fields, `field_${fields.length + 1}`])}
          className="text-[11px] font-medium text-blue-600 hover:underline">
          + Add hidden field
        </button>
      )}
    </div>
  );
}
