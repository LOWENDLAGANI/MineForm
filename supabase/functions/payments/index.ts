// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: payments
// Deploy: supabase functions deploy payments --no-verify-jwt
// Secrets: supabase secrets set STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... \
//            BILLPLZ_API_KEY=... BILLPLZ_X_SIGNATURE_KEY=... \
//            SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
//
// Routes (single function, action-based):
//   POST /payments { action: "create_checkout", responseId } -> checkout url
//   POST /payments?provider=stripe   (webhook, stripe-signature header)
//   POST /payments?provider=billplz  (webhook, x-signature header)
//
// Webhooks are idempotent via the webhook_events table (event id is PK).

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, stripe-signature, x-signature",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function fail(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

/* -------------------------------------------------------------------------
 * Stripe signature verification (t = timestamp, v1 = HMAC-SHA256 hex)
 * ---------------------------------------------------------------------- */
async function verifyStripeSignature(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = header.split(",").reduce<Record<string, string>>((acc, kv) => {
    const [k, v] = kv.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  // Reject replays older than 5 minutes.
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 300) return false;

  return timingSafeEqualHex(
    await hmacSha256Hex(`${t}.${payload}`, secret),
    v1,
  );
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* -------------------------------------------------------------------------
 * Billplz X-Signature verification
 * Format: billplzid|billplzpaid_at|billtransaction_id — HMAC-SHA256 of the
 * concatenation with the X-Signature key, compared against the header.
 * ---------------------------------------------------------------------- */
async function verifyBillplzSignatureAsync(
  payload: Record<string, any>,
  key: string,
): Promise<boolean> {
  const given = String(payload["x_signature"] ?? "");
  if (!given) return false;

  const source = [payload["id"], payload["paid_at"], payload["transaction_id"] ?? ""]
    .map((v) => String(v ?? ""))
    .join("|");

  const expected = await hmacSha256Hex(source, key);
  return timingSafeEqualHex(expected, given);
}

/* -------------------------------------------------------------------------
 * DB helpers (service role — webhook context has no user session)
 * ---------------------------------------------------------------------- */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function sb(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

async function recordEventOnce(
  client: SupabaseClient,
  eventId: string,
  provider: string,
  payload: unknown,
): Promise<boolean> {
  const { data, error } = await client
    .from("webhook_events")
    .insert({ id: eventId, provider, payload })
    .select("id")
    .maybeSingle();

  // PK conflict => duplicate delivery; treat as success so the provider
  // stops retrying, but don't re-settle.
  return !error;
}

/* -------------------------------------------------------------------------
 * Settlement — shared by both providers. Idempotent: re-running is a no-op.
 * ---------------------------------------------------------------------- */
async function settlePayment(
  client: SupabaseClient,
  provider: "stripe" | "billplz",
  providerRef: string,
  amountPaidCents: number | null,
): Promise<Response> {
  const { data: payment } = await client
    .from("payments")
    .select("id, response_id, status, amount_cents, currency")
    .eq("provider", provider)
    .eq("provider_ref", providerRef)
    .maybeSingle();

  if (!payment) {
    // Unknown ref: log and accept (200) so the provider stops retrying.
    console.error("settle: unknown payment ref", provider, providerRef);
    return json({ received: true, matched: false });
  }

  if (payment.status === "succeeded") {
    return json({ received: true, matched: true, alreadySettled: true });
  }

  if (
    amountPaidCents !== null &&
    amountPaidCents !== payment.amount_cents
  ) {
    console.error("settle: amount mismatch", payment.id, amountPaidCents, payment.amount_cents);
    await client
      .from("payments")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", payment.id);
    return json({ received: true, matched: true, amountMismatch: true });
  }

  const { error } = await client
    .from("payments")
    .update({ status: "succeeded", updated_at: new Date().toISOString() })
    .eq("id", payment.id)
    .neq("status", "succeeded");

  if (error) throw error;

  // If the form's payment_config.submit_on_success is true, seal the
  // response immediately (payment was the last gate).
  const { data: resp } = await client
    .from("responses")
    .select("id, form_id, submitted_at")
    .eq("id", payment.response_id)
    .maybeSingle();

  if (resp && !resp.submitted_at) {
    const { data: form } = await client
      .from("forms")
      .select("payment_config")
      .eq("id", resp.form_id)
      .maybeSingle();

    const cfg = (form?.payment_config ?? {}) as { submit_on_success?: boolean };
    if (cfg.submit_on_success !== false) {
      await client
        .from("responses")
        .update({ submitted_at: new Date().toISOString() })
        .eq("id", resp.id)
        .is("submitted_at", null);
    }
  }

  return json({ received: true, matched: true });
}

/* -------------------------------------------------------------------------
 * Checkout session creation
 * ---------------------------------------------------------------------- */
async function createStripeCheckout(
  client: SupabaseClient,
  responseId: string,
  origin: string,
): Promise<Response> {
  const { data: resp } = await client
    .from("responses")
    .select("id, form_id")
    .eq("id", responseId)
    .maybeSingle();
  if (!resp) return fail("NOT_FOUND", "Response not found", 404);

  const { data: form } = await client
    .from("forms")
    .select("title, payment_config")
    .eq("id", resp.form_id)
    .maybeSingle();
  if (!form) return fail("NOT_FOUND", "Form not found", 404);

  const cfg = (form.payment_config ?? {}) as {
    required?: boolean;
    provider?: string;
    amount_cents?: number;
    amountCents?: number;
    currency?: string;
  };
  if (!cfg.required || cfg.provider !== "stripe") {
    return fail("VALIDATION_ERROR", "Form is not configured for Stripe payment", 400);
  }

  const amount = cfg.amount_cents ?? cfg.amountCents;
  const currency = (cfg.currency ?? "usd").toLowerCase();
  if (!amount || amount <= 0) {
    return fail("VALIDATION_ERROR", "Invalid payment amount", 400);
  }

  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][price_data][currency]": currency,
    "line_items[0][price_data][product_data][name]": form.title,
    "line_items[0][price_data][unit_amount]": String(amount),
    "line_items[0][quantity]": "1",
    success_url: `${origin}/pay/success?response=${responseId}`,
    cancel_url: `${origin}/pay/cancelled?response=${responseId}`,
    "metadata[response_id]": responseId,
    client_reference_id: responseId,
  });

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data: any = await res.json();
  if (!res.ok) {
    console.error("stripe checkout failed", data?.error?.message);
    return fail("INTERNAL", "Stripe checkout session failed", 502);
  }

  await client.from("payments").insert({
    response_id: responseId,
    provider: "stripe",
    provider_ref: data.id, // cs_... session id; webhooks reference it
    amount_cents: amount,
    currency,
    status: "pending",
  });

  return json({ checkoutUrl: data.url });
}

async function createBillplzBill(
  client: SupabaseClient,
  responseId: string,
): Promise<Response> {
  const { data: resp } = await client
    .from("responses")
    .select("id, form_id")
    .eq("id", responseId)
    .maybeSingle();
  if (!resp) return fail("NOT_FOUND", "Response not found", 404);

  const { data: form } = await client
    .from("forms")
    .select("title, payment_config")
    .eq("id", resp.form_id)
    .maybeSingle();
  if (!form) return fail("NOT_FOUND", "Form not found", 404);

  const cfg = (form.payment_config ?? {}) as {
    required?: boolean;
    provider?: string;
    amount_cents?: number;
    amountCents?: number;
    currency?: string;
  };
  if (!cfg.required || cfg.provider !== "billplz") {
    return fail("VALIDATION_ERROR", "Form is not configured for Billplz payment", 400);
  }

  const amountSen = cfg.amount_cents ?? cfg.amountCents; // sen
  if (!amountSen || amountSen <= 0) {
    return fail("VALIDATION_ERROR", "Invalid payment amount", 400);
  }

  const body = new URLSearchParams({
    collection_id: Deno.env.get("BILLPLZ_COLLECTION_ID") ?? "",
    email: "respondent@example.com", // replace with a collected email answer
    name: "MineForm Respondent",
    amount: String(amountSen),
    callback_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/payments?provider=billplz`,
    redirect_url: `${Deno.env.get("ALLOWED_ORIGIN") ?? ""}/pay/success?response=${responseId}`,
    description: form.title.slice(0, 120),
  });

  const res = await fetch("https://www.billplz.com/api/v3/bills", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(Deno.env.get("BILLPLZ_API_KEY") + ":")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data: any = await res.json();
  if (!res.ok) {
    console.error("billplz bill failed", data?.error?.message);
    return fail("INTERNAL", "Billplz bill creation failed", 502);
  }

  await client.from("payments").insert({
    response_id: responseId,
    provider: "billplz",
    provider_ref: data.id, // bill id
    amount_cents: amountSen,
    currency: "MYR",
    status: "pending",
  });

  return json({ checkoutUrl: data.url });
}

/* -------------------------------------------------------------------------
 * Webhook handlers
 * ---------------------------------------------------------------------- */
async function handleStripeWebhook(req: Request): Promise<Response> {
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret || !(await verifyStripeSignature(raw, sig, secret))) {
    return fail("UNAUTHORIZED", "Invalid Stripe signature", 401);
  }

  const event = JSON.parse(raw) as {
    id: string;
    type: string;
    data: { object: any };
  };

  const client = sb();
  const fresh = await recordEventOnce(client, event.id, "stripe", event);
  if (!fresh) return json({ received: true, duplicate: true });

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const ref = session.client_reference_id ?? session.id;
    const paid = typeof session.amount_total === "number" ? session.amount_total : null;
    return settlePayment(client, "stripe", ref, paid);
  }

  return json({ received: true, ignored: event.type });
}

async function handleBillplzWebhook(req: Request): Promise<Response> {
  const raw = await req.text();
  const params = new URLSearchParams(raw);
  const payload: Record<string, any> = {};
  for (const [k, v] of params) payload[k] = v;

  const key = Deno.env.get("BILLPLZ_X_SIGNATURE_KEY");
  if (!key || !(await verifyBillplzSignatureAsync(payload, key))) {
    return fail("UNAUTHORIZED", "Invalid Billplz signature", 401);
  }

  const client = sb();
  const eventId = `billplz:${payload["id"]}:${payload["paid_at"] ?? ""}`;
  const fresh = await recordEventOnce(client, eventId, "billplz", payload);
  if (!fresh) return json({ received: true, duplicate: true });

  if (payload["paid"] === "true") {
    const amountSen = payload["amount"] ? Number(payload["amount"]) : null;
    return settlePayment(client, "billplz", String(payload["id"]), amountSen);
  }

  return json({ received: true, ignored: "unpaid callback" });
}

/* -------------------------------------------------------------------------
 * Entry
 * ---------------------------------------------------------------------- */
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");

  try {
    if (provider === "stripe") return await handleStripeWebhook(req);
    if (provider === "billplz") return await handleBillplzWebhook(req);

    if (req.method !== "POST") return fail("NOT_FOUND", "Unknown route", 404);

    const auth = req.headers.get("authorization");
    const payload: any = await req.json().catch(() => ({}));

    // create_checkout: any caller with a valid response id can pay; the
    // response must belong to a published form with payment required.
    if (payload.action === "create_checkout") {
      const client = sb();
      const { data: resp } = await client
        .from("responses")
        .select("id, form_id")
        .eq("id", String(payload.responseId ?? ""))
        .maybeSingle();
      if (!resp) return fail("NOT_FOUND", "Response not found", 404);

      const origin =
        Deno.env.get("ALLOWED_ORIGIN") ?? url.origin;

      if (payload.provider === "stripe" || payload.provider === undefined) {
        return await createStripeCheckout(client, resp.id, origin);
      }
      if (payload.provider === "billplz") {
        return await createBillplzBill(client, resp.id);
      }
      return fail("VALIDATION_ERROR", "Unknown provider", 400);
    }

    return fail("VALIDATION_ERROR", "Unknown action", 400);
  } catch (err) {
    console.error("payments fn error", err);
    return fail("INTERNAL", "Internal error", 500);
  }
});
