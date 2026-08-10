/* GET /api/status?session_id=cs_...
 *
 * What the success page shows is decided here, not in the browser. Opening
 * /success by hand produces "unknown" because there is no session id to present,
 * and a session id cannot be guessed or forged: it is minted by Stripe and only
 * ever appears in the redirect that follows a real checkout.
 *
 * If the webhook has not landed yet the session is checked against Stripe live,
 * so a slow webhook shows the applicant a confirmation rather than a dead end. */

import { json, fail, clientIp, sha256Hex, rateLimit, methodNotAllowed } from '../../lib/http.js';
import { retrieveCheckoutSession, retrievePaymentIntent } from '../../lib/stripe.js';
import { explainDecline } from '../../lib/decline.js';
import { notifyPaid } from '../../lib/notify.js';

const SESSION_RE = /^cs_[A-Za-z0-9_]{10,120}$/;

/* Deliberately thin. The applicant needs to know the payment registered and what
 * reference to quote; nothing else belongs in a response keyed on a URL
 * parameter that will sit in browser history. */
function publicView(row, status) {
  return {
    status,
    reference: row?.reference ?? null,
    first_name: row?.name ? row.name.split(' ')[0] : null,
  };
}

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.DB) return fail(503, 'not_configured', 'D1 binding DB is not bound');

  const sessionId = new URL(request.url).searchParams.get('session_id') || '';
  if (!SESSION_RE.test(sessionId)) return json({ status: 'unknown' }, 200);

  const ipHash = await sha256Hex(clientIp(request));
  const limit = await rateLimit(env.DB, `status:${ipHash}`, 60, 300);
  if (!limit.ok) return fail(429, 'rate_limited');

  let row;
  try {
    row = await env.DB.prepare(
      `SELECT id, reference, name, status, payload, letter
         FROM applications WHERE stripe_session_id = ?1`
    )
      .bind(sessionId)
      .first();
  } catch (err) {
    /* Without this the runtime returns a raw stack trace, which leaks file paths
     * and internals from a public endpoint. It must also not be reported as
     * 'unknown': that reads as "no such payment" to someone who has just paid.
     * A 503 lets the page keep polling and then fall back to its receipt advice. */
    return fail(503, 'temporarily_unavailable', String(err));
  }

  if (!row) return json({ status: 'unknown' }, 200);
  if (row.status === 'paid') return json(publicView(row, 'paid'), 200);
  if (row.status === 'expired') return json(publicView(row, 'expired'), 200);
  if (row.status === 'failed') return json(publicView(row, 'failed'), 200);

  /* Still pending. Ask Stripe directly rather than making the applicant wait on
   * webhook delivery. */
  if (!env.STRIPE_SECRET_KEY) return json(publicView(row, 'pending'), 200);

  let session;
  try {
    session = await retrieveCheckoutSession(env, sessionId);
  } catch (err) {
    console.error('[status] Stripe lookup failed:', err);
    return json(publicView(row, 'pending'), 200);
  }

  if (session.payment_status !== 'paid') {
    /* Unpaid covers both "never attempted" and "attempted and refused". Only the
     * second needs explaining, and the reason lives on the PaymentIntent rather
     * than on the session. */
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
        console.error('[status] could not read decline reason:', e);
      }
    }
    return json({ ...publicView(row, failure ? 'declined' : 'pending'), failure }, 200);
  }

  /* Same guarded update the webhook uses, so whichever path gets there first
   * wins and the other becomes a no-op. */
  const update = await env.DB.prepare(
    `UPDATE applications
        SET status = 'paid',
            paid_at = ?1,
            stripe_payment_intent = ?2,
            amount_total = ?3,
            currency = ?4
      WHERE stripe_session_id = ?5
        AND status <> 'paid'`
  )
    .bind(
      new Date().toISOString(),
      typeof session.payment_intent === 'string' ? session.payment_intent : null,
      session.amount_total ?? null,
      session.currency ?? null,
      sessionId
    )
    .run();

  if ((update.meta?.changes ?? 0) > 0) {
    const amount = `${((session.amount_total ?? 0) / 100).toFixed(2)} ${(session.currency || 'eur').toUpperCase()}`;
    /* Same bookkeeping as the webhook path: notified_at is stamped only when a
     * channel actually delivered, so the "paid but never delivered" query stays
     * meaningful regardless of which path got here first. */
    const deliver = notifyPaid(env, {
      reference: row.reference,
      amount,
      application: JSON.parse(row.payload),
      letter: row.letter,
    }).then(async (sent) => {
      if (sent) {
        await env.DB.prepare(`UPDATE applications SET notified_at = ?1 WHERE stripe_session_id = ?2`)
          .bind(new Date().toISOString(), sessionId)
          .run();
      }
    }).catch((err) => console.error('[status] delivery failed:', err));

    if (typeof waitUntil === 'function') waitUntil(deliver);
  }

  return json(publicView(row, 'paid'), 200);
}

export function onRequest({ request }) {
  if (request.method === 'GET' || request.method === 'HEAD') return onRequestGet(...arguments);
  return methodNotAllowed('GET');
}
