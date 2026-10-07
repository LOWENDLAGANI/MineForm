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

async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "MineForm <onboarding@resend.dev>";

  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — email skipped (to:", opts.to + ")");
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
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
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

export async function sendConfirmationEmail(input: ConfirmationEmailInput): Promise<boolean> {
  return sendEmail({
    to: input.to,
    subject: `Your responses — ${input.formTitle}`,
    html: renderConfirmationHtml(input),
  });
}

/* ---------------------------------------------------------------------------
 * Owner notification — "you have a new response"
 * ------------------------------------------------------------------------- */
export async function sendOwnerNotificationEmail(input: {
  to: string;
  formTitle: string;
  responseUrl: string;
  submittedAt: string;
  entries: { question: string; answer: string }[];
}): Promise<boolean> {
  const rows = input.entries
    .slice(0, 15)
    .map(
      ({ question, answer }) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px">${escapeHtml(question)}</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #e4e4e7;color:#09090b;font-size:13px">${escapeHtml(answer)}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#fafafa;font-family:Inter,system-ui,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <h1 style="font-size:18px;font-weight:600;color:#09090b;margin:0">New response: ${escapeHtml(input.formTitle)}</h1>
    <p style="font-size:14px;color:#71717a;margin:8px 0 20px">Received ${escapeHtml(new Date(input.submittedAt).toLocaleString())}.</p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e4e4e7;border-radius:8px">${rows}</table>
    <p style="margin:20px 0">
      <a href="${escapeHtml(input.responseUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-size:14px;font-weight:600">View all responses</a>
    </p>
  </div>
</body></html>`;
  return sendEmail({
    to: input.to,
    subject: `New response — ${input.formTitle}`,
    html,
  });
}

/* ---------------------------------------------------------------------------
 * Email verification — one-response-per-email
 * ------------------------------------------------------------------------- */
export function renderVerificationEmailHtml(verifyUrl: string, formTitle: string): string {
  return `<!doctype html><html><body style="margin:0;background:#fafafa;font-family:Inter,system-ui,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px">
    <h1 style="font-size:18px;font-weight:600;color:#09090b;margin:0">Verify your email</h1>
    <p style="font-size:14px;color:#71717a;margin:8px 0 20px">
      One click to confirm your address and continue <strong style="color:#09090b">${escapeHtml(formTitle)}</strong>.
      This link can only be used once.
    </p>
    <p style="margin:20px 0">
      <a href="${escapeHtml(verifyUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-size:14px;font-weight:600">Verify email</a>
    </p>
    <p style="font-size:12px;color:#a1a1aa">If you didn't request this, you can ignore this email.</p>
  </div>
</body></html>`;
}

export async function sendVerificationEmail(input: {
  to: string;
  verifyUrl: string;
  formTitle: string;
}): Promise<boolean> {
  return sendEmail({
    to: input.to,
    subject: `Verify your email — ${input.formTitle}`,
    html: renderVerificationEmailHtml(input.verifyUrl, input.formTitle),
  });
}

/* ---------------------------------------------------------------------------
 * Weekly report digest
 * ------------------------------------------------------------------------- */
export function renderWeeklyReportHtml(input: {
  to: string;
  weekStart: string;
  weekEnd: string;
  forms: { title: string; slug: string; newResponses: number; prevResponses: number; total: number }[];
  baseUrl: string;
}): string {
  const rows = input.forms
    .filter((f) => f.newResponses > 0)
    .map(
      (f) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #e4e4e7;font-size:13px;color:#09090b">${escapeHtml(f.title)}</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #e4e4e7;font-size:13px;text-align:right">${f.newResponses}</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #e4e4e7;font-size:13px;text-align:right;color:#71717a">${f.total} total</td></tr>`,
    )
    .join("");
  const body = rows || `<tr><td style="padding:12px;color:#71717a;font-size:13px">No new responses this week.</td></tr>`;
  return `<!doctype html><html><body style="margin:0;background:#fafafa;font-family:Inter,system-ui,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <h1 style="font-size:18px;font-weight:600;color:#09090b;margin:0">Your MineForm week</h1>
    <p style="font-size:14px;color:#71717a;margin:8px 0 20px">
      ${escapeHtml(new Date(input.weekStart).toLocaleDateString())} – ${escapeHtml(new Date(input.weekEnd).toLocaleDateString())}
    </p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e4e4e7;border-radius:8px">${body}</table>
    <p style="margin:20px 0">
      <a href="${escapeHtml(input.baseUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-size:14px;font-weight:600">Open MineForm</a>
    </p>
  </div>
</body></html>`;
}

export async function sendWeeklyReportEmail(input: {
  to: string;
  weekStart: string;
  weekEnd: string;
  forms: { title: string; slug: string; newResponses: number; prevResponses: number; total: number }[];
  baseUrl: string;
}): Promise<boolean> {
  return sendEmail({
    to: input.to,
    subject: `MineForm weekly digest — ${input.forms.reduce((n, f) => n + f.newResponses, 0)} new responses`,
    html: renderWeeklyReportHtml(input),
  });
}

/** Human preview of an answer value for emails. */
export function answerPreview(text: string | null, json: unknown): string {
  if (text !== null && text !== undefined) return text;
  if (Array.isArray(json)) return json.map(String).join(", ");
  if (json === null || json === undefined) return "";
  if (typeof json === "object") return JSON.stringify(json);
  return String(json);
}
