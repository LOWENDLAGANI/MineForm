"use client";

import { FONTS, type DesignConfig } from "@/lib/types";

const ACCENT_SWATCHES = [
  "#2563eb", "#0f172a", "#059669", "#d97706",
  "#dc2626", "#7c3aed", "#db2777", "#0891b2",
] as const;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const FONT_LABELS: Record<string, string> = {
  inter: "Inter", system: "System", poppins: "Poppins", playfair: "Playfair Display",
  lora: "Lora", "space-grotesk": "Space Grotesk", "roboto-mono": "Roboto Mono",
  "source-sans": "Source Sans 3", "dm-sans": "DM Sans", caveat: "Caveat",
};

const input = "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 sm:text-sm";
const label = "block text-xs font-medium text-zinc-600";

export function DesignEditor({
  value, accent, saving, onDesignChange, onAccentChange,
}: {
  value: Partial<DesignConfig>;
  accent: string;
  saving: boolean;
  onDesignChange: (patch: Partial<DesignConfig>) => void;
  onAccentChange: (hex: string) => void;
}) {
  const darkMode = value.dark_mode ?? "off";

  return (
    <div className="space-y-4">
      <section>
        <h2 className="mb-2 text-xs font-medium text-zinc-900">Accent color</h2>
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_SWATCHES.map((c) => (
            <button key={c} type="button" disabled={saving}
              onClick={() => onAccentChange(c)}
              aria-label={`Accent color ${c}`} aria-pressed={accent === c}
              className={`h-8 w-8 rounded-full border-2 transition-transform ${accent === c ? "scale-110 border-zinc-900" : "border-zinc-200 hover:scale-105"}`}
              style={{ backgroundColor: c }} />
          ))}
          <label className="ml-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
            Custom
            <input key={accent} type="color" disabled={saving} defaultValue={accent}
              onBlur={(e) => HEX_RE.test(e.target.value) && e.target.value !== accent && onAccentChange(e.target.value)}
              className="h-8 w-10 cursor-pointer rounded border border-zinc-300 bg-white p-0.5" aria-label="Custom accent color" />
          </label>
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-400">Colors buttons and inputs on the public form.</p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="d-hfont">Heading font</label>
          <select id="d-hfont" disabled={saving} value={value.heading_font ?? "inter"}
            onChange={(e) => onDesignChange({ heading_font: e.target.value as DesignConfig["heading_font"] })}
            className={`mt-1 ${input}`}>
            {FONTS.map((f) => <option key={f} value={f}>{FONT_LABELS[f]}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="d-bfont">Body font</label>
          <select id="d-bfont" disabled={saving} value={value.body_font ?? "inter"}
            onChange={(e) => onDesignChange({ body_font: e.target.value as DesignConfig["body_font"] })}
            className={`mt-1 ${input}`}>
            {FONTS.map((f) => <option key={f} value={f}>{FONT_LABELS[f]}</option>)}
          </select>
        </div>
      </section>

      <section>
        <span className={label}>Dark mode for respondents</span>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {(["off", "auto", "on"] as const).map((m) => (
            <button key={m} type="button" disabled={saving} onClick={() => onDesignChange({ dark_mode: m })}
              className={`rounded-md border px-2 py-2 text-xs capitalize ${darkMode === m ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-900"}`}>
              {m === "auto" ? "Auto (device)" : m}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <label className={label} htmlFor="d-logo">Logo image URL</label>
          <input id="d-logo" type="url" disabled={saving} defaultValue={value.logo_url ?? ""}
            onBlur={(e) => onDesignChange({ logo_url: e.target.value.trim() || null })}
            placeholder="https://…/logo.png" className={`mt-1 ${input}`} />
        </div>
        <div>
          <label className={label} htmlFor="d-bg">Background image URL</label>
          <input id="d-bg" type="url" disabled={saving} defaultValue={value.background_url ?? ""}
            onBlur={(e) => onDesignChange({ background_url: e.target.value.trim() || null })}
            placeholder="https://…/bg.jpg" className={`mt-1 ${input}`} />
        </div>
        {value.background_url && (
          <div>
            <label className={label} htmlFor="d-overlay">Background overlay darkness: {value.overlay_opacity ?? 40}%</label>
            <input id="d-overlay" type="range" min={0} max={90} step={5} disabled={saving}
              defaultValue={value.overlay_opacity ?? 40}
              onMouseUp={(e) => onDesignChange({ overlay_opacity: Number((e.target as HTMLInputElement).value) })}
              onTouchEnd={(e) => onDesignChange({ overlay_opacity: Number((e.target as HTMLInputElement).value) })}
              className="mt-1 w-full accent-zinc-900" />
          </div>
        )}
      </section>
    </div>
  );
}
