/* POST /api/retry  { session_id }
 *
 * Reissues checkout for an application that is already stored and still unpaid.
 *
 * The point is that a declined card should not cost someone their answers. The
 * application was written to the database before checkout, so all that is needed
 * is a fresh Stripe session pointed at the same row: twenty-odd fields do not
 * have to be typed again, which is exactly the moment people give up.
 *
 * The session id is the credential. It is minted by Stripe, only ever appears in
 * the redirect back from a real checkout, and is matched against a row that must
 * still be unpaid, so this cannot be used to conjure a payment for somebody
 * else's application or to pay twice for the same one. */

import { json, fail, sameOrigin, clientIp, sha256Hex, rateLimit, methodNotAllowed } from '../../lib/http.js';
import { createCheckoutSession } from '../../lib/stripe.js';

const SESSION_RE = /^cs_[A-Za-z0-9_]{10,120}$/;

export async function onRequestPost({ request, env }) {
  const siteUrl = (env.SITE_URL || 'https://fastkeyshousing.com').replace(/\/$/, '');

  if (!env.DB) return fail(503, 'not_configured', 'D1 binding DB is not bound');
  for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_CONFIRMATION_PRICE_ID']) {
    if (!env[key]) return fail(503, 'not_configured', `${key} is not set`);
  }
  if (!sameOrigin(request, siteUrl)) {
    return fail(403, 'bad_origin', request.headers.get('origin') || '(none)');
  }

  const ipHash = await sha256Hex(clientIp(request));
  /* Deliberately loose. Someone whose bank keeps refusing may legitimately try
   * several times, and locking them out is worse than a few extra sessions. */
  const limit = await rateLimit(env.DB, `retry:${ipHash}`, 8, 900);
  if (!limit.ok) return fail(429, 'rate_limited');

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'bad_json');
  }

  const sessionId = String(body?.session_id ?? '');
  if (!SESSION_RE.test(sessionId)) return fail(422, 'bad_session');

  let row;
  try {
    row = await env.DB.prepare(
      `SELECT id, reference, status, payload FROM applications WHERE stripe_session_id = ?1`
    )
      .bind(sessionId)
      .first();
  } catch (err) {
    return fail(503, 'temporarily_unavailable', String(err));
  }

  if (!row) return fail(404, 'not_found');
  /* Already settled: sending them to checkout again would take a second euro. */
  if (row.status === 'paid') return json({ status: 'paid', reference: row.reference }, 200);

  const application = { ...JSON.parse(row.payload), id: row.id };

  let session;
  try {
    session = await createCheckoutSession(env, {
      application,
      reference: row.reference,
      siteUrl,
      /* The idempotency key on the original call was keyed to the application id,
       * which would return the same dead session. A retry needs a new one. */
      idempotencySuffix: `retry-${Date.now()}`,
    });
  } catch (err) {
    return fail(502, 'payment_setup_failed', String(err));
  }

  /* The row now points at the new session, so /api/status and the webhook both
   * follow the attempt the applicant is actually looking at. */
  try {
    await env.DB.prepare(
      `UPDATE applications SET stripe_session_id = ?1, status = 'pending' WHERE id = ?2`
    )
      .bind(session.id, row.id)
      .run();
  } catch (err) {
    console.error('[retry] could not move session id:', err);
  }

  return json({ url: session.url, reference: row.reference });
}

export function onRequest({ request }) {
  if (request.method === 'POST') return onRequestPost(...arguments);
  return methodNotAllowed('POST');
}
