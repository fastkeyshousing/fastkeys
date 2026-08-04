/* Stripe access over plain fetch, plus signature verification built on WebCrypto.
 *
 * The official Node SDK works on Workers but only after wiring up
 * createFetchHttpClient and createSubtleCryptoProvider, and forgetting either one
 * fails at runtime rather than at build time. Two REST calls and one HMAC do not
 * justify that dependency, so this file talks to the API directly. */

import { timingSafeEqual } from './http.js';

const API = 'https://api.stripe.com/v1';

async function call(env, path, { method = 'GET', body, idempotencyKey } = {}) {
  const base = env.STRIPE_API_BASE || API;
  const headers = {
    authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'stripe-version': '2024-06-20',
  };
  if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  const res = await fetch(`${base}${path}`, { method, headers, body });
  const data = await res.json();

  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Stripe ${path} failed: ${msg}`);
  }
  return data;
}

/* Opens the EUR 1.00 spot confirmation, and only that.
 *
 * Two amounts exist in this business, and only one of them can be charged here.
 * The confirmation is a fixed price, so it lives in the environment and the
 * browser never gets a say in it. The service fee is one month's rent of
 * whatever Property the applicant eventually signs for, which is unknown at
 * this point and may stay unknown for months, so it cannot be a line item on
 * this session and must not be guessed at.
 *
 * setup_future_usage is why the confirmation exists at all: it saves the card
 * at the one moment the applicant is present and paying attention, so the fee
 * can later be taken without dragging them back through checkout in the middle
 * of a move. customer_creation is what makes that saved card reusable, since a
 * guest checkout would attach the payment method to nothing we can bill again.
 *
 * Nothing in this codebase charges that saved card. Taking the fee is a
 * deliberate manual step today, and automating it needs the SCA and
 * consumer-disclosure questions in the terms.html header settled first: an
 * off-session charge of a variable, much larger amount is a different legal
 * animal from the euro that authorised it. */
export function createCheckoutSession(env, { application, reference, siteUrl }) {
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('line_items[0][price]', env.STRIPE_CONFIRMATION_PRICE_ID);
  form.set('line_items[0][quantity]', '1');
  form.set('success_url', `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${siteUrl}/apply?cancelled=1`);
  form.set('client_reference_id', reference);
  form.set('customer_email', application.email);
  /* Guest checkouts leave the saved card orphaned, so force a Customer. */
  form.set('customer_creation', 'always');
  form.set('metadata[application_id]', application.id);
  form.set('metadata[reference]', reference);
  form.set('payment_intent_data[metadata][reference]', reference);
  form.set('payment_intent_data[description]', `FastKeys spot confirmation ${reference}`);
  /* Asking to reuse the card narrows the offered methods to those that can be
   * saved. That costs some iDEAL traffic, which is a real loss in this market,
   * and is the price of not chasing people for the fee later. */
  form.set('payment_intent_data[setup_future_usage]', 'off_session');
  form.set('locale', 'auto');

  /* Keyed on the application id, so a double-submitted form cannot produce two
   * charges for the same application. */
  return call(env, '/checkout/sessions', {
    method: 'POST',
    body: form,
    idempotencyKey: `checkout-${application.id}`,
  });
}

export function retrieveCheckoutSession(env, sessionId) {
  return call(env, `/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

/* The async failure event says a payment failed but not why. The reason sits on
 * the PaymentIntent, and it is the difference between "your bank declined it,
 * try another method" and something the applicant cannot act on. */
export function retrievePaymentIntent(env, id) {
  return call(env, `/payment_intents/${encodeURIComponent(id)}`);
}

/* Stripe's own hosted receipt, which is the honest thing to link: it always
 * reflects the current state of the charge, so if the euro is later refunded
 * the same URL says so. Building our own would freeze a moment in time and
 * quietly become wrong.
 *
 * The URL hangs off the Charge, not the PaymentIntent, so the charge has to be
 * expanded. Returns null rather than throwing: no receipt link is a worse
 * email, not a reason to fail a webhook Stripe will then retry. */
export async function receiptUrlFor(env, paymentIntentId) {
  if (typeof paymentIntentId !== 'string') return null;
  try {
    const pi = await call(env, `/payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge`);
    return pi?.latest_charge?.receipt_url ?? null;
  } catch (err) {
    console.error('[stripe] could not read receipt url:', err);
    return null;
  }
}

/* Verifies the Stripe-Signature header against the raw request body.
 *
 * Three things have to hold: the header parses, the HMAC matches one of the
 * offered v1 signatures, and the timestamp is recent. Dropping the timestamp
 * check would leave a captured webhook replayable forever. */
export async function verifyWebhook(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader || !secret) return { ok: false, reason: 'missing signature or secret' };

  let timestamp = null;
  const candidates = [];
  for (const part of signatureHeader.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === 't') timestamp = v;
    else if (k === 'v1') candidates.push(v);
  }

  if (!timestamp || !/^\d+$/.test(timestamp)) return { ok: false, reason: 'no timestamp' };
  if (!candidates.length) return { ok: false, reason: 'no v1 signature' };

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (age > toleranceSeconds) return { ok: false, reason: `timestamp outside tolerance (${age}s)` };

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`)
  );
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const matched = candidates.some((c) => timingSafeEqual(c, expected));
  if (!matched) return { ok: false, reason: 'signature mismatch' };

  try {
    return { ok: true, event: JSON.parse(rawBody) };
  } catch {
    return { ok: false, reason: 'body is not valid JSON' };
  }
}
