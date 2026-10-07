import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Aggregated analytics shared by the owner stats API and the weekly cron
 * report. Everything is computed in JS over the form's responses — volume is
 * small enough at this stage and it keeps the SQL portable.
 */

export interface TrendPoint {
  date: string; // YYYY-MM-DD (UTC)
  count: number;
}

export interface StatsResult {
  totalResponses: number;
  last30: TrendPoint[];
  last7Count: number;
  prev7Count: number;
  avgCompletionSeconds: number | null;
  medianCompletionSeconds: number | null;
  wordFrequencies: { word: string; count: number }[];
  scoreStats: { avg: number | null; min: number | null; max: number | null };
  byCountry: { label: string; count: number }[];
  byDevice: { label: string; count: number }[];
}

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","if","then","is","are","was","were","be","been","being",
  "to","of","in","on","for","with","at","by","from","up","about","into","over","after",
  "i","me","my","we","our","you","your","he","she","it","they","them","this","that",
  "not","no","yes","do","does","did","so","as","can","will","just","very","really",
  "have","has","had","would","could","should","am","it's","i'm","don't","didn't",
]);

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function computeFormStats(
  supabase: SupabaseClient,
  formId: string,
  options: { wordCloud?: boolean } = {},
): Promise<StatsResult> {
  const { data: responses, error } = await supabase
    .from("responses")
    .select("id, started_at, submitted_at, score, respondent_meta")
    .eq("form_id", formId);
  if (error) throw error;

  const submitted = (responses ?? []).filter((r) => r.submitted_at);

  // -- daily trend, last 30 days ------------------------------------------
  const today = new Date();
  const counts = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    counts.set(utcDate(d), 0);
  }
  for (const r of submitted) {
    const key = utcDate(new Date(r.submitted_at as string));
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const last30: TrendPoint[] = [...counts.entries()].map(([date, count]) => ({ date, count }));

  const weekMs = 7 * 24 * 3600 * 1000;
  const now = Date.now();
  const last7Count = submitted.filter((r) => now - new Date(r.submitted_at as string).getTime() <= weekMs).length;
  const prev7Count = submitted.filter((r) => {
    const age = now - new Date(r.submitted_at as string).getTime();
    return age > weekMs && age <= 2 * weekMs;
  }).length;

  // -- completion time -----------------------------------------------------
  const durations = submitted
    .map((r): number => (new Date(r.submitted_at as string).getTime() - new Date(r.started_at).getTime()) / 1000)
    .map((x): number => (Number.isFinite(x) ? x : 0))
    .filter((s) => s >= 0 && s < 6 * 3600)
    .filter((s): s is number => Number.isFinite(s)).sort((a, b) => a - b);
  const avg = durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : null;
  const medianIdx = Math.floor(durations.length / 2);
  const median = durations.length ? Math.round(durations[medianIdx] ?? 0) : null;

  // -- respondent meta breakdown -------------------------------------------
  const countryCounts = new Map<string, number>();
  const deviceCounts = new Map<string, number>();
  for (const r of submitted) {
    const meta = (r.respondent_meta ?? {}) as { country?: string; device?: string };
    if (meta.country) countryCounts.set(meta.country, (countryCounts.get(meta.country) ?? 0) + 1);
    if (meta.device) deviceCounts.set(meta.device, (deviceCounts.get(meta.device) ?? 0) + 1);
  }

  // -- quiz scores ----------------------------------------------------------
  const scores = submitted.map((r) => r.score).filter((s): s is number => typeof s === "number");

  // -- word frequencies over long text answers ------------------------------
  let wordFrequencies: { word: string; count: number }[] = [];
  if (options.wordCloud) {
    const { data: answerRows, error: aErr } = await supabase
      .from("answers")
      .select("answer_text, questions!inner ( form_id, question_type )")
      .eq("questions.form_id", formId)
      .in("questions.question_type", ["long_text", "short_text"]);
    if (!aErr) {
      const freq = new Map<string, number>();
      for (const row of answerRows ?? []) {
        const text = (row as unknown as { answer_text: string | null }).answer_text;
        if (!text) continue;
        const seen = new Set<string>();
        for (const raw of text.toLowerCase().split(/[^a-zA-Z'’-]+/)) {
          const w = raw.replace(/^[-']+|[-']+$/g, "");
          if (w.length < 3 || STOP_WORDS.has(w) || seen.has(w)) continue;
          seen.add(w);
          freq.set(w, (freq.get(w) ?? 0) + 1);
        }
      }
      wordFrequencies = [...freq.entries()]
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 40);
    }
  }

  return {
    totalResponses: submitted.length,
    last30,
    last7Count,
    prev7Count,
    avgCompletionSeconds: avg,
    medianCompletionSeconds: median,
    wordFrequencies,
    scoreStats: {
      avg: scores.length ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10 : null,
      min: scores.length ? Math.min(...scores) : null,
      max: scores.length ? Math.max(...scores) : null,
    },
    byCountry: [...countryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label, count })),
    byDevice: [...deviceCounts.entries()].map(([label, count]) => ({ label, count })),
  };
}
