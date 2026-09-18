"use client";

/**
 * OptionsEditor — inline editing for a question's options block.
 * Touch-first: 44px rows, plain-english "Ends form" toggle, add/remove.
 * Mobile adds auto-insert of two starter options for empty choice questions
 * so respondents never see an unanswerable empty box.
 */

import type { Option, Question } from "@/lib/types";

const input =
  "h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-1 focus:ring-inset focus:ring-zinc-900 sm:h-auto sm:py-1 sm:text-xs";

export function OptionsEditor({
  question,
  onChange,
}: {
  question: Question;
  /** Receives the full patch to apply to the question (options or validation_rules). */
  onChange: (patch: Partial<Question>) => void;
}) {
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

  // Empty choice question: show a clear call-to-action (seeding also happens
  // when the type is picked in QuestionRow, this catches legacy questions).
  if (options.length === 0) {
    return (
      <div className="mx-3 mb-3 rounded-md bg-zinc-50 px-3 py-3 sm:mx-0 sm:rounded-none sm:px-10 sm:py-2">
        <p className="text-xs text-zinc-500">
          No options yet — add at least one so people can answer.
        </p>
        <button
          type="button"
          onClick={addOption}
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white py-2.5 text-xs font-medium text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 sm:w-auto sm:px-2 sm:py-1"
        >
          + Add option
        </button>
      </div>
    );
  }

  return (
    <div className="mx-3 mb-3 rounded-md bg-zinc-50 px-3 py-2 sm:mx-0 sm:rounded-none sm:px-10 sm:py-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-500">Answer options</span>
        <span className="hidden text-xs text-zinc-400 sm:block">
          "Ends form" = picking it finishes the form
        </span>
      </div>
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
      <button
        type="button"
        onClick={addOption}
        className="mt-2 w-full rounded-md border border-dashed border-zinc-300 py-2.5 text-xs font-medium text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 sm:mt-0 sm:w-auto sm:border-solid sm:px-2 sm:py-1"
      >
        + Add option
      </button>
    </div>
  );
}
