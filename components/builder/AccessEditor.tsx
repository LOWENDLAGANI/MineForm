"use client";

import { useEffect, useState } from "react";
import type { AccessConfig } from "@/lib/types";

const input = "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 sm:text-sm";
const label = "block text-xs font-medium text-zinc-600";

const COMMON_COUNTRIES = ["US", "GB", "DE", "FR", "ES", "IT", "BR", "IN", "CA", "AU", "NL", "PH", "ID", "MY", "SG"];

export function AccessEditor({
  value, saving, uniqueEmail, onChange, onSettingsChange,
}: {
  value: Partial<AccessConfig>;
  saving: boolean;
  uniqueEmail: boolean;
  onChange: (patch: Partial<AccessConfig>) => void;
  onSettingsChange: (patch: { unique_email: boolean }) => void;
}) {
  const [passwordDraft, setPasswordDraft] = useState("");
  const hasPassword = !!value.password_hash;

  useEffect(() => { setPasswordDraft(""); }, [value.password_hash]);

  async function savePassword() {
    const trimmed = passwordDraft.trim();
    if (!trimmed) return;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(trimmed));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    onChange({ password_hash: hash });
  }

  const countries = value.allowed_countries ?? [];
  const devices = value.allowed_devices ?? [];

  function toggleCountry(code: string) {
    onChange({ allowed_countries: countries.includes(code) ? countries.filter((c) => c !== code) : [...countries, code] });
  }
  function toggleDevice(d: "mobile" | "desktop") {
    onChange({ allowed_devices: devices.includes(d) ? devices.filter((x) => x !== d) : [...devices, d] });
  }

  return (
    <div className="space-y-4">
      <section>
        <span className={label}>Password protection</span>
        <div className="mt-1 flex gap-2">
          <input type="password" value={passwordDraft} disabled={saving}
            onChange={(e) => setPasswordDraft(e.target.value)}
            placeholder={hasPassword ? "Password set — type to replace" : "Set a password"}
            autoComplete="new-password" className={input} />
          <button type="button" disabled={saving || passwordDraft.trim().length < 3} onClick={savePassword}
            className="shrink-0 rounded-md border border-zinc-300 px-3 text-xs font-medium text-zinc-700 hover:border-zinc-900 disabled:opacity-40">
            {hasPassword ? "Replace" : "Set"}
          </button>
        </div>
        {hasPassword && (
          <button type="button" disabled={saving} onClick={() => onChange({ password_hash: null })}
            className="mt-1.5 text-[11px] font-medium text-red-600 hover:underline">
            Remove password
          </button>
        )}
      </section>

      <section>
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-xs font-medium text-zinc-900">One response per email</span>
            <span className="block text-[11px] text-zinc-400">Respondents verify their email before starting</span>
          </span>
          <input type="checkbox" disabled={saving} checked={uniqueEmail}
            onChange={(e) => onSettingsChange({ unique_email: e.target.checked })}
            className="h-4 w-4 shrink-0 accent-zinc-900" />
        </label>
      </section>

      <section>
        <span className={label}>Country allowlist</span>
        <p className="text-[11px] text-zinc-400">Empty = every country. Detected via Vercel geo headers.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {COMMON_COUNTRIES.map((c) => (
            <button key={c} type="button" disabled={saving} onClick={() => toggleCountry(c)}
              className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${countries.includes(c) ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-900"}`}>
              {c}
            </button>
          ))}
        </div>
      </section>

      <section>
        <span className={label}>Device allowlist</span>
        <p className="text-[11px] text-zinc-400">Empty = all devices.</p>
        <div className="mt-2 flex gap-2">
          {(["mobile", "desktop"] as const).map((d) => (
            <button key={d} type="button" disabled={saving} onClick={() => toggleDevice(d)}
              className={`rounded-full border px-3 py-1.5 text-xs capitalize ${devices.includes(d) ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-900"}`}>
              {d}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
