"use client";

/**
 * FieldRenderer — respondent-side input for a single question.
 *
 * Touch-first contract:
 *  - 44px+ tap targets on every option, rating button and input
 *  - text-base inputs (16px+ prevents iOS focus zoom)
 *  - selected options invert with a visible border + check, not color only
 *  - error text below the field with aria wiring
 *
 * Visual language: light-blue filled inputs (#eff6ff) that turn white with a
 * blue ring on focus, blue pill option rows — matches the brand backdrop.
 */

import { useId } from "react";
import type { Question } from "@/lib/types";

export interface FieldRendererProps {
  question: Question;
  /** Position in the visible form, 0-based — shown as "Q1", "Q2"… */
  index?: number;
  value: string | string[] | number | null;
  error?: string | null;
  disabled?: boolean;
  onChange: (value: string | string[] | number | null) => void;
}

const inputBase =
  "min-h-12 w-full rounded-lg border border-blue-100 bg-blue-50/60 px-3.5 py-3 text-base text-zinc-900 " +
  "outline-none transition-all placeholder:text-blue-300 " +
  "focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/30 " +
  "disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400";

const inputError = "border-red-400 focus:border-red-500 focus:ring-red-500/25";

export function FieldRenderer({
  question,
  index,
  value,
  error,
  disabled,
  onChange,
}: FieldRendererProps) {
  const id = useId();
  const errorId = `${id}-err`;
  const rules = question.validation_rules;

  return (
    <div className="py-3" data-has-error={error ? "true" : "false"}>
      {/* Label row */}
      <div className="mb-2">
        <label htmlFor={id} className="block text-base font-medium text-zinc-900">
          {typeof index === "number" && (
            <span className="mr-2 font-mono text-xs font-medium text-blue-500">
              {String(index + 1).padStart(2, "0")}
            </span>
          )}
          {question.question_text}
          {question.is_required && <span className="ml-1 text-blue-600">*</span>}
        </label>
        {question.question_type === "rating" && rules.maxRating && (
          <p className="mt-0.5 text-xs text-zinc-400">Tap a number from 1 to {rules.maxRating}</p>
        )}
      </div>

      {/* Input */}
      {question.question_type === "short_text" ||
      question.question_type === "email" ||
      question.question_type === "number" ||
      question.question_type === "date" ? (
        <input
          id={id}
          type={
            question.question_type === "email"
              ? "email"
              : question.question_type === "number"
                ? "number"
                : question.question_type === "date"
                  ? "date"
                  : "text"
          }
          inputMode={
            question.question_type === "number"
              ? "decimal"
              : question.question_type === "email"
                ? "email"
                : undefined
          }
          value={value === null || Array.isArray(value) ? "" : String(value)}
          min={rules.min}
          max={rules.max}
          step={rules.step}
          maxLength={rules.maxLength}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) =>
            onChange(
              question.question_type === "number" && e.target.value !== ""
                ? Number(e.target.value)
                : e.target.value === ""
                  ? null
                  : e.target.value,
            )
          }
          className={`${inputBase} ${error ? inputError : ""}`}
        />
      ) : question.question_type === "long_text" ? (
        <textarea
          id={id}
          value={typeof value === "string" ? value : ""}
          rows={4}
          maxLength={rules.maxLength}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          className={`${inputBase} resize-y ${error ? inputError : ""}`}
        />
      ) : question.question_type === "single_choice" ||
        question.question_type === "dropdown" ? (
        question.options.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-sm text-zinc-400">
            This question has no options yet and can't be answered.
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-labelledby={id}
            className="space-y-2"
          >
            {question.options.map((opt) => {
              const selected = value === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => onChange(selected ? null : opt.id)}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-full border px-4 py-3 text-left text-base transition-all ${
                    selected
                      ? "border-blue-600 bg-blue-600 text-white shadow-sm shadow-blue-600/30"
                      : "border-blue-100 bg-blue-50/60 text-zinc-900 hover:border-blue-300 hover:bg-blue-50"
                  }`}
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors ${
                      selected ? "border-white" : "border-blue-300"
                    }`}
                  >
                    {selected && <span className="h-2 w-2 rounded-full bg-white" />}
                  </span>
                  <span className="min-w-0 flex-1">{opt.label}</span>
                  {selected && <span className="shrink-0 text-sm">✓</span>}
                </button>
              );
            })}
          </div>
        )
      ) : question.question_type === "multi_choice" ? (
        (question.options ?? []).length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-sm text-zinc-400">
            This question has no options yet and can't be answered.
          </p>
        ) : (
          <div className="space-y-2">
            {(question.options ?? []).map((opt) => {
              const arr = Array.isArray(value) ? value : [];
              const checked = arr.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  disabled={disabled}
                  onClick={() => {
                    // Exclusive options clear the rest; any other pick clears exclusives.
                    let next: string[];
                    if (opt.isExclusive) {
                      next = checked ? [] : [opt.id];
                    } else {
                      const withoutExclusive = arr.filter(
                        (v) => question.options.find((o) => o.id === v)?.isExclusive !== true,
                      );
                      next = checked
                        ? withoutExclusive.filter((v) => v !== opt.id)
                        : [...withoutExclusive, opt.id];
                    }
                    onChange(next.length === 0 ? null : next);
                  }}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-full border px-4 py-3 text-left text-base transition-all ${
                    checked
                      ? "border-blue-600 bg-blue-600 text-white shadow-sm shadow-blue-600/30"
                      : "border-blue-100 bg-blue-50/60 text-zinc-900 hover:border-blue-300 hover:bg-blue-50"
                  }`}
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition-colors ${
                      checked ? "border-white" : "border-blue-300"
                    }`}
                  >
                    {checked && <span className="text-xs leading-none">✓</span>}
                  </span>
                  <span className="min-w-0 flex-1">{opt.label}</span>
                  {checked && <span className="shrink-0 text-sm">✓</span>}
                </button>
              );
            })}
          </div>
        )
      ) : question.question_type === "rating" ? (
        <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap items-center gap-2">
          {Array.from({ length: rules.maxRating ?? 5 }, (_, i) => i + 1).map((n) => {
            const num = typeof value === "number" ? value : 0;
            const active = num === n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${n} of ${rules.maxRating ?? 5}`}
                disabled={disabled}
                onClick={() => onChange(active ? null : n)}
                className={`h-12 w-12 rounded-full border text-base font-medium transition-all active:scale-95 ${
                  active
                    ? "border-blue-600 bg-blue-600 text-white shadow-sm shadow-blue-600/30"
                    : "border-blue-100 bg-blue-50/60 text-zinc-700 hover:border-blue-400"
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
      ) : (
        // file_upload placeholder — wire to Supabase Storage in the upload route
        <input
          type="file"
          id={id}
          disabled={disabled}
          className="block w-full rounded-lg border border-dashed border-blue-200 bg-blue-50/60 px-3 py-3 text-sm text-zinc-600 file:mr-3 file:rounded-full file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-xs file:text-white"
        />
      )}

      {/* Error line */}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
