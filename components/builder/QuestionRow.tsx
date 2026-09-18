"use client";

/**
 * QuestionRow — touch-first question editor.
 * Mobile: card layout, always-visible ↑/↓ buttons, 44px tap targets,
 * plain-English buttons (Required / Delete). Desktop keeps the dense table.
 */

import { useState } from "react";
import type { Question, QuestionType } from "@/lib/types";

const TYPE_LABELS: Record<QuestionType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  single_choice: "Single choice",
  multi_choice: "Multi choice",
  dropdown: "Dropdown",
  rating: "Rating",
  date: "Date",
  number: "Number",
  email: "Email",
  file_upload: "File upload",
};

const TYPE_ORDER = Object.keys(TYPE_LABELS) as QuestionType[];

const TYPES_WITH_OPTIONS: QuestionType[] = ["single_choice", "multi_choice", "dropdown"];

function starterOptions(): Question["options"] {
  return [
    { id: crypto.randomUUID(), label: "Option 1" },
    { id: crypto.randomUUID(), label: "Option 2" },
  ];
}

const selectCls =
  "h-11 w-full cursor-pointer appearance-none rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-700 outline-none focus:border-zinc-900 sm:h-9 sm:rounded-none sm:border-0 sm:border-r sm:border-zinc-200 sm:px-2";

export interface QuestionRowProps {
  question: Question;
  index: number;
  total: number;
  /** Commits a full question patch. Caller owns persistence. */
  onChange: (patch: Partial<Question>) => void;
  /** Move the question up/down in order. */
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}

export function QuestionRow({
  question,
  index,
  total,
  onChange,
  onMove,
  onDelete,
}: QuestionRowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white sm:rounded-none sm:border-0 sm:border-b">
      {/* Top row: order + type + reorder */}
      <div className="flex items-center gap-2 px-3 pt-3 sm:px-0 sm:pt-0">
        <span className="select-none font-mono text-xs text-zinc-400">
          {String(index + 1).padStart(2, "0")}
        </span>

        <select
          value={question.question_type}
          onChange={(e) => {
            const nextType = e.target.value as QuestionType;
            // Seed options when switching to a choice type with none,
            // so the respondent never sees an unanswerable empty box.
            const patch: Partial<Question> = { question_type: nextType };
            if (
              TYPES_WITH_OPTIONS.includes(nextType) &&
              (question.options ?? []).length === 0
            ) {
              patch.options = starterOptions();
            }
            onChange(patch);
          }}
          className={selectCls}
          aria-label={`Type for question ${index + 1}`}
        >
          {TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-1 sm:hidden">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label="Move question up"
            className="grid h-11 w-11 place-items-center rounded-md border border-zinc-200 text-zinc-600 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label="Move question down"
            className="grid h-11 w-11 place-items-center rounded-md border border-zinc-200 text-zinc-600 disabled:opacity-30"
          >
            ↓
          </button>
        </div>
      </div>

      {/* Question text — direct input, no click-to-edit */}
      <div className="px-3 pb-2 pt-2 sm:px-0 sm:pb-0 sm:pt-0">
        <input
          value={question.question_text}
          onChange={(e) => onChange({ question_text: e.target.value })}
          onBlur={(e) => {
            if (e.target.value.trim() === "") {
              onChange({ question_text: "Untitled question" });
            }
          }}
          maxLength={5000}
          placeholder="Type your question here…"
          aria-label={`Question ${index + 1} text`}
          className="h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-1 focus:ring-inset focus:ring-zinc-900 sm:h-9 sm:rounded-none sm:border-0 sm:bg-transparent sm:px-3 sm:focus:ring-0 sm:focus:border-zinc-200"
        />
      </div>

      {/* Bottom row: required toggle + delete (+ desktop reorder) */}
      <div className="flex items-center justify-between px-3 pb-3 sm:justify-end sm:gap-1 sm:px-0 sm:pb-0">
        <button
          type="button"
          onClick={() => onChange({ is_required: !question.is_required })}
          aria-pressed={question.is_required}
          className={`h-9 rounded-md border px-3 text-xs font-medium sm:h-6 sm:rounded-none ${
            question.is_required
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-300 bg-white text-zinc-500 hover:border-zinc-400"
          }`}
        >
          {question.is_required ? "Required ✓" : "Required"}
        </button>

        {confirmDelete ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={onDelete}
              className="h-9 rounded-md bg-red-600 px-3 text-xs font-medium text-white sm:h-6 sm:rounded-none"
            >
              Confirm delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="h-9 rounded-md border border-zinc-300 px-3 text-xs text-zinc-600 sm:h-6 sm:rounded-none"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="h-9 rounded-md border border-transparent px-3 text-xs font-medium text-zinc-400 hover:border-zinc-200 hover:text-red-600 sm:h-6 sm:rounded-none"
          >
            Delete
          </button>
        )}

        {/* Desktop hover reorder */}
        <span className="hidden items-center gap-0.5 sm:flex">
          <button
            type="button"
            tabIndex={-1}
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="px-1 text-xs text-zinc-400 hover:text-zinc-900 disabled:opacity-0"
            aria-label="Move question up"
          >
            ↑
          </button>
          <button
            type="button"
            tabIndex={-1}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            className="px-1 text-xs text-zinc-400 hover:text-zinc-900 disabled:opacity-0"
            aria-label="Move question down"
          >
            ↓
          </button>
        </span>
      </div>
    </div>
  );
}
