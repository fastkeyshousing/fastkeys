/* POST /api/viewing
 *
 * Same shape as the application flow: store first, then open checkout, so a
 * declined card never costs the requester their answers, and so a payment can
 * always be traced back to what it was for.
 *
 * The price is chosen server-side from the service name. Nothing about the
 * amount comes from the browser: a request that says "express" is charged the
 * express price because the server looked it up, not because the client said so.
 */

import { json, fail, sameOrigin, clientIp, sha256Hex, rateLimit, methodNotAllowed } from '../../lib/http.js';
import { validateViewing } from '../../lib/validate-viewing.js';
import { createViewingCheckout } from '../../lib/stripe.js';

const MAX_BODY_BYTES = 12 * 1024;

/* FV rather than FK, so a reference read out over the phone is unambiguous about
 * which thing it belongs to. */
function makeReference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `FV-${chars.slice(0, 5).join('')}-${chars.slice(5, 8).join('')}`;
}

export async function onRequestPost({ request, env }) {
  const siteUrl = (env.SITE_URL || 'https://fastkeyshousing.com').replace(/\/$/, '');

  if (!env.DB) return fail(503, 'not_configured', 'D1 binding DB is not bound');
  if (!env.STRIPE_SECRET_KEY) return fail(503, 'not_configured', 'STRIPE_SECRET_KEY is not set');

  if (!sameOrigin(request, siteUrl)) {
    return fail(403, 'bad_origin', request.headers.get('origin') || '(none)');
  }
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return fail(415, 'bad_content_type');
  }

  const ip = clientIp(request);
  const ipHash = await sha256Hex(`${ip}:viewing`);

  const flood = await rateLimit(env.DB, `viewing:flood:${ipHash}`, 20, 60);
  if (!flood.ok) return fail(429, 'rate_limited', `${ip} flood`);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, 'too_large', `${raw.length} bytes`);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(400, 'bad_json');
  }

  const result = validateViewing(parsed);
  if (!result.ok) return fail(422, 'invalid_fields', result.errors.join(','));
  const viewing = result.value;

  /* The price id is looked up here, and a missing one is a configuration fault
   * rather than something to guess around: charging the wrong amount for a
   * viewing is worse than refusing to take the booking. */
  const priceId = viewing.service === 'express'
    ? env.STRIPE_EXPRESS_VIEWING_PRICE_ID
    : env.STRIPE_ONLINE_VIEWING_PRICE_ID;
  if (!priceId) {
    return fail(503, 'not_configured', `price id for the ${viewing.service} viewing is not set`);
  }

  const sessions = await rateLimit(env.DB, `viewing:session:${ipHash}`, 8, 3600);
  if (!sessions.ok) return fail(429, 'rate_limited', `${ip} session quota`);

  const id = crypto.randomUUID();
  const reference = makeReference();
  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO viewings
         (id, reference, service, status, name, email, phone, property_url,
          payload, application_reference, created_at, ip_hash)
       VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
    )
      .bind(
        id, reference, viewing.service, viewing.name, viewing.email, viewing.phone,
        viewing.property_url, JSON.stringify(viewing),
        viewing.application_reference, now, ipHash
      )
      .run();
  } catch (err) {
    return fail(500, 'storage_failed', String(err));
  }

  let session;
  try {
    session = await createViewingCheckout(env, { viewing, id, reference, priceId, siteUrl });
  } catch (err) {
    return fail(502, 'payment_setup_failed', String(err));
  }

  try {
    await env.DB.prepare(`UPDATE viewings SET stripe_session_id = ?1 WHERE id = ?2`)
      .bind(session.id, id)
      .run();
  } catch (err) {
    console.error('[viewing] could not attach session id:', err);
  }

  return json({ url: session.url, reference });
}

export function onRequest({ request }) {
  if (request.method === 'POST') return onRequestPost(...arguments);
  return methodNotAllowed('POST');
}
