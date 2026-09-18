/**
 * Transactional email via the Resend HTTP API (no SDK needed — a fetch call
 * keeps the serverless bundle small). RESEND_API_KEY + a verified FROM are
 * required; when either is missing the send is skipped with a log line so
 * submissions never fail because of email downtime.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface ConfirmationEmailInput {
  to: string;
  formTitle: string;
  submittedAt: string;
  /** Ordered (question text, answer preview) pairs for the email body. */
  entries: { question: string; answer: string }[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderConfirmationHtml(input: ConfirmationEmailInput): string {
  const rows = input.entries
    .map(
      ({ question, answer }) => `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px;vertical-align:top">${escapeHtml(question)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e4e4e7;color:#09090b;font-size:13px;vertical-align:top">${escapeHtml(answer)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html><html><body style="margin:0;background:#fafafa;font-family:Inter,system-ui,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <h1 style="font-size:18px;font-weight:600;color:#09090b;margin:0">Thanks for your response</h1>
    <p style="font-size:14px;color:#71717a;margin:8px 0 20px">
      Here is a copy of your answers to <strong style="color:#09090b">${escapeHtml(input.formTitle)}</strong>
      — submitted ${escapeHtml(new Date(input.submittedAt).toLocaleString())}.
    </p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e4e4e7;border-radius:8px">
      ${rows}
    </table>
    <p style="font-size:12px;color:#a1a1aa;margin:20px 0 0">You are receiving this because you submitted a response to this form.</p>
  </div>
</body></html>`;
}

export async function sendConfirmationEmail(input: ConfirmationEmailInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "MineForm <onboarding@resend.dev>";

  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — confirmation email skipped");
    return false;
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: `Your responses — ${input.formTitle}`,
        html: renderConfirmationHtml(input),
      }),
    });
    if (!res.ok) {
      console.error("[email] Resend error", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] send failed", err);
    return false;
  }
}

/** Human preview of an answer value for emails. */
export function answerPreview(text: string | null, json: unknown): string {
  if (text !== null && text !== undefined) return text;
  if (Array.isArray(json)) return json.map(String).join(", ");
  if (json === null || json === undefined) return "";
  if (typeof json === "object") return JSON.stringify(json);
  return String(json);
}
