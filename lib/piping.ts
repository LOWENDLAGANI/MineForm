/**
 * Answer piping — templates in question/ending text:
 *   {{answer:2}}  → the respondent's answer to question #2 (1-based position)
 *   {{field:utm_source}} → a hidden field value
 * Unknown tokens render as empty strings; values are truncated and escaped
 * by the caller (React escapes automatically).
 */
export function pipeText(
  text: string,
  answersByPosition: Record<number, string>,
  hiddenFields: Record<string, string>,
): string {
  return text.replace(/\{\{\s*(answer|field)\s*:\s*([^}]+?)\s*\}\}/g, (_m, kind: string, key: string) => {
    if (kind === "answer") {
      const n = Number(key);
      if (!Number.isInteger(n) || n < 1) return "";
      return (answersByPosition[n] ?? "").slice(0, 300);
    }
    return (hiddenFields[key] ?? "").slice(0, 300);
  });
}
