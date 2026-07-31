/* POST /api/apply
 *
 * Takes the application, stores it as unpaid, and hands back a Stripe Checkout
 * URL. The record exists before payment and is delivered only after the webhook
 * confirms the charge, so the browser never carries the application across the
 * payment hop and never triggers delivery. */

import { json, fail, sameOrigin, clientIp, sha256Hex, rateLimit, methodNotAllowed } from '../../lib/http.js';
import { validateApplication, buildLetter } from '../../lib/validate.js';
import { createCheckoutSession } from '../../lib/stripe.js';

const MAX_BODY_BYTES = 24 * 1024;

/* Reference shown to the applicant and printed on the Stripe receipt.
 * Generated here, from the platform CSPRNG, so it cannot be chosen by the client. */
function makeReference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `FK-${chars.slice(0, 5).join('')}-${chars.slice(5, 8).join('')}`;
}

async function verifyTurnstile(env, token, ip) {
  const form = new URLSearchParams();
  form.set('secret', env.TURNSTILE_SECRET_KEY);
  form.set('response', token || '');
  form.set('remoteip', ip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => ({ success: false }));
  return data.success === true;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const siteUrl = (env.SITE_URL || 'https://fastkeyshousing.com').replace(/\/$/, '');

  for (const required of ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID']) {
    if (!env[required]) return fail(503, 'not_configured', `${required} is not set`);
  }
  if (!env.DB) return fail(503, 'not_configured', 'D1 binding DB is not bound');

  if (!sameOrigin(request, siteUrl)) {
    return fail(403, 'bad_origin', request.headers.get('origin') || '(none)');
  }
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return fail(415, 'bad_content_type');
  }

  const ip = clientIp(request);
  const ipHash = await sha256Hex(`${ip}:${env.STRIPE_PRICE_ID}`);

  /* A loose flood guard covering every request, valid or not. Set high enough
   * that a person correcting mistakes in the form never meets it. */
  const flood = await rateLimit(env.DB, `apply:flood:${ipHash}`, 20, 60);
  if (!flood.ok) return fail(429, 'rate_limited', `${ip} flood`);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, 'too_large', `${raw.length} bytes`);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(400, 'bad_json');
  }

  /* Enforced only when a secret is configured, so the form keeps working before
   * Turnstile is switched on. Set the secret and the site key together. */
  if (env.TURNSTILE_SECRET_KEY) {
    const passed = await verifyTurnstile(env, parsed.turnstile_token, ip);
    if (!passed) return fail(403, 'challenge_failed', ip);
  }

  const result = validateApplication(parsed);
  if (!result.ok) return fail(422, 'invalid_fields', result.errors.join(','));

  /* The tight limit is applied only once the submission is known good, because
   * this is the point where a request starts costing a database row and a Stripe
   * session. Counting rejected attempts here would lock out an applicant who
   * simply mistyped their email twice. */
  const sessions = await rateLimit(env.DB, `apply:session:${ipHash}`, 6, 3600);
  if (!sessions.ok) return fail(429, 'rate_limited', `${ip} session quota`);

  const application = result.value;
  application.id = crypto.randomUUID();
  const reference = makeReference();
  const letter = buildLetter(application);
  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO applications
         (id, reference, status, name, email, payload, letter, created_at, ip_hash)
       VALUES (?1, ?2, 'pending', ?3, ?4, ?5, ?6, ?7, ?8)`
    )
      .bind(
        application.id,
        reference,
        application.name,
        application.email,
        JSON.stringify(application),
        letter,
        now,
        ipHash
      )
      .run();
  } catch (err) {
    return fail(500, 'storage_failed', String(err));
  }

  let session;
  try {
    session = await createCheckoutSession(env, { application, reference, siteUrl });
  } catch (err) {
    /* The row stays as 'pending' and gets swept by the cleanup task. Leaving it
     * behind is preferable to deleting a record the applicant just filled in. */
    return fail(502, 'payment_setup_failed', String(err));
  }

  try {
    await env.DB.prepare(`UPDATE applications SET stripe_session_id = ?1 WHERE id = ?2`)
      .bind(session.id, application.id)
      .run();
  } catch (err) {
    console.error('[apply] could not attach session id:', err);
  }

  return json({ url: session.url, reference });
}

/* Without this, Pages hands an unmatched method to the static asset handler and
 * a GET on /api/apply quietly returns the homepage with a 200. */
export function onRequest({ request }) {
  if (request.method === 'POST') return onRequestPost(...arguments);
  return methodNotAllowed('POST');
}
