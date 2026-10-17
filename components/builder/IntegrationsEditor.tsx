"use client";

import type { Integrations } from "@/lib/types";

const input = "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 sm:text-sm";
const label = "block text-xs font-medium text-zinc-600";

export function IntegrationsEditor({
  value, saving, onChange,
}: {
  value: Partial<Integrations>;
  saving: boolean;
  onChange: (patch: Partial<Integrations>) => void;
}) {
  return (
    <div className="space-y-4">
      <section>
        <label className={label} htmlFor="i-webhook">Outgoing webhook URL</label>
        <input id="i-webhook" type="url" disabled={saving} defaultValue={value.webhook_url ?? ""}
          onBlur={(e) => onChange({ webhook_url: e.target.value.trim() || null })}
          placeholder="https://hooks.zapier.com/…" className={`mt-1 ${input}`} />
        <p className="mt-1 text-[11px] text-zinc-400">POSTs the full response JSON — Zapier, Make, n8n, your own API.</p>
      </section>

      <section>
        <label className={label} htmlFor="i-slack">Slack / Discord webhook</label>
        <input id="i-slack" type="url" disabled={saving} defaultValue={value.slack_webhook_url ?? ""}
          onBlur={(e) => onChange({ slack_webhook_url: e.target.value.trim() || null })}
          placeholder="https://hooks.slack.com/services/…" className={`mt-1 ${input}`} />
        <p className="mt-1 text-[11px] text-zinc-400">Posts a one-line summary to a channel.</p>
      </section>

      <section>
        <label className={label} htmlFor="i-sheet">Google Sheets (Apps Script) URL</label>
        <input id="i-sheet" type="url" disabled={saving} defaultValue={value.sheet_webhook_url ?? ""}
          onBlur={(e) => onChange({ sheet_webhook_url: e.target.value.trim() || null })}
          placeholder="https://script.google.com/macros/s/…/exec" className={`mt-1 ${input}`} />
        <p className="mt-1 text-[11px] text-zinc-400">
          Free Sheets sync without OAuth: in your sheet choose Extensions → Apps Script, paste
          <code className="mx-1 font-mono">function doPost(e) &#123; const d = JSON.parse(e.postData.contents); SpreadsheetApp.getActiveSheet().appendRow([d.response_id, d.submitted_at, ...Object.values(d).slice(2)]); &#125;</code>
          then deploy as web app and paste the /exec URL here.
        </p>
      </section>
    </div>
  );
}
