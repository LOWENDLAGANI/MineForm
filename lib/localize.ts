"use client";

import type { Question, Translation } from "@/lib/types";

/**
 * Client-side localization + display helpers for the public renderer.
 * The first locale in form.settings.locales is the default; the default
 * locale always falls back to the original text.
 */
export function localizedQuestion(q: Question, locale: string | null): Question {
  if (!locale) return q;
  const t: Translation | undefined = q.translations?.[locale];
  if (!t) return q;
  const optMap: Record<string, string> = t.options ?? {};
  return {
    ...q,
    question_text: t.text !== undefined && t.text !== "" ? t.text : q.question_text,
    options: q.options.map((o) => ({
      ...o,
      label: optMap[o.id] !== undefined ? (optMap[o.id] as string) : o.label,
    })),
  };
}

export function defaultLocale(locales: string[] | undefined | null): string | null {
  if (!locales || locales.length < 2) return null;
  return locales[0] ?? null;
}

/** Fisher–Yates on a copy — used for question/option randomization. */
export function shuffle<T>(items: T[]): T[] {
  const out: T[] = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export function applyQuestionRandomization(questions: Question[], enabled: boolean): Question[] {
  return enabled ? shuffle(questions) : questions;
}

export function applyOptionRandomization(questions: Question[]): Question[] {
  return questions.map((q) =>
    q.shuffle_options && (q.question_type === "single_choice" || q.question_type === "multi_choice" || q.question_type === "dropdown")
      ? { ...q, options: shuffle(q.options) }
      : q,
  );
}

/** Google Fonts <link> injection for the picked heading/body fonts. */
const FONT_CSS_NAMES: Record<string, string> = {
  inter: "Inter:wght@400;500;600;700",
  poppins: "Poppins:wght@400;500;600;700",
  playfair: "Playfair+Display:wght@400;600;700",
  lora: "Lora:wght@400;600",
  "space-grotesk": "Space+Grotesk:wght@400;500;700",
  "roboto-mono": "Roboto+Mono:wght@400;600",
  "source-sans": "Source+Sans+3:wght@400;600",
  "dm-sans": "DM+Sans:wght@400;500;700",
  caveat: "Caveat:wght@500;700",
};

const FONT_STACKS: Record<string, string> = {
  inter: "Inter, ui-sans-serif, system-ui, sans-serif",
  system: "ui-sans-serif, system-ui, sans-serif",
  poppins: "'Poppins', ui-sans-serif, system-ui, sans-serif",
  playfair: "'Playfair Display', Georgia, serif",
  lora: "'Lora', Georgia, serif",
  "space-grotesk": "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
  "roboto-mono": "'Roboto Mono', ui-monospace, monospace",
  "source-sans": "'Source Sans 3', ui-sans-serif, system-ui, sans-serif",
  "dm-sans": "'DM Sans', ui-sans-serif, system-ui, sans-serif",
  caveat: "'Caveat', cursive",
};

export function ensureGoogleFontsLoaded(fonts: string[]): void {
  if (typeof document === "undefined") return;
  const needed = [...new Set(fonts)].filter((f) => f !== "system" && FONT_CSS_NAMES[f]);
  if (needed.length === 0) return;
  const id = "mineform-google-fonts";
  let link = document.getElementById(id) as HTMLLinkElement | null;
  const families = needed.map((f) => `family=${FONT_CSS_NAMES[f]}`).join("&");
  const href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  if (!link) {
    link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  // Multiple forms never clash — one link, latest wins; fonts are additive.
  if (!link.href.includes(families)) link.href = href;
}

export function fontStack(font: string): string {
  return (font && FONT_STACKS[font]) || FONT_STACKS.inter || "system-ui, sans-serif";
}
