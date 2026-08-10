/* The nudge for someone who filled the form but never completed payment.
 *
 * Sent by hand from the admin, not automatically, because there is no honest
 * automatic version: we cannot tell from the outside whether the card was
 * refused, the tab was closed, or the person simply changed their mind, and each
 * of those wants a different tone. A human deciding to send it is the check.
 *
 * Short on purpose. They owe us nothing, they have paid nothing, and a long
 * email chasing one euro reads as desperate. One paragraph, one link. */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function reminderEmail({ application, reference, resumeUrl, siteUrl, supportEmail, kind }) {
  const first = (application.name || '').split(' ')[0] || 'there';
  const isViewing = kind === 'viewing';
  /* What they were part way through buying. Saying "an application" to somebody
   * who was booking a viewing of a specific flat reads as a mistake, and a
   * mistake in a payment email is the worst place to look careless. */
  const thing = isViewing
    ? (application.property_address
        ? `a viewing of ${application.property_address}`
        : 'a viewing')
    : `an application for ${application.city || 'a place'}`;
  const city = application.city ? esc(application.city) : 'the Netherlands';

  const text = [
    `Hi ${first},`,
    ``,
    `You started ${thing} with us but the payment did not go through, so`,
    `${isViewing ? 'we have not booked it yet.' : 'we have not started searching yet.'}`,
    ``,
    `Nothing was charged. Your answers are still saved, so picking up where you`,
    `left off takes one click and about ten seconds:`,
    ``,
    resumeUrl,
    ``,
    `If your card was refused, it is very often because a European debit card has`,
    `online payments switched off by default. A credit card usually goes through,`,
    `or your banking app may be waiting for you to approve it.`,
    ``,
    `If you have changed your mind that is completely fine, just ignore this.`,
    ``,
    `Any trouble at all, just reply to this email.`,
    ``,
    `FastKeys`,
    siteUrl,
    reference ? `Reference ${reference}` : ``,
  ].filter((l) => l !== null).join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Your ${isViewing ? 'viewing' : 'application'} is still waiting</title></head>
<body style="margin:0;padding:0;background:#EDEFF2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Nothing was charged, and your answers are still saved.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDEFF2;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;">

  <tr><td style="background:#445162;padding:24px 30px;">
    <div style="color:#E0A35E;font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;">FastKeys</div>
    <div style="color:#fff;font-size:21px;font-weight:600;margin-top:8px;line-height:1.3;">Your ${isViewing ? 'viewing' : 'application'} is still waiting, ${esc(first)}.</div>
  </td></tr>

  <tr><td style="padding:26px 30px 0;">
    <p style="margin:0;font-size:15.5px;line-height:1.65;color:#525E6D;">
      You started ${esc(thing)} with us, but the payment did not go through, so
      ${isViewing ? 'we have not booked it yet' : 'we have not started searching yet'}.
      <strong style="color:#222A35;">Nothing was charged.</strong>
    </p>
    <p style="margin:14px 0 0;font-size:15.5px;line-height:1.65;color:#525E6D;">
      Your answers are still saved. Picking up where you left off takes one click.
    </p>
    <p style="margin:22px 0 0;">
      <a href="${esc(resumeUrl)}" style="display:inline-block;background:#E0A35E;color:#222A35;text-decoration:none;font-weight:700;font-size:15.5px;padding:14px 26px;border-radius:999px;">Finish ${isViewing ? 'your booking' : 'your application'} &rarr;</a>
    </p>
  </td></tr>

  <tr><td style="padding:24px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F9;border-radius:12px;">
      <tr><td style="padding:18px 20px;">
        <div style="font-size:14.5px;font-weight:700;color:#222A35;">If your card was refused</div>
        <p style="margin:7px 0 0;font-size:14px;line-height:1.6;color:#525E6D;">
          It is very often because a European debit card has online payments switched off by
          default. A credit card usually goes through, or your banking app may be waiting for
          you to approve it.
        </p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:22px 30px 28px;">
    <p style="margin:0;font-size:14.2px;line-height:1.65;color:#7A8593;">
      Changed your mind? That is completely fine, just ignore this.
      Any trouble at all, just reply, or email
      <a href="mailto:${esc(supportEmail)}" style="color:#A8702B;">${esc(supportEmail)}</a>.
    </p>
  </td></tr>

  <tr><td style="background:#F6F7F9;padding:16px 30px;border-top:1px solid #E4E8ED;">
    <p style="margin:0;font-size:12px;color:#8A94A2;line-height:1.6;">
      FastKeys &middot; Maastricht, Netherlands &middot;
      <a href="${esc(siteUrl)}" style="color:#8A94A2;">fastkeyshousing.com</a>
      ${reference ? `<br>Reference ${esc(reference)}` : ''}
      <br>You are receiving this once because you began an application with us. Reply to have
      your details deleted.
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  return {
    subject: isViewing
      ? `You didn't finish booking your FastKeys viewing`
      : `You didn't finish your FastKeys application`,
    text,
    html,
  };
}
