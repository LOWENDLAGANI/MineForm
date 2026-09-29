"use client";

/**
 * DistributionChart — dependency-free SVG chart for choice-question
 * breakdowns. Renders one of six chart types with an inline selector and a
 * hide toggle. Every option gets its own distinct colour, and every segment /
 * bar / point is clickable and keyboard reachable, showing a detail readout
 * with the option's share of answers.
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

/**
 * Distinct hues so neighbouring options are never confusable. Ordered so
 * adjacent slices land far apart on the wheel (blue, amber, teal, rose, …).
 */
const COLORS = [
  "#2563eb", // blue-600
  "#f59e0b", // amber-500
  "#0d9488", // teal-600
  "#e11d48", // rose-600
  "#7c3aed", // violet-600
  "#65a30d", // lime-600
  "#db2777", // pink-600
  "#0891b2", // cyan-600
  "#ca8a04", // yellow-600
  "#475569", // slate-600
];

function colorAt(i: number) {
  return COLORS[i % COLORS.length];
}

/** Shared selection/hover state + keyboard wiring for a clickable element. */
function pickProps(
  selected: boolean,
  dimmed: boolean,
  onSelect: () => void,
  ariaLabel: string,
) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-pressed": selected,
    "aria-label": ariaLabel,
    onClick: onSelect,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    },
    className: "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
    style: { opacity: dimmed ? 0.35 : 1, cursor: "pointer" },
  };
}

function Detail({
  slice,
  total,
  onClose,
}: {
  slice: ChartSlice;
  total: number;
  onClose: () => void;
}) {
  const pct = total > 0 ? (slice.count / total) * 100 : 0;
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-zinc-900">{slice.label}</p>
        <p className="font-mono text-[11px] text-zinc-500">
          {slice.count === 0
            ? "Nobody chose this option"
            : `${slice.count} ${slice.count === 1 ? "person" : "people"} chose this · ${pct.toFixed(1)}% of ${total} answers`}
        </p>
      </div>
      <span className="shrink-0 font-mono text-lg font-semibold text-zinc-900">
        {Math.round(pct)}%
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Clear selection"
        className="shrink-0 text-xs text-zinc-400 hover:text-zinc-900"
      >
        ✕
      </button>
    </div>
  );
}

function Legend({
  data,
  total,
  selected,
  onSelect,
}: {
  data: ChartSlice[];
  total: number;
  selected: string | null;
  onSelect: (label: string) => void;
}) {
  return (
    <ul className="min-w-0 flex-1 divide-y divide-zinc-200 border-y border-zinc-200">
      {data.map((s, i) => {
        const isSel = selected === s.label;
        return (
          <li
            key={s.label}
            {...pickProps(isSel, selected !== null && !isSel, () => onSelect(s.label), `${s.label}: ${s.count} answers`)}
            className={`flex items-center gap-2 py-1.5 text-xs ${
              isSel ? "bg-zinc-100" : "hover:bg-zinc-50"
            }`}
          >
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
        );
      })}
    </ul>
  );
}

function DonutSvg({
  data,
  total,
  hole,
  selected,
  onSelect,
  size = 160,
}: {
  data: ChartSlice[];
  total: number;
  hole: number;
  selected: string | null;
  onSelect: (label: string) => void;
  size?: number;
}) {
  const radius = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const inner = radius * hole;

  let angle = -Math.PI / 2;
  // A single option at 100% would fill the whole circle and read as a blank
  // disc — inset it slightly so it still looks like a chart slice.
  const single = data.length === 1;
  const GAP = single ? 0.06 : 0;
  const arcs = data.map((s, i) => {
    const frac = s.count / total;
    const a0 = angle + GAP / 2;
    const a1 = angle + frac * Math.PI * 2 - GAP / 2;
    angle += frac * Math.PI * 2;

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

    return { d, color: colorAt(i), s };
  });

  return (
    <svg width={size} height={size} role="img" aria-label="Response breakdown">
      {arcs.map(({ d, color, s }) => {
        const isSel = selected === s.label;
        const dimmed = selected !== null && !isSel;
        return (
          <path
            key={s.label}
            d={d}
            fill={color}
            stroke={isSel ? "#18181b" : "#fff"}
            strokeWidth={isSel ? 2 : 1}
            {...pickProps(isSel, dimmed, () => onSelect(s.label), `${s.label}: ${s.count} answers`)}
          />
        );
      })}
    </svg>
  );
}

function VerticalBars({
  data,
  total,
  selected,
  onSelect,
}: {
  data: ChartSlice[];
  total: number;
  selected: string | null;
  onSelect: (label: string) => void;
}) {
  const H = 160;
  const max = Math.max(...data.map((s) => s.count));
  return (
    <div className="flex min-w-0 flex-1 items-end gap-2" style={{ height: H }}>
      {data.map((s, i) => {
        const isSel = selected === s.label;
        return (
          <div
            key={s.label}
            {...pickProps(isSel, selected !== null && !isSel, () => onSelect(s.label), `${s.label}: ${s.count} answers`)}
            className={`flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 ${
              isSel ? "bg-zinc-50" : "hover:bg-zinc-50"
            }`}
          >
            <span className="font-mono text-[10px] text-zinc-500">
              {Math.round((s.count / total) * 100)}%
            </span>
            <div
              className="w-full max-w-12 rounded-t-sm transition-all"
              style={{
                height: `${Math.max(2, (s.count / max) * (H - 44))}px`,
                backgroundColor: colorAt(i),
                outline: isSel ? "2px solid #18181b" : "none",
              }}
              title={`${s.label}: ${s.count}`}
            />
            <span className="line-clamp-2 h-8 w-full text-center text-[10px] leading-tight text-zinc-500">
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function HorizontalBars({
  data,
  total,
  selected,
  onSelect,
}: {
  data: ChartSlice[];
  total: number;
  selected: string | null;
  onSelect: (label: string) => void;
}) {
  const max = Math.max(...data.map((s) => s.count));
  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      {data.map((s, i) => {
        const isSel = selected === s.label;
        return (
          <div
            key={s.label}
            {...pickProps(isSel, selected !== null && !isSel, () => onSelect(s.label), `${s.label}: ${s.count} answers`)}
            className={`flex items-center gap-2 rounded-sm px-1 py-0.5 text-xs ${
              isSel ? "bg-zinc-100" : "hover:bg-zinc-50"
            }`}
          >
            <span className="w-24 min-w-0 shrink-0 truncate text-right text-zinc-600" title={s.label}>
              {s.label}
            </span>
            <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-sm bg-zinc-100">
              <div
                className="h-full transition-all"
                style={{
                  width: `${Math.max(2, (s.count / max) * 100)}%`,
                  backgroundColor: colorAt(i),
                  outline: isSel ? "2px solid #18181b" : "none",
                }}
              />
            </div>
            <span className="w-16 shrink-0 text-right font-mono text-zinc-400">
              {s.count} · {Math.round((s.count / total) * 100)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LineArea({
  data,
  area,
  selected,
  onSelect,
}: {
  data: ChartSlice[];
  area: boolean;
  selected: string | null;
  onSelect: (label: string) => void;
}) {
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
        {area && <path d={areaD} fill="#2563eb" opacity="0.12" />}
        <path d={lineD} fill="none" stroke="#18181b" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => {
          const isSel = selected === p.s.label;
          return (
            <g
              key={p.s.label}
              {...pickProps(isSel, selected !== null && !isSel, () => onSelect(p.s.label), `${p.s.label}: ${p.s.count} answers`)}
            >
              <circle cx={p.x} cy={p.y} r="10" fill="transparent" />
              <circle
                cx={p.x}
                cy={p.y}
                r={isSel ? 5 : 3.5}
                fill={colorAt(i)}
                stroke={isSel ? "#18181b" : "#fff"}
                strokeWidth="1.5"
              />
              <text x={p.x} y={p.y - 8} textAnchor="middle" className="fill-zinc-500" fontSize="9">
                {p.s.count}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
        {data.map((s, i) => {
          const isSel = selected === s.label;
          return (
            <li
              key={s.label}
              {...pickProps(isSel, selected !== null && !isSel, () => onSelect(s.label), `${s.label}: ${s.count} answers`)}
              className="flex max-w-28 items-center gap-1 truncate rounded-sm px-0.5 hover:bg-zinc-50"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: colorAt(i) }} />
              <span className="truncate">{s.label}</span>
            </li>
          );
        })}
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
  const [selected, setSelected] = useState<string | null>(null);

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

  function onSelect(label: string) {
    setSelected((cur) => (cur === label ? null : label));
  }

  const answered = slices.filter((s) => s.count > 0);
  const total = answered.reduce((sum, s) => sum + s.count, 0);

  // Keep zero-answer options visible: they should read as "nobody chose this",
  // not disappear. Rating scales stay in numeric order; everything else is
  // largest-first with the empty options at the bottom.
  const allNumeric = slices.every((s) => /^\d+(\.\d+)?$/.test(s.label));
  const data = [...slices].sort((a, b) =>
    allNumeric
      ? Number(a.label) - Number(b.label)
      : b.count - a.count || a.label.localeCompare(b.label),
  );
  const selectedSlice = data.find((s) => s.label === selected) ?? null;

  return (
    <div>
      {/* Toolbar: chart-type picker + disable toggle */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Chart type" className="flex flex-wrap gap-1">
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
      ) : (
        <>
          {type === "pie" || type === "donut" ? (
            <div className="flex items-start gap-4">
              <DonutSvg
                data={data}
                total={total}
                hole={type === "pie" ? 0 : 0.55}
                selected={selected}
                onSelect={onSelect}
              />
              <Legend data={data} total={total} selected={selected} onSelect={onSelect} />
            </div>
          ) : type === "bar" ? (
            <VerticalBars data={data} total={total} selected={selected} onSelect={onSelect} />
          ) : type === "hbar" ? (
            <HorizontalBars data={data} total={total} selected={selected} onSelect={onSelect} />
          ) : (
            <LineArea data={data} area={type === "area"} selected={selected} onSelect={onSelect} />
          )}

          {selectedSlice && (
            <Detail
              slice={selectedSlice}
              total={total}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
