"use client";

import type { ScoringConfig } from "@/lib/types";

export function ScoringEditor({
  value, saving, questionCount, onChange,
}: {
  value: Partial<ScoringConfig>;
  saving: boolean;
  questionCount: number;
  onChange: (patch: Partial<ScoringConfig>) => void;
}) {
  const enabled = value.enabled ?? false;
  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-xs font-medium text-zinc-900">Scoring / quiz mode</span>
          <span className="block text-[11px] text-zinc-400">Assign points to options; score is computed server-side</span>
        </span>
        <input type="checkbox" disabled={saving} checked={enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })} className="h-4 w-4 shrink-0 accent-zinc-900" />
      </label>
      {enabled && (
        <>
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs text-zinc-700">Show the score on the ending screen</span>
            <input type="checkbox" disabled={saving} checked={value.show_score ?? true}
              onChange={(e) => onChange({ show_score: e.target.checked })} className="h-4 w-4 shrink-0 accent-zinc-900" />
          </label>
          <p className="rounded-lg bg-zinc-50 px-3 py-2 text-[11px] text-zinc-500">
            {questionCount === 0
              ? "Add choice, rating or number questions, then set points on each option below."
              : "Set points on each option in the question list below. Rating and number questions award the numeric answer as points."}
          </p>
        </>
      )}
    </div>
  );
}
