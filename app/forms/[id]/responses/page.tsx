"use client";

/**
 * Responses page — dense submissions table + per-choice-question pie charts
 * + CSV export. One row per response; answer cells keyed by question.
 * Flat zinc borders, mono timestamps, zero decoration.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HeaderBar } from "@/components/app/HeaderBar";
import { PieChart, type PieSlice } from "@/components/app/PieChart";
import { getBrowserSupabase, supabaseEnvMissing } from "@/lib/supabase-browser";
import type { Question } from "@/lib/types";

interface AnswerRow {
  question_id: string;
  answer_text: string | null;
  answer_json: unknown;
}

interface ResponseRow {
  id: string;
  started_at: string;
  submitted_at: string | null;
  answers: AnswerRow[];
}

interface FunnelStep {
  questionId: string;
  questionText: string;
  reached: number;
  answered: number;
  dropOffPct: number;
}

interface FunnelData {
  started: number;
  completed: number;
  completionPct: number;
  steps: FunnelStep[];
}

/** Bar-chart drop-off funnel: where respondents stop answering. */
function DropOffFunnel({ funnel }: { funnel: FunnelData }) {
  const [open, setOpen] = useState(false);
  const worst = funnel.steps.reduce<FunnelStep | null>(
    (acc, s) => (s.dropOffPct > 0 && (!acc || s.dropOffPct > acc.dropOffPct) ? s : acc),
    null,
  );
  const maxReached = Math.max(1, ...funnel.steps.map((s) => s.reached));

  return (
    <section className="mt-6 border border-zinc-200">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="text-xs font-medium text-zinc-900">
          Drop-off funnel{" "}
          <span className="ml-2 font-mono text-zinc-400">
            {funnel.started} started · {funnel.completed} completed · {funnel.completionPct}%
          </span>
          {worst && (
            <span className="ml-2 text-[11px] font-normal text-amber-700">
              biggest quit: “{worst.questionText.slice(0, 40)}” ({worst.dropOffPct}% dropped)
            </span>
          )}
        </span>
        <span className="text-xs text-zinc-400">{open ? "Hide ▲" : "Show ▼"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-zinc-200 p-3">
          {funnel.steps.length === 0 && (
            <p className="text-xs text-zinc-400">No funnel data yet.</p>
          )}
          {funnel.steps.map((s) => (
            <div key={s.questionId} className="text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-zinc-900">{s.questionText}</span>
                <span className="shrink-0 font-mono text-zinc-400">
                  {s.answered}/{s.reached}
                  {s.dropOffPct > 0 && (
                    <span className="ml-2 text-red-600">−{s.dropOffPct}%</span>
                  )}
                </span>
              </div>
              <div className="mt-1 flex h-3 overflow-hidden rounded-sm bg-zinc-100">
                <div
                  className="h-full bg-zinc-900"
                  style={{ width: `${(s.answered / maxReached) * 100}%` }}
                />
                <div
                  className="h-full bg-zinc-200"
                  style={{
                    width: `${((s.reached - s.answered) / maxReached) * 100}%`,
                  }}
                  title="Reached but not answered"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const input =
  "rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-inset focus:ring-zinc-900";

function cellValue(a: AnswerRow | undefined): string {
  if (!a) return "";
  if (a.answer_text !== null && a.answer_text !== undefined) return a.answer_text;
  const j = a.answer_json;
  if (Array.isArray(j)) return j.join(", ");
  if (j === null || j === undefined) return "";
  if (typeof j === "object") return JSON.stringify(j);
  return String(j);
}

export default function ResponsesPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const formId = params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "submitted" | "abandoned">("submitted");
  const [search, setSearch] = useState("");
  const [liveNotice, setLiveNotice] = useState(false);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);

  const authedFetch = useCallback(
    async (path: string) => {
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error("Supabase is not configured");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.push("/login");
        throw new Error("unauthenticated");
      }
      const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      return res.json();
    },
    [router],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const slug = await (async () => {
        const forms = await authedFetch("/api/forms");
        const mine = (forms.forms as { id: string; slug: string }[]).find((f) => f.id === formId);
        if (!mine) throw new Error("Form not found");
        return mine.slug;
      })();

      // Questions come from the public endpoint (works for published forms).
      let qs: Question[] = [];
      const pub = await fetch(`/api/public/forms/${slug}`);
      if (pub.ok) {
        const d = await pub.json();
        qs = d.questions ?? [];
      }
      setQuestions(qs);

      const q = statusFilter === "all" ? "" : `&status=${statusFilter}`;
      const data = await authedFetch(`/api/forms/${formId}/responses?limit=200${q}`);
      setResponses(
        (data.responses as ResponseRow[]).filter((r) => r.submitted_at !== null),
      );

      // Funnel data — best-effort, never blocks the table.
      try {
        const f = await authedFetch(`/api/forms/${formId}/funnel`);
        setFunnel(f.funnel ?? null);
      } catch {
        setFunnel(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load responses");
    } finally {
      setLoading(false);
    }
  }, [authedFetch, formId, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // --- Supabase Realtime: live updates for table + pie charts ------------
  // Subscribes to INSERTs on `responses` (new submissions) and `answers`
  // (rows arriving just before a submission is sealed). RLS filters what we
  // receive — only this form's rows reach this channel. New payloads trigger
  // a debounced quiet refetch so counts, rows and pies stay consistent.
  const quietRefetch = useCallback(async () => {
    try {
      const q = statusFilter === "all" ? "" : `&status=${statusFilter}`;
      const data = await authedFetch(`/api/forms/${formId}/responses?limit=200${q}`);
      setResponses(
        (data.responses as ResponseRow[]).filter((r) => r.submitted_at !== null),
      );
    } catch {
      // transient — next realtime event retries
    }
  }, [authedFetch, formId, statusFilter]);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        quietRefetch();
      }, 600); // debounce bursts (answers + response arrive together)
    };

    const channel = supabase
      .channel(`form-responses-${formId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "responses",
          filter: `form_id=eq.${formId}`,
        },
        (payload) => {
          if (payload.new.submitted_at) {
            setLiveNotice(true);
            scheduleRefetch();
          }
          // Unsubmitted rows (someone started) are ignored.
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "answers",
        },
        // answers arrive ~instantly before the response is sealed; the
        // responses INSERT event will also fire, but this catches answers
        // for responses sealed by other paths (e.g. payment webhook).
        () => scheduleRefetch(),
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [formId, quietRefetch]);

  // Auto-hide the live notice after a moment
  useEffect(() => {
    if (!liveNotice) return;
    const t = setTimeout(() => setLiveNotice(false), 4000);
    return () => clearTimeout(t);
  }, [liveNotice]);

  // Answers keyed by response id for fast cell lookup
  const answerMap = useMemo(() => {
    const m = new Map<string, Map<string, AnswerRow>>();
    for (const r of responses) {
      m.set(r.id, new Map(r.answers.map((a) => [a.question_id, a])));
    }
    return m;
  }, [responses]);

  const filtered = useMemo(() => {
    if (!search.trim()) return responses;
    const needle = search.toLowerCase();
    return responses.filter((r) =>
      r.answers.some((a) => cellValue(a).toLowerCase().includes(needle)),
    );
  }, [responses, search]);

  // Pie data: one chart per choice/dropdown/rating question
  const pies = useMemo(() => {
    const charts: { question: Question; slices: PieSlice[] }[] = [];
    for (const q of questions) {
      if (!["single_choice", "multi_choice", "dropdown", "rating"].includes(q.question_type)) {
        continue;
      }
      const counts = new Map<string, number>();
      const labelFor = (id: string) => q.options.find((o) => o.id === id)?.label ?? id;
      for (const r of responses) {
        const v = answerMap.get(r.id)?.get(q.id);
        if (!v) continue;
        if (Array.isArray(v.answer_json)) {
          for (const item of v.answer_json) {
            const key = labelFor(String(item));
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        } else if (v.answer_json !== null && v.answer_json !== undefined) {
          const key = q.question_type === "rating" ? String(v.answer_json) : labelFor(String(v.answer_json));
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      charts.push({ question: q, slices: [...counts.entries()].map(([label, count]) => ({ label, count })) });
    }
    return charts;
  }, [questions, responses, answerMap]);

  function exportCsv() {
    const header = ["response_id", "submitted_at", ...questions.map((q) => q.question_text)];
    // Escape quotes for CSV, and neutralize spreadsheet formula injection:
    // answers like "=cmd|..." or "+HYPERLINK(...)" would execute when the
    // owner opens the export in Excel/Sheets. Prefix dangerous leading chars.
    const sanitize = (v: string) => v.replace(/^[=+@\t\r]/, "'");
    const esc = (v: string) => `"${sanitize(v).replace(/"/g, '""')}"`;
    const lines = [header.map(esc).join(",")];
    for (const r of filtered) {
      const cells = questions.map((q) => cellValue(answerMap.get(r.id)?.get(q.id)));
      lines.push([r.id, r.submitted_at ?? "", ...cells].map((c) => esc(String(c))).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `responses-${formId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (supabaseEnvMissing) {
    return (
      <div className="min-h-screen bg-white">
        <HeaderBar />
        <main className="mx-auto max-w-5xl px-6 py-8 text-sm text-red-600">
          Supabase is not configured. Add env vars to .env.local and restart.
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <HeaderBar />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href={`/forms/${formId}`}
              className="text-xs text-zinc-500 hover:text-zinc-900"
            >
              ← Builder
            </Link>
            <span className="h-4 w-px bg-zinc-200" />
            <h1 className="text-sm font-medium text-zinc-900">Responses</h1>
            <span className="font-mono text-xs text-zinc-400">{filtered.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className={input}
              aria-label="Filter"
            >
              <option value="submitted">Submitted</option>
              <option value="all">All</option>
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search answers…"
              className={input}
            />
            <button
              type="button"
              onClick={exportCsv}
              className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-blue-600/30 hover:bg-blue-700"
            >
              Export CSV
            </button>
          </div>
        </div>

        {error && <p className="mt-4 text-xs text-red-600">{error}</p>}
        {loading && <p className="mt-6 text-xs text-zinc-400">Loading…</p>}

        {/* Live indicator */}
        <div className="mt-3 flex items-center gap-2 text-xs" aria-live="polite">
          <span
            className={`h-2 w-2 rounded-full ${
              liveNotice ? "bg-emerald-500" : "bg-zinc-300"
            }`}
          />
          <span className={liveNotice ? "text-emerald-700" : "text-zinc-400"}>
            {liveNotice ? "New response just came in" : "Live — updates in real time"}
          </span>
          <Link
            href={`/forms/${formId}/wall`}
            className="ml-auto rounded-md border border-zinc-300 px-2 py-1 font-medium text-zinc-600 hover:border-zinc-900 hover:text-zinc-900"
          >
            Response wall ↗
          </Link>
        </div>

        {/* Drop-off funnel */}
        {funnel && <DropOffFunnel funnel={funnel} />}

        {/* Charts */}
        {pies.length > 0 && (
          <section className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            {pies.map(({ question, slices }) => (
              <div key={question.id} className="border border-zinc-200">
                <div className="border-b border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-900">
                  {question.question_text}
                </div>
                <div className="p-3">
                  <PieChart slices={slices} />
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Table */}
        {!loading && !error && (
          <div className="mt-6 overflow-x-auto border-t border-zinc-200">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-zinc-200 text-xs font-medium text-zinc-500">
                  <th className="py-2 pr-4 font-medium">Submitted</th>
                  {questions.map((q) => (
                    <th key={q.id} className="max-w-52 truncate py-2 pr-4 font-medium">
                      {q.question_text}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={questions.length + 1} className="py-6 text-xs text-zinc-400">
                      No responses yet.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.id} className="border-b border-zinc-200 hover:bg-zinc-50">
                      <td className="py-2 pr-4 font-mono text-xs text-zinc-500">
                        {r.submitted_at
                          ? new Date(r.submitted_at).toLocaleString()
                          : "—"}
                      </td>
                      {questions.map((q) => (
                        <td key={q.id} className="max-w-52 truncate py-2 pr-4 text-xs text-zinc-900">
                          {cellValue(answerMap.get(r.id)?.get(q.id))}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
