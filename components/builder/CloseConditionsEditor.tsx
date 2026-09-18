"use client";

/**
 * CloseConditionsEditor — owner-side close rules.
 *  - Auto-close by date
 *  - Conditional close: "close when N answers to Q match a value"
 * Rules OR together: any met condition closes the form.
 */

import { useMemo, useState } from "react";
import type { CloseCondition, Question } from "@/lib/types";

export interface CloseConfigValue {
  close_at?: string | null;
  conditions?: CloseCondition[];
}

export interface CloseConditionsEditorProps {
  value: CloseConfigValue;
  questions: Question[];
  disabled?: boolean;
  onChange: (next: CloseConfigValue) => void;
}

export function CloseConditionsEditor({
  value,
  questions,
  disabled,
  onChange,
}: CloseConditionsEditorProps) {
  const conditions = value.conditions ?? [];
  const [showEditor, setShowEditor] = useState(false);

  const choiceQuestions = useMemo(
    () =>
      questions.filter((q) =>
        ["single_choice", "multi_choice", "dropdown", "rating", "short_text", "email", "number"].includes(
          q.question_type,
        ),
      ),
    [questions],
  );

  function setCloseAt(raw: string) {
    onChange({
      ...value,
      close_at: raw ? new Date(raw).toISOString() : null,
    });
  }

  function addCondition() {
    onChange({
      ...value,
      conditions: [
        ...conditions,
        {
          question_id: choiceQuestions[0]?.id ?? "",
          operator: "eq",
          value: "",
          count: 1,
        },
      ],
    });
  }

  function patchCondition(i: number, patch: Partial<CloseCondition>) {
    onChange({
      ...value,
      conditions: conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    });
  }

  function removeCondition(i: number) {
    onChange({
      ...value,
      conditions: conditions.filter((_, idx) => idx !== i),
    });
  }

  const condLabel = (qid: string) =>
    questions.find((q) => q.id === qid)?.question_text ?? "—";

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-zinc-600" htmlFor="f-close-at">
          Auto-close date
        </label>
        <input
          id="f-close-at"
          type="datetime-local"
          disabled={disabled}
          value={value.close_at ? toLocalInput(value.close_at) : ""}
          onChange={(e) => setCloseAt(e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-inset focus:ring-zinc-900"
        />
        <p className="mt-1 text-[11px] text-zinc-400">
          The form stops accepting responses after this moment.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-600">Close conditions</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowEditor((s) => !s)}
            className="text-xs text-zinc-500 hover:text-zinc-900"
          >
            {showEditor ? "Hide" : "Edit"}
          </button>
        </div>

        {!showEditor ? (
          <p className="mt-1 text-[11px] text-zinc-400">
            {conditions.length === 0
              ? "None — form stays open until capped or unpublished."
              : `${conditions.length} condition${conditions.length > 1 ? "s" : ""} set`}
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {conditions.map((c, i) => (
              <div key={i} className="space-y-2 rounded-md border border-zinc-200 p-2.5">
                <div className="flex items-start gap-2">
                  <span className="pt-1.5 text-xs text-zinc-400">When</span>
                  <select
                    value={c.question_id}
                    disabled={disabled}
                    onChange={(e) => patchCondition(i, { question_id: e.target.value })}
                    className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs"
                  >
                    {choiceQuestions.length === 0 && <option value="">No eligible questions</option>}
                    {choiceQuestions.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.question_text.slice(0, 60) || `Question ${q.order_index + 1}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeCondition(i)}
                    className="pt-1 text-xs text-zinc-400 hover:text-red-600"
                    aria-label="Remove condition"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={c.operator}
                    disabled={disabled}
                    onChange={(e) =>
                      patchCondition(i, { operator: e.target.value as "eq" | "contains" })
                    }
                    className="rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs"
                  >
                    <option value="eq">equals</option>
                    <option value="contains">contains</option>
                  </select>
                  <input
                    value={c.value}
                    disabled={disabled}
                    placeholder="value (e.g. yes)"
                    onChange={(e) => patchCondition(i, { value: e.target.value })}
                    className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span>after</span>
                  <input
                    type="number"
                    min={1}
                    disabled={disabled}
                    value={c.count ?? 1}
                    onChange={(e) => patchCondition(i, { count: Number(e.target.value) || 1 })}
                    className="w-16 rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs"
                  />
                  <span>
                    response{((c.count ?? 1) > 1 ? "s" : "")} match — closes form
                  </span>
                </div>
                {c.question_id && (
                  <p className="truncate text-[11px] text-zinc-400">
                    Watching: {condLabel(c.question_id)}
                  </p>
                )}
              </div>
            ))}
            <button
              type="button"
              disabled={disabled || choiceQuestions.length === 0}
              onClick={addCondition}
              className="w-full rounded-md border border-dashed border-zinc-300 py-1.5 text-xs text-zinc-500 hover:border-zinc-900 hover:text-zinc-900 disabled:opacity-40"
            >
              + Add condition
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
