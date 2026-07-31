/* Delivery of a paid application to you.
 *
 * This runs from the webhook, not from the applicant's browser, which is what
 * makes the payment gate real: there is no client-side path that causes an
 * application to be delivered.
 *
 * Each channel reports one of three outcomes: skipped (not configured), sent, or
 * failed. Those are kept distinct on purpose. An earlier version treated "not
 * configured" as success, which meant a paid application could be stamped as
 * delivered while nothing had actually been sent anywhere. */

const TELEGRAM_API = 'https://api.telegram.org';

function euro(n) {
  return n === null || n === undefined ? '—' : `€${Number(n).toLocaleString('nl-NL')}`;
}

export function summarise(app, letter) {
  const employmentLabel = {
    permanent: 'Employed, permanent',
    fixed: 'Employed, fixed-term',
    self: 'Self-employed',
    student: 'Student',
    intern: 'Intern / trainee',
  }[app.employment] || app.employment;

  const traits = Array.isArray(app.personality) ? app.personality.join(', ') : (app.personality || '');

  return [
    `Name:        ${app.name}`,
    `Email:       ${app.email}`,
    `Phone:       ${app.phone}`,
    `City:        ${app.city}`,
    `Status:      ${employmentLabel} — ${app.role}${app.organisation ? ` @ ${app.organisation}` : ''}`,
    `Income:      ${euro(app.income)} / month`,
    `Budget:      ${euro(app.budget)} / month`,
    `Savings:     ${euro(app.savings)}`,
    `Guarantor:   ${euro(app.guarantor_income)}`,
    `Advance:     ${app.months_in_advance} month(s)`,
    `Household:   ${app.household === 'partner' ? 'With partner' : 'Single'}`,
    `From:        ${app.available_from}`,
    `Duration:    ${app.duration}`,
    `Traits:      ${traits}`,
    `Hobbies:     ${app.hobbies}`,
    app.notes ? `Notes:       ${app.notes}` : null,
    ``,
    `--- letter ---`,
    letter,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/* Telegram caps a message at 4096 characters. Truncating keeps the notification
 * useful rather than letting the whole send fail. */
export function telegramMessage(reference, amount, body) {
  const header = `✅ Paid application ${reference} (${amount})\n\n`;
  const room = 4000 - header.length;
  return header + (body.length > room
    ? `${body.slice(0, room)}\n… (truncated, full record in D1)`
    : body);
}

/* Exported so the standalone credential check exercises exactly this code path
 * rather than an approximation of it. */
export async function sendTelegram(env, reference, amount, body) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return { channel: 'telegram', status: 'skipped' };
  }

  const base = env.TELEGRAM_API_BASE || TELEGRAM_API;
  const res = await fetch(`${base}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: telegramMessage(reference, amount, body),
      disable_web_page_preview: true,
    }),
  });

  /* Telegram can answer 200 with ok:false, so the status code alone is not
   * enough to conclude the message arrived. */
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* fall through to the status check below */
  }

  if (!res.ok || payload?.ok === false) {
    throw new Error(`Telegram: ${payload?.description || `HTTP ${res.status}`}`);
  }

  return { channel: 'telegram', status: 'sent' };
}

export async function sendEmail(env, reference, amount, body) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL || !env.NOTIFY_FROM) {
    return { channel: 'email', status: 'skipped' };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.NOTIFY_FROM,
      to: [env.NOTIFY_EMAIL],
      subject: `Paid application ${reference} (${amount})`,
      text: body,
    }),
  });

  if (!res.ok) throw new Error(`Resend: HTTP ${res.status} ${await res.text()}`);
  return { channel: 'email', status: 'sent' };
}

/* Never throws: a failed notification must not produce a non-2xx webhook
 * response, or Stripe retries a payment we have already recorded.
 *
 * Returns true only when a channel actually delivered something. The caller
 * stamps notified_at on that basis, so "paid but never delivered" stays a
 * question the database can answer. */
export async function notifyPaid(env, { reference, amount, application, letter }) {
  const body = summarise(application, letter);

  const settled = await Promise.allSettled([
    sendTelegram(env, reference, amount, body),
    sendEmail(env, reference, amount, body),
  ]);

  let delivered = false;
  const outcomes = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      outcomes.push(`${result.value.channel}=${result.value.status}`);
      if (result.value.status === 'sent') delivered = true;
    } else {
      outcomes.push(`failed: ${result.reason?.message || result.reason}`);
      console.error('[notify]', result.reason);
    }
  }

  if (!delivered) {
    console.error(
      `[notify] application ${reference} was NOT delivered to any channel (${outcomes.join(', ')}). ` +
      `The record is safe in D1. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, ` +
      `or RESEND_API_KEY with NOTIFY_EMAIL and NOTIFY_FROM.`
    );
  } else {
    console.log(`[notify] application ${reference} delivered (${outcomes.join(', ')})`);
  }

  return delivered;
}
