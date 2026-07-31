/* POST /api/stripe-webhook
 *
 * The only place an application is marked paid and delivered. Stripe is the
 * authority on whether money moved; nothing here trusts the browser.
 *
 * The endpoint is public by necessity, so the signature check is the entire
 * access control. An unsigned or stale request is rejected before the body is
 * parsed as anything meaningful. */

import { methodNotAllowed } from '../../lib/http.js';
import { verifyWebhook, retrievePaymentIntent } from '../../lib/stripe.js';
import { notifyPaid, notifyPaymentFailed } from '../../lib/notify.js';

const HANDLED = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
]);

function formatAmount(session) {
  const total = session.amount_total;
  if (total === null || total === undefined) return 'unknown amount';
  const currency = (session.currency || 'eur').toUpperCase();
  return `${(total / 100).toFixed(2)} ${currency}`;
}

async function markPaid(env, session, waitUntil) {
  const now = new Date().toISOString();

  /* The status guard makes the update idempotent. Stripe retries webhooks and may
   * deliver both completed and async_payment_succeeded for the same session;
   * only the first one to arrive reports a changed row. */
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
      now,
      typeof session.payment_intent === 'string' ? session.payment_intent : null,
      session.amount_total ?? null,
      session.currency ?? null,
      session.id
    )
    .run();

  const transitioned = (update.meta?.changes ?? 0) > 0;
  if (!transitioned) return { transitioned: false };

  const row = await env.DB.prepare(
    `SELECT reference, payload, letter FROM applications WHERE stripe_session_id = ?1`
  )
    .bind(session.id)
    .first();

  if (!row) {
    console.error('[webhook] paid session has no application row:', session.id);
    return { transitioned: true, notified: false };
  }

  /* Notification runs after the response is returned. Stripe expects a prompt
   * 2xx, and a slow Telegram or Resend call must not push us into a retry. */
  const deliver = (async () => {
    try {
      const sent = await notifyPaid(env, {
        reference: row.reference,
        amount: formatAmount(session),
        application: JSON.parse(row.payload),
        letter: row.letter,
      });
      if (sent) {
        await env.DB.prepare(`UPDATE applications SET notified_at = ?1 WHERE stripe_session_id = ?2`)
          .bind(new Date().toISOString(), session.id)
          .run();
      }
    } catch (err) {
      console.error('[webhook] delivery failed:', err);
    }
  })();

  if (typeof waitUntil === 'function') waitUntil(deliver);
  else await deliver;

  return { transitioned: true };
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.DB) {
    console.error('[webhook] missing STRIPE_WEBHOOK_SECRET or DB binding');
    return new Response('not configured', { status: 503 });
  }

  const raw = await request.text();
  const verified = await verifyWebhook(
    raw,
    request.headers.get('stripe-signature'),
    env.STRIPE_WEBHOOK_SECRET
  );

  if (!verified.ok) {
    console.warn('[webhook] rejected:', verified.reason);
    return new Response('invalid signature', { status: 400 });
  }

  const event = verified.event;

  /* Event-level replay guard. A signature stays valid for its whole tolerance
   * window, so recording the id is what stops the same event being processed
   * twice inside it. */
  try {
    await env.DB.prepare(
      `INSERT INTO webhook_events (id, type, received_at) VALUES (?1, ?2, ?3)`
    )
      .bind(event.id, event.type, new Date().toISOString())
      .run();
  } catch {
    return new Response('duplicate', { status: 200 });
  }

  if (!HANDLED.has(event.type)) return new Response('ignored', { status: 200 });

  const session = event.data?.object;
  if (!session?.id) return new Response('no session', { status: 200 });

  try {
    /* A delayed payment method reported back that it did not clear. Only a
     * pending row moves: if the session somehow already settled, the money is
     * the authority and we leave it alone. */
    if (event.type === 'checkout.session.async_payment_failed') {
      const update = await env.DB.prepare(
        `UPDATE applications
            SET status = 'failed', failed_at = ?1
          WHERE stripe_session_id = ?2 AND status = 'pending'`
      )
        .bind(new Date().toISOString(), session.id)
        .run();

      if ((update.meta?.changes ?? 0) === 0) return new Response('ok', { status: 200 });

      const row = await env.DB.prepare(
        `SELECT reference, name, email FROM applications WHERE stripe_session_id = ?1`
      )
        .bind(session.id)
        .first();

      const tell = (async () => {
        let reason = null;
        try {
          if (typeof session.payment_intent === 'string') {
            const pi = await retrievePaymentIntent(env, session.payment_intent);
            reason = pi?.last_payment_error?.message || null;
          }
        } catch (err) {
          console.error('[webhook] could not read failure reason:', err);
        }
        if (reason) {
          await env.DB.prepare(`UPDATE applications SET failure_reason = ?1 WHERE stripe_session_id = ?2`)
            .bind(reason, session.id).run().catch(() => {});
        }
        if (row) {
          await notifyPaymentFailed(env, {
            reference: row.reference, name: row.name, email: row.email, reason,
          });
        }
      })();

      if (typeof waitUntil === 'function') waitUntil(tell);
      else await tell;

      return new Response('ok', { status: 200 });
    }

    if (event.type === 'checkout.session.expired') {
      await env.DB.prepare(
        `UPDATE applications SET status = 'expired'
          WHERE stripe_session_id = ?1 AND status = 'pending'`
      )
        .bind(session.id)
        .run();
      return new Response('ok', { status: 200 });
    }

    /* completed fires for card payments the moment they clear; for delayed
     * methods it can arrive unpaid, and the async event follows later. */
    if (session.payment_status !== 'paid') {
      return new Response('ok, not yet paid', { status: 200 });
    }

    await markPaid(env, session, waitUntil);
    return new Response('ok', { status: 200 });
  } catch (err) {
    /* A 5xx makes Stripe retry, which is what we want for a transient D1 fault. */
    console.error('[webhook] processing error:', err);
    return new Response('processing error', { status: 500 });
  }
}

export function onRequest({ request }) {
  if (request.method === 'POST') return onRequestPost(...arguments);
  return methodNotAllowed('POST');
}
