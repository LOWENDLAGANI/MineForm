"use client";

/**
 * DistributionChart — dependency-free SVG chart for choice-question
 * breakdowns. Renders one of six chart types with an inline selector and a
 * hide toggle. Flat solid colors, no gradients, no chart library.
 */

import { useState } from "react";

export type ChartType = "pie" | "donut" | "bar" | "hbar" | "line" | "area";

export const CHART_TYPES: { value: ChartType; label: string; icon: string }[] = [
  { value: "pie", label: "Pie", icon: "◍" },
  { value: "donut", label: "Donut", icon: "◎" },
  { value: "bar", label: "Bar", icon: "▥" },
  { value: "hbar", label: "Bars", icon: "≣" },
  { value: "line", label: "Line", icon: "∫" },
  { value: "area", label: "Area", icon: "◣" },
];

export interface ChartSlice {
  label: string;
  count: number;
}

const COLORS = ["#18181b", "#3f3f46", "#52525b", "#71717a", "#a1a1aa", "#d4d4d8"];

function colorAt(i: number) {
  return COLORS[i % COLORS.length];
}

function Legend({ data, total }: { data: ChartSlice[]; total: number }) {
  return (
    <ul className="min-w-0 flex-1 divide-y divide-zinc-200 border-y border-zinc-200">
      {data.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2 py-1.5 text-xs">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: colorAt(i) }}
          />
          <span className="min-w-0 flex-1 truncate text-zinc-900">{s.label}</span>
          <span className="font-mono text-zinc-500">{s.count}</span>
          <span className="w-10 text-right font-mono text-zinc-400">
            {Math.round((s.count / total) * 100)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

function DonutSvg({ data, total, hole, size = 160 }: { data: ChartSlice[]; total: number; hole: number; size?: number }) {
  const radius = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const inner = radius * hole;

  let angle = -Math.PI / 2;
  const arcs = data.map((s, i) => {
    const frac = s.count / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;

    const large = frac > 0.5 ? 1 : 0;
    const x0 = cx + radius * Math.cos(a0);
    const y0 = cy + radius * Math.sin(a0);
    const x1 = cx + radius * Math.cos(a1);
    const y1 = cy + radius * Math.sin(a1);
    const xi1 = cx + inner * Math.cos(a1);
    const yi1 = cy + inner * Math.sin(a1);
    const xi0 = cx + inner * Math.cos(a0);
    const yi0 = cy + inner * Math.sin(a0);

    const d = [
      `M ${x0} ${y0}`,
      `A ${radius} ${radius} 0 ${large} 1 ${x1} ${y1}`,
      `L ${xi1} ${yi1}`,
      `A ${inner} ${inner} 0 ${large} 0 ${xi0} ${yi0}`,
      "Z",
    ].join(" ");

    return { d, color: colorAt(i), pct: Math.round(frac * 100) };
  });

  return (
    <svg width={size} height={size} role="img" aria-label="Response breakdown">
      {arcs.map((a, i) => (
        <path key={i} d={a.d} fill={a.color} stroke="#fff" strokeWidth="1" />
      ))}
    </svg>
  );
}

function VerticalBars({ data, total }: { data: ChartSlice[]; total: number }) {
  const H = 160;
  const max = Math.max(...data.map((s) => s.count));
  return (
    <div className="flex min-w-0 flex-1 items-end gap-2" style={{ height: H }}>
      {data.map((s, i) => (
        <div key={s.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
          <span className="font-mono text-[10px] text-zinc-500">
            {Math.round((s.count / total) * 100)}%
          </span>
          <div
            className="w-full max-w-12 rounded-t-sm transition-all"
            style={{ height: `${Math.max(2, (s.count / max) * (H - 44))}px`, backgroundColor: colorAt(i) }}
            title={`${s.label}: ${s.count}`}
          />
          <span className="line-clamp-2 h-8 w-full text-center text-[10px] leading-tight text-zinc-500">
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function HorizontalBars({ data, total }: { data: ChartSlice[]; total: number }) {
  const max = Math.max(...data.map((s) => s.count));
  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      {data.map((s, i) => (
        <div key={s.label} className="flex items-center gap-2 text-xs">
          <span className="w-24 min-w-0 shrink-0 truncate text-right text-zinc-600" title={s.label}>
            {s.label}
          </span>
          <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-sm bg-zinc-100">
            <div
              className="h-full transition-all"
              style={{
                width: `${Math.max(2, (s.count / max) * 100)}%`,
                backgroundColor: colorAt(i),
              }}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-mono text-zinc-400">
            {s.count} · {Math.round((s.count / total) * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function LineArea({ data, area }: { data: ChartSlice[]; area: boolean }) {
  const W = 280;
  const H = 160;
  const pad = 8;
  const max = Math.max(...data.map((s) => s.count), 1);
  const stepX = data.length > 1 ? (W - pad * 2) / (data.length - 1) : 0;
  const points = data.map((s, i) => ({
    x: pad + i * stepX,
    y: H - pad - (s.count / max) * (H - pad * 2 - 20),
    s,
  }));

  const lineD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaD =
    points.length > 0 && points[0] && points[points.length - 1]
      ? `M ${points[0].x} ${H - pad} ${points.map((p) => `L ${p.x} ${p.y}`).join(" ")} L ${points[points.length - 1]!.x} ${H - pad} Z`
      : "";

  return (
    <div className="min-w-0 flex-1">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Response trend">
        {area && <path d={areaD} fill="#18181b" opacity="0.12" />}
        <path d={lineD} fill="none" stroke="#18181b" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3.5" fill={colorAt(i)} stroke="#fff" strokeWidth="1.5" />
            <text x={p.x} y={p.y - 8} textAnchor="middle" className="fill-zinc-500" fontSize="9">
              {p.s.count}
            </text>
          </g>
        ))}
      </svg>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
        {data.map((s) => (
          <li key={s.label} className="max-w-28 truncate">
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DistributionChart({
  slices,
  storageKey,
  defaultType = "pie",
}: {
  slices: ChartSlice[];
  /** localStorage key so each question remembers its chart type + visibility. */
  storageKey: string;
  defaultType?: ChartType;
}) {
  const hiddenKey = `${storageKey}:hidden`;
  const [type, setType] = useState<ChartType>(() => {
    if (typeof window === "undefined") return defaultType;
    return (localStorage.getItem(storageKey) as ChartType | null) ?? defaultType;
  });
  const [hidden, setHidden] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(hiddenKey) === "1";
  });

  function pick(next: ChartType) {
    setType(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // storage unavailable — session-only preference
    }
  }

  function toggleHidden() {
    const next = !hidden;
    setHidden(next);
    try {
      localStorage.setItem(hiddenKey, next ? "1" : "0");
    } catch {
      // storage unavailable — session-only preference
    }
  }

  const data = slices.filter((s) => s.count > 0).sort((a, b) => b.count - a.count);
  const total = data.reduce((sum, s) => sum + s.count, 0);

  return (
    <div>
      {/* Toolbar: chart-type picker + disable toggle */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div
          role="radiogroup"
          aria-label="Chart type"
          className="flex flex-wrap gap-1"
        >
          {CHART_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={type === t.value}
              title={`${t.label} chart`}
              onClick={() => pick(t.value)}
              className={`rounded px-1.5 py-0.5 font-mono text-xs transition-colors ${
                type === t.value
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              }`}
            >
              {t.icon}
              <span className="sr-only">{t.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={toggleHidden}
          aria-pressed={hidden}
          title={hidden ? "Show chart" : "Hide chart"}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
        >
          {hidden ? "Show" : "Hide"}
        </button>
      </div>

      {hidden ? (
        <p className="py-6 text-center text-xs text-zinc-300">Chart hidden</p>
      ) : total === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-400">No answers yet.</p>
      ) : type === "pie" || type === "donut" ? (
        <div className="flex items-start gap-4">
          <DonutSvg data={data} total={total} hole={type === "pie" ? 0 : 0.55} />
          <Legend data={data} total={total} />
        </div>
      ) : type === "bar" ? (
        <VerticalBars data={data} total={total} />
      ) : type === "hbar" ? (
        <HorizontalBars data={data} total={total} />
      ) : (
        <LineArea data={data} area={type === "area"} />
      )}
    </div>
  );
}
