import type { AnswerPayload, LogicCondition, LogicRule, Question } from "./types";

/* ---------------------------------------------------------------------------
 * Condition evaluation
 * ------------------------------------------------------------------------- */
function normalize(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(normalize).join("|");
  return String(v);
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

function conditionHolds(cond: LogicCondition, answer: unknown): boolean {
  switch (cond.operator) {
    case "is_empty":
      return answer == null || normalize(answer) === "";
    case "is_checked":
      return Array.isArray(answer) ? answer.length > 0 : answer != null;
    case "eq":
      return normalize(answer) === normalize(cond.value);
    case "neq":
      return normalize(answer) !== normalize(cond.value);
    case "contains":
      return Array.isArray(answer)
        ? answer.some((a) => normalize(a) === normalize(cond.value))
        : normalize(answer).includes(normalize(cond.value));
    case "not_contains":
      return !conditionHolds({ ...cond, operator: "contains" }, answer);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toNumber(answer);
      const b = toNumber(cond.value);
      if (a === null || b === null) return false;
      if (cond.operator === "gt") return a > b;
      if (cond.operator === "gte") return a >= b;
      if (cond.operator === "lt") return a < b;
      return a <= b;
    }
    default:
      return false;
  }
}

/**
 * Evaluate a question's logic rules against the collected answers.
 * Rules OR together; conditions within a rule AND together.
 */
export function evaluateLogic(
  rules: LogicRule[],
  answersByQuestionId: Record<string, unknown>,
): boolean {
  if (rules.length === 0) return true;

  return rules.some((rule: LogicRule) =>
    rule.conditions.every((cond: LogicCondition) =>
      conditionHolds(cond, answersByQuestionId[cond.questionId]),
    ),
  );
}

export type QuestionVisibility = Map<string, boolean>;

/**
 * Single pass resolving visibility for every question, in form order.
 * `show`/`hide` rules set explicit visibility; questions without rules stay
 * visible. `require` is tracked separately — a hidden required question
 * never blocks submission.
 */
export function resolveVisibility(
  questions: Question[],
  answersByQuestionId: Record<string, unknown>,
): QuestionVisibility {
  const visibility: QuestionVisibility = new Map();

  for (const q of questions) {
    visibility.set(q.id, evaluateLogic(q.logic_rules, answersByQuestionId));
  }

  return visibility;
}

export function isQuestionActive(
  q: Question,
  visibility: QuestionVisibility,
): boolean {
  return visibility.get(q.id) ?? true;
}

/* ---------------------------------------------------------------------------
 * Server-side validation. Never trust the client's idea of "valid".
 * ------------------------------------------------------------------------- */
export interface ValidationIssue {
  questionId: string;
  message: string;
}

export function validateAnswers(
  questions: Question[],
  answers: AnswerPayload[],
  visibility: QuestionVisibility,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  const answeredIds = new Set(answers.map((a) => a.questionId));

  for (const q of questions) {
    const active = isQuestionActive(q, visibility);
    const answer = byQuestion.get(q.id);
    const value = answer?.text ?? answer?.json ?? null;
    const isEmpty =
      value == null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);

    if (!active) {
      // Hidden questions must not smuggle data in.
      if (!isEmpty) {
        issues.push({
          questionId: q.id,
          message: "Answer provided for a hidden question",
        });
      }
      continue;
    }

    if (q.is_required && isEmpty) {
      issues.push({ questionId: q.id, message: "This question is required" });
      continue;
    }

    if (isEmpty) continue;

    const rules = q.validation_rules;
    const text = typeof value === "string" ? value : undefined;

    if (q.question_type === "email" && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      issues.push({ questionId: q.id, message: "Invalid email address" });
    }

    if (q.question_type === "number") {
      const n = toNumber(value);
      if (n === null) {
        issues.push({ questionId: q.id, message: "Must be a number" });
      } else {
        if (rules.min !== undefined && n < rules.min) {
          issues.push({ questionId: q.id, message: `Minimum is ${rules.min}` });
        }
        if (rules.max !== undefined && n > rules.max) {
          issues.push({ questionId: q.id, message: `Maximum is ${rules.max}` });
        }
      }
    }

    if (text && rules.minLength !== undefined && text.length < rules.minLength) {
      issues.push({ questionId: q.id, message: `Minimum ${rules.minLength} characters` });
    }
    if (text && rules.maxLength !== undefined && text.length > rules.maxLength) {
      issues.push({ questionId: q.id, message: `Maximum ${rules.maxLength} characters` });
    }
    if (text && rules.pattern && !new RegExp(rules.pattern).test(text)) {
      issues.push({ questionId: q.id, message: "Invalid format" });
    }
  }

  // Reject answers pointing at question ids that don't belong to this form.
  const validIds = new Set(questions.map((q) => q.id));
  for (const id of answeredIds) {
    if (!validIds.has(id)) {
      issues.push({ questionId: id, message: "Unknown question" });
    }
  }

  return issues;
}
