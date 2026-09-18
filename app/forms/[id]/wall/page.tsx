"use client";

/**
 * Response wall — full-screen owner mode showing submissions live.
 * Powered by Supabase Realtime (postgres_changes on responses/answers, RLS
 * filters to this owner). Built for projectors at events/classrooms: giant
 * counter, animated incoming cards, no chrome. Press F for true fullscreen.
 */

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBrowserSupabase, supabaseEnvMissing } from "@/lib/supabase-browser";
import type { Question } from "@/lib/types";

interface WallAnswer {
  question_id: string;
  answer_text: string | null;
  answer_json: unknown;
}

interface WallResponse {
  id: string;
  submitted_at: string | null;
  answers: WallAnswer[];
}

function cellValue(a: WallAnswer | undefined): string {
  if (!a) return "";
  if (a.answer_text !== null && a.answer_text !== undefined) return a.answer_text;
  const j = a.answer_json;
  if (Array.isArray(j)) return j.join(", ");
  if (j === null || j === undefined) return "";
  if (typeof j === "object") return JSON.stringify(j);
  return String(j);
}

/** Short anonymous label for a respondent on the wall. */
function respondentLabel(index: number): string {
  const animals = [
    "Fox", "Owl", "Wolf", "Hawk", "Bear", "Deer", "Lynx", "Otter",
    "Heron", "Moth", "Raven", "Elk", "Ibex", "Orca", "Finch", "Hare",
  ];
  return `${animals[index % animals.length]} #${index + 1}`;
}

export default function ResponseWallPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const formId = params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [responses, setResponses] = useState<WallResponse[]>([]);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const seenIds = useRef<Set<string>>(new Set());
  const isFirstLoad = useRef(true);

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

      const pub = await fetch(`/api/public/forms/${slug}`);
      if (pub.ok) {
        const d = await pub.json();
        setQuestions(d.questions ?? []);
      }

      const data = await authedFetch(`/api/forms/${formId}/responses?status=submitted&limit=50`);
      const rows = (data.responses as WallResponse[]).filter((r) => r.submitted_at !== null);
      for (const r of rows) seenIds.current.add(r.id);
      setResponses(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      isFirstLoad.current = false;
    }
  }, [authedFetch, formId]);

  useEffect(() => {
    load();
  }, [load]);

  // --- Realtime: prepend incoming submissions with a flash animation ------
  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const data = await authedFetch(`/api/forms/${formId}/responses?status=submitted&limit=50`);
          const rows = (data.responses as WallResponse[]).filter((r) => r.submitted_at !== null);
          const fresh = rows.filter((r) => !seenIds.current.has(r.id));
          for (const r of fresh) seenIds.current.add(r.id);
          if (fresh.length > 0 && !isFirstLoad.current) {
            setFlashIds(new Set(fresh.map((r) => r.id)));
            setTimeout(() => setFlashIds(new Set()), 2500);
          }
          setResponses(rows);
        } catch {
          // transient — next event retries
        }
      }, 600);
    };

    const channel = supabase
      .channel(`wall-${formId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "responses", filter: `form_id=eq.${formId}` },
        (payload) => {
          if (payload.new.submitted_at) scheduleRefetch();
        },
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "answers" }, scheduleRefetch)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [formId, authedFetch]);

  // Fullscreen toggle with F
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "f" && !e.metaKey && !e.ctrlKey) {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => undefined);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submitted = useMemo(() => responses.filter((r) => r.submitted_at), [responses]);

  // Headline question for the big card: the first choice question if any
  const headline = useMemo(
    () =>
      questions.find(
        (q) => q.question_type === "single_choice" || q.question_type === "dropdown",
      ) ?? questions[0],
    [questions],
  );

  const labelFor = useCallback(
    (q: Question, id: string) => q.options.find((o) => o.id === id)?.label ?? id,
    [],
  );

  if (supabaseEnvMissing) {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-950 text-sm text-red-400">
        Supabase is not configured.
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-4">
            <span className="text-6xl font-semibold tabular-nums tracking-tight sm:text-7xl">
              {submitted.length}
            </span>
            <span className="text-sm text-zinc-400">responses · live</span>
            <span className="h-3 w-3 animate-pulse rounded-full bg-emerald-500" />
          </div>
          <button
            type="button"
            onClick={() => router.push(`/forms/${formId}/responses`)}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            Exit wall
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {loading && <p className="mt-6 text-sm text-zinc-500">Loading…</p>}

        {!loading && !error && (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {submitted.length === 0 && (
              <p className="col-span-full py-12 text-center text-sm text-zinc-600">
                Waiting for the first response… scan the form QR / open the public link.
              </p>
            )}
            {submitted.map((r, i) => {
              const isNew = flashIds.has(r.id);
              const headlineAnswer = headline
                ? cellValue(r.answers.find((a) => a.question_id === headline.id))
                : "";
              const rest = headline
                ? r.answers.filter((a) => a.question_id !== headline.id)
                : r.answers;
              const qById = new Map(questions.map((q) => [q.id, q]));

              return (
                <article
                  key={r.id}
                  className={`rounded-xl border p-4 transition-all duration-500 ${
                    isNew
                      ? "border-emerald-500 bg-emerald-950/40 scale-[1.02]"
                      : "border-zinc-800 bg-zinc-900"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-400">
                      {respondentLabel(submitted.length - 1 - i)}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-600">
                      {r.submitted_at
                        ? new Date(r.submitted_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                  </div>
                  {headline && headlineAnswer && (
                    <p className="mt-2 text-lg font-medium leading-snug text-zinc-50">
                      {headline.question_type === "single_choice" ||
                      headline.question_type === "dropdown"
                        ? labelFor(headline, headlineAnswer)
                        : headlineAnswer}
                    </p>
                  )}
                  {headline && (
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                      {headline.question_text}
                    </p>
                  )}
                  {rest.length > 0 && (
                    <dl className="mt-3 space-y-1 border-t border-zinc-800 pt-2">
                      {rest.slice(0, 4).map((a) => {
                        const q = qById.get(a.question_id);
                        return (
                          <div key={a.question_id} className="flex gap-2 text-[11px]">
                            <dt className="min-w-0 max-w-24 shrink-0 truncate text-zinc-500">
                              {q?.question_text ?? "—"}
                            </dt>
                            <dd className="min-w-0 flex-1 truncate text-zinc-300">
                              {q && (q.question_type === "single_choice" || q.question_type === "dropdown")
                                ? labelFor(q, cellValue(a))
                                : cellValue(a)}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <p className="mt-10 text-center text-[11px] text-zinc-700">
          Press F for fullscreen · cards flash green when a response lands
        </p>
      </div>
    </main>
  );
}
