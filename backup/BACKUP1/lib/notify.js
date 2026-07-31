/* Delivery of a paid application to you.
 *
 * This runs from the webhook, not from the applicant's browser, which is what
 * makes the payment gate real: there is no client-side path that causes an
 * application to be delivered.
 *
 * Both channels are optional and independent. If neither is configured the
 * application still lands safely in D1 and nothing is lost. */

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
    `Traits:      ${app.personality.join(', ')}`,
    `Hobbies:     ${app.hobbies}`,
    app.notes ? `Notes:       ${app.notes}` : null,
    ``,
    `--- letter ---`,
    letter,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

async function sendTelegram(env, reference, amount, body) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;

  /* Telegram caps a message at 4096 characters. Truncating here keeps the
   * notification useful rather than letting the send fail outright. */
  const header = `✅ Paid application ${reference} (${amount})\n\n`;
  const room = 4000 - header.length;
  const text = header + (body.length > room ? `${body.slice(0, room)}\n… (truncated, full record in D1)` : body);

  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) throw new Error(`Telegram send failed: ${res.status} ${await res.text()}`);
}

async function sendEmail(env, reference, amount, body) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL || !env.NOTIFY_FROM) return;

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
  if (!res.ok) throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
}

/* Never throws. A failed notification must not cause a non-2xx webhook response,
 * because Stripe would then retry a payment we have already recorded. */
export async function notifyPaid(env, { reference, amount, application, letter }) {
  const body = summarise(application, letter);
  const results = await Promise.allSettled([
    sendTelegram(env, reference, amount, body),
    sendEmail(env, reference, amount, body),
  ]);
  for (const r of results) {
    if (r.status === 'rejected') console.error('[notify]', r.reason);
  }
  return results.some((r) => r.status === 'fulfilled');
}
