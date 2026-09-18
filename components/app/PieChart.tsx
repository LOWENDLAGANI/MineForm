"use client";

/**
 * PieChart — dependency-free SVG donut/pie for choice question breakdowns.
 * Flat solid segments (zinc shades + true black), no gradients, no glow.
 */

export interface PieSlice {
  label: string;
  count: number;
}

const COLORS = ["#18181b", "#3f3f46", "#52525b", "#71717a", "#a1a1aa", "#d4d4d8"];

export function PieChart({ slices, size = 160 }: { slices: PieSlice[]; size?: number }) {
  const data = slices.filter((s) => s.count > 0);
  const total = data.reduce((sum, s) => sum + s.count, 0);

  if (total === 0) {
    return <p className="text-xs text-zinc-400">No answers yet.</p>;
  }

  const radius = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const inner = radius * 0.55; // donut hole

  let angle = -Math.PI / 2; // start at 12 o'clock
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

    return { d, color: COLORS[i % COLORS.length], pct: Math.round(frac * 100) };
  });

  return (
    <div className="flex items-start gap-4">
      <svg width={size} height={size} role="img" aria-label="Response breakdown">
        {arcs.map((a, i) => (
          <path key={i} d={a.d} fill={a.color} stroke="#fff" strokeWidth="1" />
        ))}
      </svg>
      <ul className="min-w-0 flex-1 divide-y divide-zinc-200 border-y border-zinc-200">
        {data.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 py-1.5 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-zinc-900">{s.label}</span>
            <span className="font-mono text-zinc-500">{s.count}</span>
            <span className="w-10 text-right font-mono text-zinc-400">
              {Math.round((s.count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
