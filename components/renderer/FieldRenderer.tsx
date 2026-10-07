"use client";

import { useId } from "react";
import type { Question } from "@/lib/types";

export interface FieldRendererProps {
  question: Question;
  index?: number;
  value: string | string[] | number | null;
  error?: string | null;
  disabled?: boolean;
  onChange: (value: string | string[] | number | null) => void;
}

const inputBase =
  "accent-soft accent-field min-h-12 w-full rounded-lg border px-3.5 py-3 text-base text-zinc-900 " +
  "outline-none transition-all placeholder:text-zinc-400 " +
  "disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400";

const inputError = "field-error";

export function FieldRenderer({
  question, index, value, error, disabled, onChange,
}: FieldRendererProps) {
  const id = useId();
  const errorId = `${id}-err`;
  const rules = question.validation_rules;

  return (
    <div className="py-3" data-has-error={error ? "true" : "false"}>
      <div className="mb-2">
        <label htmlFor={id} className="block text-base font-medium text-zinc-900">
          {typeof index === "number" && (
            <span className="accent-text mr-2 font-mono text-xs font-medium">
              {String(index + 1).padStart(2, "0")}
            </span>
          )}
          {question.question_text}
          {question.is_required && <span className="accent-text ml-1">*</span>}
        </label>
        {question.question_type === "rating" && rules.maxRating && (
          <p className="mt-0.5 text-xs text-zinc-400">1 – {rules.maxRating}</p>
        )}
      </div>

      {question.question_type === "short_text" ||
      question.question_type === "email" ||
      question.question_type === "number" ||
      question.question_type === "date" ? (
        <input
          id={id}
          type={
            question.question_type === "email" ? "email"
              : question.question_type === "number" ? "number"
              : question.question_type === "date" ? "date"
              : "text"
          }
          inputMode={
            question.question_type === "number" ? "decimal"
              : question.question_type === "email" ? "email"
              : undefined
          }
          value={value === null || Array.isArray(value) ? "" : String(value)}
          min={rules.min} max={rules.max} step={rules.step} maxLength={rules.maxLength}
          disabled={disabled}
          aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(
            question.question_type === "number" && e.target.value !== "" ? Number(e.target.value)
              : e.target.value === "" ? null : e.target.value
          )}
          className={`${inputBase} ${error ? inputError : ""}`}
        />
      ) : question.question_type === "long_text" ? (
        <textarea
          id={id} value={typeof value === "string" ? value : ""} rows={4}
          maxLength={rules.maxLength} disabled={disabled}
          aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          className={`${inputBase} resize-y ${error ? inputError : ""}`}
        />
      ) : question.question_type === "single_choice" ||
        question.question_type === "dropdown" ? (
        question.options.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-sm text-zinc-400">
            No options yet.
          </p>
        ) : (
          <div role="radiogroup" aria-labelledby={id} className="space-y-2">
            {question.options.map((opt) => {
              const selected = value === opt.id;
              return (
                <button
                  key={opt.id} type="button" role="radio"
                  aria-checked={selected} disabled={disabled}
                  onClick={() => onChange(selected ? null : opt.id)}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-full border px-4 py-3 text-left text-base transition-all ${
                    selected
                      ? "accent-border accent-bg text-white shadow-sm shadow-blue-600/30"
                      : "accent-soft text-zinc-900"
                  }`}
                >
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors ${
                    selected ? "border-white" : "border-zinc-300"
                  }`}>
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
            No options yet.
          </p>
        ) : (
          <div className="space-y-2">
            {(question.options ?? []).map((opt) => {
              const arr = Array.isArray(value) ? value : [];
              const checked = arr.includes(opt.id);
              return (
                <button
                  key={opt.id} type="button" role="checkbox"
                  aria-checked={checked} disabled={disabled}
                  onClick={() => {
                    let next: string[];
                    if (opt.isExclusive) {
                      next = checked ? [] : [opt.id];
                    } else {
                      const withoutExclusive = arr.filter(
                        (v) => question.options.find((o) => o.id === v)?.isExclusive !== true
                      );
                      next = checked
                        ? withoutExclusive.filter((v) => v !== opt.id)
                        : [...withoutExclusive, opt.id];
                    }
                    onChange(next.length === 0 ? null : next);
                  }}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-full border px-4 py-3 text-left text-base transition-all ${
                    checked
                      ? "accent-border accent-bg text-white shadow-sm shadow-blue-600/30"
                      : "accent-soft text-zinc-900"
                  }`}
                >
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition-colors ${
                    checked ? "border-white" : "border-zinc-300"
                  }`}>
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
                key={n} type="button" role="radio" aria-checked={active}
                aria-label={`${n} of ${rules.maxRating ?? 5}`} disabled={disabled}
                onClick={() => onChange(active ? null : n)}
                className={`h-12 w-12 rounded-full border text-base font-medium transition-all active:scale-95 ${
                  active
                    ? "accent-border accent-bg text-white shadow-sm shadow-blue-600/30"
                    : "accent-soft text-zinc-700"
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
      ) : question.question_type === "file_upload" ? (
        /* No object storage yet: collect a share link so the question stays
           answerable (the old file input did nothing on change, which made
           required file questions impossible to submit). */
        <div>
          <input
            id={id}
            type="url"
            inputMode="url"
            placeholder="https://…"
            value={value === null || Array.isArray(value) ? "" : String(value)}
            disabled={disabled}
            aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
            onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
            className={`${inputBase} ${error ? inputError : ""}`}
          />
          <p className="mt-1.5 text-xs text-zinc-400">
            Paste a link to your file — Google Drive, Dropbox, WeTransfer…
          </p>
        </div>
      ) : (
        <input
          id={id} type="text" disabled={disabled}
          value={value === null || Array.isArray(value) ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          className={`${inputBase} ${error ? inputError : ""}`}
        />
      )}

      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
