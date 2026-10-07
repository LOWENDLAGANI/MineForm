"use client";

import { useCallback, useEffect, useState } from "react";

interface AuditEntry { id: string; actor: string; action: string; detail: Record<string, unknown>; created_at: string }

export function AuditPanel({
  formId, authedFetch,
}: {
  formId: string;
  authedFetch: (path: string, init?: RequestInit) => Promise<unknown>;
}) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  const load = useCallback(async () => {
    try {
      const data = (await authedFetch(`/api/forms/${formId}/audit`)) as { entries?: AuditEntry[] };
      setEntries(data.entries ?? []);
    } catch {
      setEntries([]);
    }
  }, [authedFetch, formId]);

  useEffect(() => { load(); }, [load]);

  const humanAction = (a: string) =>
    ({
      "form.created": "Created the form",
      "form.published": "Published the form",
      "form.unpublished": "Unpublished the form",
      "form.settings_updated": "Updated settings",
      "collaborator.added": "Invited a collaborator",
      "collaborator.removed": "Removed a collaborator",
      "template.published": "Published a template",
    })[a] ?? a;

  return (
    <div>
      {entries === null ? (
        <p className="text-xs text-zinc-400">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-zinc-400">No activity yet.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-zinc-700">
                <span className="font-medium text-zinc-900">{e.actor}</span> — {humanAction(e.action)}
              </span>
              <time className="shrink-0 font-mono text-[10px] text-zinc-400">
                {new Date(e.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
