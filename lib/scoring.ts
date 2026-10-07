import type { AnswerPayload, Question } from "./types";

/**
 * Quiz score computation. Server-side, recomputed from stored questions so a
 * tampered client cannot award itself points.
 *  - choice questions: the picked option's `points`
 *  - rating / number : the numeric answer itself (capped at maxRating / max)
 */
export function computeScore(questions: Question[], answers: AnswerPayload[]): number {
  const byId = new Map(questions.map((q) => [q.id, q]));
  let score = 0;
  for (const a of answers) {
    const q = byId.get(a.questionId);
    if (!q) continue;
    if (q.question_type === "single_choice" || q.question_type === "dropdown") {
      const opt = q.options.find((o) => o.id === a.json);
      if (typeof opt?.points === "number") score += opt.points;
    } else if (q.question_type === "multi_choice" && Array.isArray(a.json)) {
      for (const v of a.json) {
        const opt = q.options.find((o) => o.id === v);
        if (typeof opt?.points === "number") score += opt.points;
      }
    } else if (q.question_type === "rating" || q.question_type === "number") {
      const n = typeof a.json === "number" ? a.json : Number(a.json);
      if (Number.isFinite(n)) {
        const cap = q.question_type === "rating" ? (q.validation_rules.maxRating ?? 5) : q.validation_rules.max;
        score += typeof cap === "number" ? Math.min(n, cap) : n;
      }
    }
  }
  return score;
}

export function maxPossibleScore(questions: Question[]): number {
  let max = 0;
  for (const q of questions) {
    if (q.question_type === "single_choice" || q.question_type === "dropdown" || q.question_type === "multi_choice") {
      max += Math.max(0, ...q.options.map((o) => o.points ?? 0));
    } else if (q.question_type === "rating") {
      max += q.validation_rules.maxRating ?? 5;
    } else if (q.question_type === "number" && typeof q.validation_rules.max === "number") {
      max += q.validation_rules.max;
    }
  }
  return max;
}
