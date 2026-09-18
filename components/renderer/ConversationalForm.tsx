"use client";

/**
 * ConversationalForm — Typeform-style renderer mode.
 * One visible question per screen, slide/fade transition between questions,
 * Enter advances, progress dots, back navigation. Auto-advances on choice
 * selection when the question isn't required to be revisited.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FieldRenderer } from "./FieldRenderer";
import type { Question } from "@/lib/types";

export interface ConversationalFormProps {
  title: string;
  description: string | null;
  questions: Question[];
  values: Record<string, string | string[] | number | null>;
  errors: Record<string, string>;
  disabled: boolean;
  accent: string;
  onChange: (questionId: string, value: string | string[] | number | null) => void;
  onSubmit: () => void;
  submitting: boolean;
  footer?: React.ReactNode;
}

const TRANSITION_MS = 260;

export function ConversationalForm({
  title,
  description,
  questions,
  values,
  errors,
  disabled,
  accent,
  onChange,
  onSubmit,
  submitting,
  footer,
}: ConversationalFormProps) {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<"in" | "out">("in");
  const pendingStep = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const total = questions.length;
  const question = questions[Math.min(step, Math.max(0, total - 1))];
  const isLast = step >= total - 1;
  const isFirst = step === 0;

  const answeredOf = useCallback(
    (q: Question) => {
      const v = values[q.id];
      return !(v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0));
    },
    [values],
  );

  /** Can the user advance past the current question? */
  const canAdvance = useMemo(() => {
    if (!question) return false;
    if (question.is_required && !answeredOf(question)) return false;
    return true;
  }, [question, answeredOf]);

  const goTo = useCallback(
    (next: number) => {
      if (next === step || next < 0 || next >= total) return;
      pendingStep.current = next;
      setPhase("out");
    },
    [step, total],
  );

  // Transition: fade/slide out, swap question, slide in.
  useEffect(() => {
    if (phase !== "out") return;
    const t = setTimeout(() => {
      if (pendingStep.current !== null) {
        setStep(pendingStep.current);
        pendingStep.current = null;
      }
      setPhase("in");
      scrollRef.current?.scrollTo({ top: 0 });
    }, TRANSITION_MS * 0.55);
    return () => clearTimeout(t);
  }, [phase]);

  // Keyboard: Enter advances (unless typing a multiline answer).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      const el = document.activeElement;
      const inTextarea = el instanceof HTMLTextAreaElement;
      if (inTextarea) return; // Enter inserts a newline in long_text
      if (e.shiftKey) return;
      if (!canAdvance) return;
      e.preventDefault();
      if (isLast) onSubmit();
      else goTo(step + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canAdvance, isLast, onSubmit, goTo, step]);

  // Auto-advance on single-choice / rating / dropdown selection.
  const handleChange = useCallback(
    (q: Question, v: string | string[] | number | null) => {
      onChange(q.id, v);
      const autoAdvance =
        (q.question_type === "single_choice" ||
          q.question_type === "dropdown" ||
          q.question_type === "rating") &&
        v !== null;
      if (autoAdvance && !isLast) {
        window.setTimeout(() => goTo(step + 1), 320); // let the selection paint
      }
    },
    [onChange, goTo, step, isLast],
  );

  if (!question) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center justify-center px-5">
        <p className="text-sm text-zinc-400">This form has no questions.</p>
      </main>
    );
  }

  const animClass =
    phase === "out"
      ? "opacity-0 -translate-x-4"
      : "opacity-100 translate-x-0";

  const answeredCount = questions.filter(answeredOf).length;

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: "#ffffff" }}
    >
      {/* Top progress */}
      <header className="shrink-0 px-5 pt-5">
        <div className="mx-auto flex w-full max-w-md items-center gap-2">
          <span className="font-mono text-xs text-zinc-400">
            {String(step + 1).padStart(2, "0")}/{String(total).padStart(2, "0")}
          </span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${total === 0 ? 0 : Math.round((answeredCount / total) * 100)}%`,
                backgroundColor: accent,
              }}
            />
          </div>
        </div>
      </header>

      {/* Question stage */}
      <div
        ref={scrollRef}
        className="flex flex-1 items-center overflow-y-auto px-5 py-8"
      >
        <div
          className={`mx-auto w-full max-w-md transition-all ${animClass}`}
          style={{ transitionDuration: `${TRANSITION_MS}ms` }}
          aria-live="polite"
        >
          {/* Title/description only on the very first screen */}
          {isFirst && (
            <div className="mb-8">
              <h1 className="text-2xl font-medium tracking-tight text-zinc-900">{title}</h1>
              {description && (
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">{description}</p>
              )}
            </div>
          )}

          <FieldRenderer
            question={question}
            index={step}
            value={values[question.id] ?? null}
            error={errors[question.id] ?? null}
            disabled={disabled || phase === "out"}
            onChange={(v) => handleChange(question, v)}
          />

          <div className="mt-8 flex items-center gap-3">
            {!isFirst && (
              <button
                type="button"
                onClick={() => goTo(step - 1)}
                disabled={phase === "out"}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-zinc-300 text-zinc-500 hover:border-zinc-900 hover:text-zinc-900"
                aria-label="Previous question"
              >
                ↑
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? onSubmit() : goTo(step + 1))}
              disabled={!canAdvance || phase === "out" || (isLast && submitting)}
              style={canAdvance ? { backgroundColor: accent } : undefined}
              className={`h-11 min-w-32 rounded-full px-6 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40 ${
                canAdvance ? "hover:opacity-90" : "bg-zinc-300"
              }`}
            >
              {isLast
                ? submitting
                  ? "Submitting…"
                  : "Submit"
                : canAdvance
                  ? "OK"
                  : "Answer to continue"}
            </button>
            {!question.is_required && !isLast && !answeredOf(question) && (
              <button
                type="button"
                onClick={() => goTo(step + 1)}
                disabled={phase === "out"}
                className="text-sm text-zinc-400 hover:text-zinc-900"
              >
                Skip
              </button>
            )}
          </div>

          <p className="mt-6 hidden text-xs text-zinc-300 sm:block">
            press <kbd className="rounded border border-zinc-200 px-1 font-mono">Enter ↵</kbd>
          </p>
        </div>
      </div>

      {/* Question dots */}
      <footer className="shrink-0 px-5 pb-6">
        <div className="mx-auto flex w-full max-w-md items-center justify-center gap-1.5">
          {questions.map((q, i) => (
            <button
              key={q.id}
              type="button"
              aria-label={`Go to question ${i + 1}`}
              onClick={() => goTo(i)}
              disabled={phase === "out"}
              className="h-2 rounded-full transition-all"
              style={{
                width: i === step ? 20 : 8,
                backgroundColor:
                  i === step
                    ? accent
                    : answeredOf(q)
                      ? "#a1a1aa"
                      : "#e4e4e7",
              }}
            />
          ))}
        </div>
        {footer && <div className="mx-auto mt-4 w-full max-w-md">{footer}</div>}
      </footer>
    </div>
  );
}
