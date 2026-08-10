/* GET /api/viewing-status?session_id=cs_...
 *
 * Same contract as the application status endpoint: the page displays only what
 * the server confirms, and a session id cannot be guessed because Stripe mints
 * it and it appears only in the redirect after a real checkout.
 */

import { json, fail, clientIp, sha256Hex, rateLimit, methodNotAllowed } from '../../lib/http.js';
import { retrieveCheckoutSession, retrievePaymentIntent } from '../../lib/stripe.js';
import { explainDecline } from '../../lib/decline.js';

const SESSION_RE = /^cs_[A-Za-z0-9_]{10,120}$/;

function view(row, status, extra = {}) {
  return {
    status,
    reference: row?.reference ?? null,
    service: row?.service ?? null,
    first_name: row?.name ? String(row.name).split(' ')[0] : null,
    property_url: status === 'paid' ? row?.property_url ?? null : null,
    ...extra,
  };
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return fail(503, 'not_configured', 'D1 binding DB is not bound');

  const sessionId = new URL(request.url).searchParams.get('session_id') || '';
  if (!SESSION_RE.test(sessionId)) return json({ status: 'unknown' }, 200);

  const ipHash = await sha256Hex(clientIp(request));
  const limit = await rateLimit(env.DB, `vstatus:${ipHash}`, 60, 300);
  if (!limit.ok) return fail(429, 'rate_limited');

  let row;
  try {
    row = await env.DB.prepare(
      `SELECT reference, service, name, status, property_url
         FROM viewings WHERE stripe_session_id = ?1`
    ).bind(sessionId).first();
  } catch (err) {
    return fail(503, 'temporarily_unavailable', String(err));
  }

  if (!row) return json({ status: 'unknown' }, 200);
  if (row.status === 'paid') return json(view(row, 'paid'), 200);
  if (row.status === 'expired') return json(view(row, 'expired'), 200);
  if (!env.STRIPE_SECRET_KEY) return json(view(row, 'pending'), 200);

  /* Not settled in our database yet. Ask Stripe rather than leaving somebody who
   * has just paid looking at a page that says nothing happened. */
  let session;
  try {
    session = await retrieveCheckoutSession(env, sessionId);
  } catch (err) {
    console.error('[viewing-status] Stripe lookup failed:', err);
    return json(view(row, 'pending'), 200);
  }

  if (session.payment_status !== 'paid') {
    let failure = null;
    if (typeof session.payment_intent === 'string') {
      try {
        const pi = await retrievePaymentIntent(env, session.payment_intent);
        const err = pi?.last_payment_error;
        if (err) {
          failure = explainDecline({
            declineCode: err.decline_code || err.code,
            failureType: err.code === 'card_declined' && !err.decline_code ? 'blocked' : undefined,
          });
        }
      } catch (e) {
        console.error('[viewing-status] could not read decline reason:', e);
      }
    }
    return json(view(row, failure ? 'declined' : 'pending', { failure }), 200);
  }

  await env.DB.prepare(
    `UPDATE viewings SET status='paid', paid_at=?1, stripe_payment_intent=?2,
            amount_total=?3, currency=?4
      WHERE stripe_session_id=?5 AND status <> 'paid'`
  ).bind(
    new Date().toISOString(),
    typeof session.payment_intent === 'string' ? session.payment_intent : null,
    session.amount_total ?? null, session.currency ?? null, sessionId
  ).run();

  return json(view(row, 'paid'), 200);
}

export function onRequest({ request }) {
  if (request.method === 'GET' || request.method === 'HEAD') return onRequestGet(...arguments);
  return methodNotAllowed('GET');
}
