"use client";

import { useState } from "react";
import type { Option, Question } from "@/lib/types";

const input =
  "h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-1 focus:ring-inset focus:ring-zinc-900 sm:h-auto sm:py-1 sm:text-xs";

export function OptionsEditor({
  question,
  scoringEnabled,
  onChange,
}: {
  question: Question;
  /** Quiz mode on → show a points field per option. */
  scoringEnabled?: boolean;
  /** Receives the full patch to apply to the question (options or validation_rules). */
  onChange: (patch: Partial<Question>) => void;
}) {
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const hasOptions =
    question.question_type === "single_choice" ||
    question.question_type === "multi_choice" ||
    question.question_type === "dropdown";

  if (question.question_type === "rating") {
    const max = question.validation_rules.maxRating ?? 5;
    return (
      <div className="mx-3 mb-3 rounded-md bg-zinc-50 px-3 py-3 sm:mx-0 sm:rounded-none sm:px-10 sm:py-2">
        <span className="text-xs text-zinc-500">Rating scale: 1 to</span>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:mt-0">
          {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() =>
                onChange({ validation_rules: { ...question.validation_rules, maxRating: n } })
              }
              className={`h-10 w-10 rounded-md border font-mono text-xs sm:h-6 sm:w-6 ${
                max === n
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-900"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        {scoringEnabled && (
          <p className="mt-2 text-[11px] text-zinc-400">Scoring: the picked rating value counts as points.</p>
        )}
      </div>
    );
  }

  if (!hasOptions) return null;

  const options: Option[] = question.options ?? [];

  function patchOptions(next: Option[]) {
    onChange({ options: next });
  }

  function updateLabel(index: number, label: string) {
    patchOptions(options.map((o, i) => (i === index ? { ...o, label } : o)));
  }

  function updatePoints(index: number, points: string) {
    const n = points.trim() === "" ? undefined : Number(points);
    patchOptions(options.map((o, i) => (i === index ? { ...o, points: Number.isFinite(n) ? n : undefined } : o)));
  }

  function toggleExclusive(index: number) {
    patchOptions(
      options.map((o, i) =>
        i === index ? { ...o, isExclusive: !o.isExclusive } : { ...o, isExclusive: false },
      ),
    );
  }

  function removeOption(index: number) {
    patchOptions(options.filter((_, i) => i !== index));
  }

  function addOption() {
    patchOptions([...options, { id: crypto.randomUUID(), label: `Option ${options.length + 1}` }]);
  }

  function applyBulk() {
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) { setBulkOpen(false); return; }
    // Replace existing options with the pasted list (that's the expected
    // "paste my 20 options" workflow) — undo is available via the editor.
    patchOptions(lines.map((label) => ({ id: crypto.randomUUID(), label: label.slice(0, 200) })));
    setBulkText("");
    setBulkOpen(false);
  }

  // Empty choice question: show a clear call-to-action (seeding also happens
  // when the type is picked in QuestionRow, this catches legacy questions).
  if (options.length === 0) {
    return (
      <div className="mx-3 mb-3 rounded-md bg-zinc-50 px-3 py-3 sm:mx-0 sm:rounded-none sm:px-10 sm:py-2">
        <p className="text-xs text-zinc-500">
          No options yet — add at least one so people can answer.
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={addOption}
            className="w-full rounded-md border border-zinc-300 bg-white py-2.5 text-xs font-medium text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 sm:w-auto sm:px-2 sm:py-1"
          >
            + Add option
          </button>
          <button
            type="button" onClick={() => setBulkOpen(true)}
            className="w-full rounded-md border border-zinc-300 bg-white py-2.5 text-xs font-medium text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 sm:w-auto sm:px-2 sm:py-1"
          >
            Paste list
          </button>
        </div>
        {bulkOpen && (
          <div className="mt-3 rounded-md border border-zinc-200 bg-white p-2">
            <textarea rows={5} value={bulkText} onChange={(e) => setBulkText(e.target.value)}
              placeholder={"One option per line:\nCoffee\nTea\nJuice"}
              className={input + " resize-y font-mono text-xs"} aria-label="Bulk options" />
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={applyBulk}
                className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
                Add {bulkText.split("\n").filter((l) => l.trim()).length || ""} options
              </button>
              <button type="button" onClick={() => setBulkOpen(false)}
                className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs text-zinc-500 hover:border-zinc-900">Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-3 mb-3 rounded-md bg-zinc-50 px-3 py-2 sm:mx-0 sm:rounded-none sm:px-10 sm:py-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-500">Answer options</span>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-zinc-400 sm:block">
            "Ends form" = picking it finishes the form
          </span>
          <button type="button" onClick={() => setBulkOpen((s) => !s)}
            className="text-xs font-medium text-blue-600 hover:underline">
            {bulkOpen ? "Close paste" : "Paste list"}
          </button>
        </div>
      </div>

      {bulkOpen && (
        <div className="mt-2 rounded-md border border-zinc-200 bg-white p-2">
          <textarea rows={5} value={bulkText} onChange={(e) => setBulkText(e.target.value)}
            placeholder={"One option per line — replaces the current list:\nCoffee\nTea\nJuice"}
            className={input + " resize-y font-mono text-xs"} aria-label="Bulk options" />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={applyBulk}
              className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
              Replace with {bulkText.split("\n").filter((l) => l.trim()).length || ""} options
            </button>
            <button type="button" onClick={() => setBulkOpen(false)}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs text-zinc-500 hover:border-zinc-900">Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-2 space-y-2 sm:mt-0 sm:space-y-0 sm:divide-y sm:divide-zinc-200">
        {options.map((opt, i) => (
          <div key={opt.id} className="flex items-center gap-2 sm:gap-2">
            <span className="w-5 shrink-0 font-mono text-xs text-zinc-400">
              {String.fromCharCode(65 + i)}
            </span>
            <input
              value={opt.label}
              onChange={(e) => updateLabel(i, e.target.value)}
              maxLength={200}
              placeholder={`Option ${i + 1}`}
              className={input}
              aria-label={`Option ${i + 1} label`}
            />
            {scoringEnabled && (
              <input
                type="number" inputMode="numeric"
                value={opt.points ?? ""}
                onChange={(e) => updatePoints(i, e.target.value)}
                placeholder="pts"
                aria-label={`Points for option ${i + 1}`}
                className="w-14 shrink-0 rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-center text-xs outline-none focus:border-zinc-900"
              />
            )}
            <button
              type="button"
              onClick={() => toggleExclusive(i)}
              title="Choosing this option ends the form (e.g. 'None of the above')"
              aria-pressed={opt.isExclusive}
              className={`h-11 shrink-0 rounded-md border px-2.5 text-xs font-medium sm:h-7 sm:rounded-none ${
                opt.isExclusive
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-300 bg-white text-zinc-400 hover:border-zinc-400"
              }`}
            >
              Ends form
            </button>
            <button
              type="button"
              onClick={() => removeOption(i)}
              className="grid h-11 w-9 shrink-0 place-items-center text-lg text-zinc-400 hover:text-red-600 sm:h-8"
              aria-label={`Remove option ${i + 1}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={addOption}
          className="w-full rounded-md border border-dashed border-zinc-300 py-2.5 text-xs font-medium text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 sm:mt-0 sm:w-auto sm:border-solid sm:px-2 sm:py-1"
        >
          + Add option
        </button>
        <label className="ml-3 hidden shrink-0 items-center gap-1.5 text-[11px] text-zinc-500 sm:flex">
          <input type="checkbox" checked={question.shuffle_options ?? false}
            onChange={(e) => onChange({ shuffle_options: e.target.checked })}
            className="h-3.5 w-3.5 accent-zinc-900" />
          Shuffle order
        </label>
      </div>
    </div>
  );
}
