/**
 * Outgoing integrations, all fire-and-forget: a dead webhook must never
 * break a submission. Three targets per form:
 *  - generic webhook  : full sealed-response JSON (Zapier/Make compatible)
 *  - slack/discord    : incoming webhook, one-line summary
 *  - google sheets    : Apps Script doPost(e) endpoint, row-shaped JSON
 */

const TIMEOUT_MS = 5000;

async function postJson(url: string, payload: unknown): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("[webhook] target returned", res.status, new URL(url).host);
    }
  } catch (err) {
    console.error("[webhook] delivery failed", err instanceof Error ? err.message : err);
  } finally {
    clearTimeout(timer);
  }
}

export interface IntegrationPayload {
  event: "response.submitted";
  formId: string;
  formSlug: string;
  formTitle: string;
  responseId: string;
  submittedAt: string;
  score: number | null;
  locale: string | null;
  answers: { question: string; answer: string }[];
  meta: Record<string, unknown>;
}

/** Row-shaped payload for the Google Sheets Apps Script pattern. */
function sheetRowPayload(p: IntegrationPayload) {
  return {
    form: p.formTitle,
    response_id: p.responseId,
    submitted_at: p.submittedAt,
    ...Object.fromEntries(p.answers.map((a, i) => [`q${i + 1}`, a.answer])),
    ...p.meta,
  };
}

export async function fireIntegrations(
  integrations: {
    webhook_url?: string | null;
    slack_webhook_url?: string | null;
    sheet_webhook_url?: string | null;
  },
  payload: IntegrationPayload,
): Promise<void> {
  const jobs: Promise<void>[] = [];

  if (integrations.webhook_url) {
    jobs.push(postJson(integrations.webhook_url, payload));
  }

  if (integrations.slack_webhook_url) {
    const summary = payload.answers
      .slice(0, 6)
      .map((a) => `• *${a.question}*: ${a.answer}`)
      .join("\n");
    const isDiscord = /discord(app)?\.com\/api\/webhooks/.test(integrations.slack_webhook_url);
    const text = `📥 New response to *${payload.formTitle}*${payload.score !== null ? ` — score ${payload.score}` : ""}\n${summary || "(no answers)"}`;
    jobs.push(
      postJson(integrations.slack_webhook_url, isDiscord ? { content: text } : { text }),
    );
  }

  if (integrations.sheet_webhook_url) {
    jobs.push(postJson(integrations.sheet_webhook_url, sheetRowPayload(payload)));
  }

  await Promise.allSettled(jobs);
}
