import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side evaluation of forms.close_config.
 * Returns true when the form should refuse new responses:
 *  - close_at date has passed, OR
 *  - any conditional close rule has enough matching submitted answers.
 */

export interface CloseConditionInput {
  question_id: string;
  operator: "eq" | "contains";
  value: string;
  count?: number;
}

export interface CloseConfigInput {
  close_at?: string | null;
  conditions?: CloseConditionInput[];
}

function matchCondition(
  operator: "eq" | "contains",
  value: string,
  answerText: string | null,
  answerJson: unknown,
): boolean {
  const jsonValues: unknown[] = Array.isArray(answerJson)
    ? answerJson
    : answerJson !== null && answerJson !== undefined
      ? [answerJson]
      : [];

  const textHit =
    answerText !== null &&
    (operator === "eq" ? answerText === value : answerText.includes(value));

  const jsonHit = jsonValues.some((v) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return operator === "eq" ? s === value : s.includes(value);
  });

  return textHit || jsonHit;
}

export async function isFormClosed(
  supabase: SupabaseClient,
  formId: string,
  closeConfig: unknown,
): Promise<boolean> {
  const cfg = (closeConfig ?? {}) as CloseConfigInput;

  if (cfg.close_at && Date.now() > new Date(cfg.close_at).getTime()) return true;

  for (const cond of cfg.conditions ?? []) {
    // Fetch the form's submitted answers to this question and match in JS.
    // Small N per form makes this cheaper and more portable than a
    // hand-translated SQL filter per operator.
    const { data: rows, error } = await supabase
      .from("answers")
      .select(
        `answer_text, answer_json,
         response:responses!inner ( id, form_id, submitted_at )`,
      )
      .eq("response.form_id", formId)
      .eq("question_id", cond.question_id);

    if (error) throw error;

    let matches = 0;
    for (const row of rows ?? []) {
      const r = row as unknown as {
        answer_text: string | null;
        answer_json: unknown;
        response: { submitted_at: string | null } | null;
      };
      // Only submitted responses count toward a conditional close.
      if (!r.response?.submitted_at) continue;
      if (matchCondition(cond.operator, cond.value, r.answer_text, r.answer_json)) {
        matches += 1;
      }
    }
    if (matches >= (cond.count ?? 1)) return true;
  }

  return false;
}
