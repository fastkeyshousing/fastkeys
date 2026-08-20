/* One place that sends an email and writes down that it happened.
 *
 * Every send in the panel goes through here, so the log cannot drift out of step
 * with reality by somebody adding a route and forgetting the bookkeeping. A
 * failure is logged too: "we tried and it bounced" is information, and a log
 * that only records successes quietly answers the wrong question. */

export async function sendAndLog(env, {
  reference, kind, to, subject, html, text, sentBy, meta, idempotencyKey, attachments,
}) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM) {
    throw new Error('Email is not configured on this deployment');
  }

  const headers = {
    authorization: `Bearer ${env.RESEND_API_KEY}`,
    'content-type': 'application/json',
  };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  const support = env.NOTIFY_EMAIL || 'hello@fastkeyshousing.com';
  let providerId = null;
  let error = null;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: env.NOTIFY_FROM, to: [to], reply_to: support, subject, html, text,
        /* Resend takes base64 content. Only the custom composer uses this, and
         * only with files already in our own bucket. */
        ...(attachments && attachments.length ? { attachments } : {}),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.message || `HTTP ${res.status}`);
    providerId = body?.id ?? null;
  } catch (err) {
    error = String(err.message || err);
  }

  /* Written whether or not the send worked, and never allowed to throw: losing
   * the log entry because the log itself failed would be the worst of both.
   *
   * The plain-text body goes in too, so the Sent view can show what was
   * actually said. If the body column is missing because a deploy landed
   * before db:migrate, fall back to the old shape rather than lose the row. */
  const rowId = crypto.randomUUID();
  const common = [
    reference, kind, subject.slice(0, 200), to,
    sentBy, new Date().toISOString(), error ? 'failed' : 'sent',
    error ? error.slice(0, 400) : null, providerId,
    meta ? JSON.stringify(meta).slice(0, 2000) : null,
  ];
  try {
    await env.DB.prepare(
      `INSERT INTO email_log (id, reference, kind, subject, recipient, sent_by, sent_at, status, error, provider_id, meta, body)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`
    ).bind(rowId, ...common, String(text || '').slice(0, 20000)).run();
  } catch (bodyErr) {
    try {
      await env.DB.prepare(
        `INSERT INTO email_log (id, reference, kind, subject, recipient, sent_by, sent_at, status, error, provider_id, meta)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`
      ).bind(rowId, ...common).run();
    } catch (logErr) {
      console.error('[email-log] could not record the send:', logErr);
    }
  }

  if (error) throw new Error(error);
  return { ok: true, providerId };
}
