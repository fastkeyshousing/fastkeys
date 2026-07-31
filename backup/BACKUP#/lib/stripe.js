/* Stripe access over plain fetch, plus signature verification built on WebCrypto.
 *
 * The official Node SDK works on Workers but only after wiring up
 * createFetchHttpClient and createSubtleCryptoProvider, and forgetting either one
 * fails at runtime rather than at build time. Two REST calls and one HMAC do not
 * justify that dependency, so this file talks to the API directly. */

import { timingSafeEqual } from './http.js';

const API = 'https://api.stripe.com/v1';

async function call(env, path, { method = 'GET', body, idempotencyKey } = {}) {
  const headers = {
    authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'stripe-version': '2024-06-20',
  };
  if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  const res = await fetch(`${API}${path}`, { method, headers, body });
  const data = await res.json();

  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Stripe ${path} failed: ${msg}`);
  }
  return data;
}

/* The amount is never accepted from the browser. Checkout is built from a Price
 * ID held in the environment, so the only thing the client influences is which
 * application record the payment is attached to. */
export function createCheckoutSession(env, { application, reference, siteUrl }) {
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('line_items[0][price]', env.STRIPE_PRICE_ID);
  form.set('line_items[0][quantity]', '1');
  form.set('success_url', `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${siteUrl}/apply?cancelled=1`);
  form.set('client_reference_id', reference);
  form.set('customer_email', application.email);
  form.set('metadata[application_id]', application.id);
  form.set('metadata[reference]', reference);
  form.set('payment_intent_data[metadata][reference]', reference);
  form.set('payment_intent_data[description]', `FastKeys application ${reference}`);
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
