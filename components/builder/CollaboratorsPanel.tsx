"use client";

import { useCallback, useEffect, useState } from "react";

const input = "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 sm:text-sm";

interface Collaborator { id: string; email: string; role: "editor" | "viewer"; created_at: string }

export function CollaboratorsPanel({
  formId, ownerEmail, authedFetch, saving,
}: {
  formId: string;
  ownerEmail: string | null;
  authedFetch: (path: string, init?: RequestInit) => Promise<unknown>;
  saving: boolean;
}) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = (await authedFetch(`/api/forms/${formId}/collaborators`)) as { collaborators?: Collaborator[] };
      setCollaborators(data.collaborators ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [authedFetch, formId]);

  useEffect(() => { load(); }, [load]);

  async function add() {
    setError(null);
    try {
      await authedFetch(`/api/forms/${formId}/collaborators`, {
        method: "POST", body: JSON.stringify({ email: email.trim(), role }),
      });
      setEmail(""); load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to add"); }
  }

  async function remove(id: string) {
    try {
      await authedFetch(`/api/forms/${formId}/collaborators?collaboratorId=${id}`, { method: "DELETE" });
      load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to remove"); }
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Editors can change questions and settings. Viewers can read responses only.
        {ownerEmail ? ` You (${ownerEmail}) are the owner.` : ""}
      </p>
      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          <div className="h-10 animate-pulse rounded-md bg-zinc-100" />
        </div>
      ) : (
        collaborators.length > 0 && (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
            {collaborators.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-900">{c.email}</span>
                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[10px] text-zinc-500">{c.role}</span>
                <button type="button" disabled={saving} onClick={() => remove(c.id)}
                  className="shrink-0 text-xs text-zinc-400 hover:text-red-600" aria-label={`Remove ${c.email}`}>×</button>
              </li>
            ))}
          </ul>
        )
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <input type="email" value={email} disabled={saving} onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@email.com" className={input} aria-label="Collaborator email" />
        <select value={role} disabled={saving} onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
          className="rounded-md border border-zinc-300 px-2 text-xs" aria-label="Role">
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <button type="button" disabled={saving || !email.includes("@")} onClick={add}
          className="shrink-0 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
          Invite
        </button>
      </div>
    </div>
  );
}
