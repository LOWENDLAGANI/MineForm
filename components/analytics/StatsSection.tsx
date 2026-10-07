"use client";

import { useMemo } from "react";

interface TrendPoint { date: string; count: number }
interface Stats {
  totalResponses: number;
  last30: TrendPoint[];
  last7Count: number;
  prev7Count: number;
  avgCompletionSeconds: number | null;
  medianCompletionSeconds: number | null;
  wordFrequencies: { word: string; count: number }[];
  scoreStats: { avg: number | null; min: number | null; max: number | null };
  byCountry: { label: string; count: number }[];
  byDevice: { label: string; count: number }[];
}

function fmtSeconds(s: number | null): string {
  if (s === null) return "—";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function StatsSection({ stats, formId }: { stats: Stats; formId: string }) {
  const maxTrend = useMemo(() => Math.max(1, ...stats.last30.map((p) => p.count)), [stats.last30]);
  const delta = stats.last7Count - stats.prev7Count;
  const maxWord = useMemo(() => Math.max(1, ...stats.wordFrequencies.map((w) => w.count)), [stats.wordFrequencies]);

  const cards: { label: string; value: string; hint?: string }[] = [
    { label: "Total responses", value: String(stats.totalResponses) },
    { label: "Last 7 days", value: String(stats.last7Count), hint: delta === 0 ? "same as prev 7" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta)} vs prev 7` },
    { label: "Avg completion", value: fmtSeconds(stats.avgCompletionSeconds) },
    { label: "Median completion", value: fmtSeconds(stats.medianCompletionSeconds) },
  ];

  return (
    <section className="mt-6 border border-zinc-200" data-stats-for={formId}>
      <details open>
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-900">Insights</summary>
        <div className="border-t border-zinc-200 p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {cards.map((c) => (
              <div key={c.label} className="border border-zinc-200 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-zinc-400">{c.label}</p>
                <p className="mt-0.5 text-lg font-semibold text-zinc-900">{c.value}</p>
                {c.hint && <p className={`text-[10px] ${c.hint.startsWith("▲") ? "text-emerald-600" : c.hint.startsWith("▼") ? "text-red-600" : "text-zinc-400"}`}>{c.hint}</p>}
              </div>
            ))}
          </div>

          {stats.last30.length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-400">Responses — last 30 days</p>
              <div className="flex h-20 items-end gap-[2px]">
                {stats.last30.map((p) => (
                  <div key={p.date} className="group relative flex-1" title={`${p.date}: ${p.count}`}>
                    <div className="w-full bg-zinc-900/80 transition-colors group-hover:bg-blue-600" style={{ height: `${Math.max(2, (p.count / maxTrend) * 76)}px` }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats.scoreStats.avg !== null && (
            <div className="mt-4 border border-zinc-200 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-zinc-400">Quiz scores</p>
              <p className="text-sm text-zinc-900">avg {stats.scoreStats.avg} · min {stats.scoreStats.min} · max {stats.scoreStats.max}</p>
            </div>
          )}

          {stats.wordFrequencies.length > 0 && (
            <div className="mt-4 border border-zinc-200 px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-400">Word cloud (text answers)</p>
              <p className="flex flex-wrap gap-x-2 gap-y-0.5 leading-6">
                {stats.wordFrequencies.slice(0, 25).map((w) => (
                  <span key={w.word} style={{ fontSize: `${11 + (w.count / maxWord) * 15}px`, color: w.count / maxWord > 0.6 ? "#18181b" : "#71717a" }}>{w.word}</span>
                ))}
              </p>
            </div>
          )}

          {(stats.byCountry.length > 0 || stats.byDevice.length > 0) && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {stats.byCountry.length > 0 && (
                <div className="border border-zinc-200 px-3 py-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-400">Countries</p>
                  {stats.byCountry.slice(0, 5).map((c) => (
                    <p key={c.label} className="flex justify-between text-xs text-zinc-700"><span>{c.label}</span><span className="font-mono text-zinc-400">{c.count}</span></p>
                  ))}
                </div>
              )}
              {stats.byDevice.length > 0 && (
                <div className="border border-zinc-200 px-3 py-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-400">Devices</p>
                  {stats.byDevice.slice(0, 5).map((c) => (
                    <p key={c.label} className="flex justify-between text-xs text-zinc-700"><span className="capitalize">{c.label}</span><span className="font-mono text-zinc-400">{c.count}</span></p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
