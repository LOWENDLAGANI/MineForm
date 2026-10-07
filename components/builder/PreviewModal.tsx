"use client";

import { useMemo, useState } from "react";
import { FieldRenderer } from "@/components/renderer/FieldRenderer";
import { ensureGoogleFontsLoaded, fontStack } from "@/lib/localize";
import type { DesignConfig } from "@/lib/types";
import type { Question } from "@/lib/types";

/**
 * Local builder preview — renders the real FieldRenderer with the saved
 * theme/design, at desktop or phone width. Works for drafts (no server).
 */
export function PreviewModal({
  title, description, questions, accent, design, onClose,
}: {
  title: string;
  description: string | null;
  questions: Question[];
  accent: string;
  design: Partial<DesignConfig>;
  onClose: () => void;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("mobile");
  const [values, setValues] = useState<Record<string, string | string[] | number | null>>({});

  const dark = design.dark_mode === "on" || (design.dark_mode === "auto" && typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);

  const fonts = useMemo(
    () => [design.heading_font ?? "inter", design.body_font ?? "inter"],
    [design.heading_font, design.body_font],
  );

  useMemo(() => { ensureGoogleFontsLoaded(fonts); return null; }, [fonts]);

  const bg = design.background_url
    ? { backgroundImage: `linear-gradient(rgba(0,0,0,${(design.overlay_opacity ?? 40) / 100}), rgba(0,0,0,${(design.overlay_opacity ?? 40) / 100})), url(${design.background_url})`, backgroundSize: "cover", backgroundPosition: "center" }
    : undefined;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950/70 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Form preview">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex gap-1.5">
          {(["mobile", "desktop"] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDevice(d)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize ${device === d ? "bg-white text-zinc-900" : "bg-white/15 text-white hover:bg-white/25"}`}>
              {d}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose}
          className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-200">
          Close preview
        </button>
      </div>
      <div className="flex flex-1 items-start justify-center overflow-y-auto">
        <div
          className={`overflow-hidden rounded-2xl shadow-2xl ${device === "mobile" ? "w-full max-w-[390px]" : "w-full max-w-2xl"}`}
          style={{ ...(bg ?? { background: dark ? "#18181b" : "#eef2ff" }), fontFamily: fontStack(design.body_font ?? "inter") }}
        >
          <div className={dark ? "mf-dark p-4 sm:p-6" : "p-4 sm:p-6"} style={{ "--accent": accent } as React.CSSProperties}>
            <h1 className="text-lg font-semibold text-zinc-900" style={{ fontFamily: fontStack(design.heading_font ?? "inter") }}>{title}</h1>
            {design.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={design.logo_url} alt="Form logo" className="mt-2 max-h-12" />
            )}
            {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
            <div className="mt-3 rounded-xl bg-white p-3 shadow-sm">
              {questions.length === 0 ? (
                <p className="text-sm text-zinc-400">No questions yet — add some to preview them here.</p>
              ) : (
                questions.slice(0, 8).map((q, i) => (
                  <FieldRenderer key={q.id} question={q} index={i}
                    value={values[q.id] ?? null}
                    onChange={(v) => setValues((s) => ({ ...s, [q.id]: v }))} />
                ))
              )}
              {questions.length > 8 && <p className="mt-2 text-center text-xs text-zinc-400">+{questions.length - 8} more questions</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
