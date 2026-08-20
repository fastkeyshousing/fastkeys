/* Asks a client for the paperwork a landlord will want.
 *
 * Deliberately late in the relationship rather than at signup. Dutch privacy
 * guidance treats identity documents and income evidence as disproportionate to
 * collect from everyone up front: they are proportionate once somebody is
 * actually in the running for a place. Asking now, and saying why, is both
 * better practice and a better email.
 *
 * The BSN warning is not decoration. A copy of a Dutch ID showing the BSN is
 * something we would have no lawful basis to hold, so the email tells them how
 * to cover it before sending.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const ITEMS = [
  {
    title: 'A copy of your passport or ID card',
    body: 'Photo page only. <strong>Cover your BSN and your document number before you send it.</strong> '
        + 'The Dutch government has a free app called KopieID that does this for you in about a minute. '
        + 'We do not need your BSN and are not allowed to keep it.',
  },
  {
    title: 'Your date of birth',
    body: 'Landlords ask, and it saves a round trip. Just write it in your reply.',
  },
  {
    title: 'Your current home address',
    body: 'Where you live now, wherever that is in the world. It goes on the application form '
        + 'and on the contract.',
  },
  {
    title: 'A recent payslip from your guarantor',
    body: 'If somebody is guaranteeing your rent, usually a parent, one recent payslip is enough. '
        + 'If you are guaranteeing yourself, send your own most recent payslip, or your employment '
        + 'contract if you have started recently.',
  },
];

export function documentsEmail({ application, reference, siteUrl, supportEmail, extraNote }) {
  const first = String(application?.name || '').split(' ')[0] || 'there';

  const text = [
    `Hi ${first},`,
    ``,
    `We are getting close to putting you forward for places, and Dutch landlords`,
    `all ask for the same paperwork. If you send it now, we can apply the same day`,
    `something suitable comes up rather than losing two days to admin.`,
    ``,
    `Just reply to this email with:`,
    ``,
    ...ITEMS.flatMap((item, i) => [
      `${i + 1}. ${item.title}`,
      `   ${item.body.replace(/<[^>]+>/g, '')}`,
      ``,
    ]),
    extraNote ? `${extraNote}` : null,
    extraNote ? `` : null,
    `Why now and not at signup: identity documents and income evidence are only`,
    `proportionate to ask for once you are actually in the running for a place,`,
    `so we wait until it is useful rather than collecting it on principle.`,
    ``,
    `Everything is stored encrypted, in the EU, and only we can open it. Ask us to`,
    `delete it at any time and we will.`,
    ``,
    `Your reference is ${reference}.`,
    ``,
    `FastKeys`,
    siteUrl,
    supportEmail,
  ].filter((l) => l !== null).join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>The documents we need</title></head>
<body style="margin:0;padding:0;background:#EDEFF2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Four things, and we can apply the same day a place comes up.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDEFF2;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;">

  <tr><td style="background:#445162;padding:24px 30px;">
    <div style="color:#E0A35E;font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;">FastKeys</div>
    <div style="color:#fff;font-size:21px;font-weight:600;margin-top:8px;line-height:1.3;">Four things we need, ${esc(first)}.</div>
  </td></tr>

  <tr><td style="padding:26px 30px 0;">
    <p style="margin:0 0 14px;font-size:15.5px;line-height:1.68;color:#525E6D;">
      We are getting close to putting you forward for places, and Dutch landlords all ask for the
      same paperwork. If you send it now, we can apply <strong style="color:#222A35;">the same day</strong>
      something suitable comes up, rather than losing two days to admin while the place goes to
      somebody else.
    </p>
    <p style="margin:0 0 6px;font-size:15.5px;line-height:1.68;color:#525E6D;">
      Just reply to this email with:
    </p>
  </td></tr>

  ${ITEMS.map((item, i) => `<tr><td style="padding:14px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="34" valign="top" style="padding-top:2px;">
          <div style="width:26px;height:26px;border-radius:50%;background:#E0A35E;color:#2A2116;font-weight:700;font-size:14px;text-align:center;line-height:26px;">${i + 1}</div>
        </td>
        <td valign="top">
          <div style="font-size:16px;font-weight:700;color:#222A35;">${esc(item.title)}</div>
          <p style="margin:5px 0 0;font-size:14.5px;line-height:1.65;color:#525E6D;">${item.body}</p>
        </td>
      </tr>
    </table>
  </td></tr>`).join('')}

  ${extraNote ? `<tr><td style="padding:18px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF7EC;border:1.5px solid rgba(224,163,94,.5);border-radius:12px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0;font-size:14.8px;line-height:1.65;color:#222A35;">${esc(extraNote)}</p>
      </td></tr>
    </table>
  </td></tr>` : ''}

  <tr><td style="padding:22px 30px 0;">
    <p style="margin:0;">
      <a href="mailto:${esc(supportEmail)}?subject=${encodeURIComponent(`Documents — ${reference}`)}"
         style="display:inline-block;background:#E0A35E;color:#2A2116;text-decoration:none;font-weight:700;font-size:15.5px;padding:13px 26px;border-radius:999px;">Reply with my documents</a>
    </p>
  </td></tr>

  <tr><td style="padding:24px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F9;border-radius:12px;">
      <tr><td style="padding:18px 22px;">
        <div style="font-size:15px;font-weight:700;color:#222A35;">Why we ask now and not when you signed up</div>
        <p style="margin:6px 0 0;font-size:14.4px;line-height:1.65;color:#525E6D;">
          Identity documents and income evidence are only proportionate to ask for once you are
          actually in the running for a place. So we wait until it is useful rather than collecting
          it on principle.
        </p>
        <p style="margin:10px 0 0;font-size:14.4px;line-height:1.65;color:#525E6D;">
          Everything is stored encrypted, in the EU, and only we can open it. Ask us to delete it
          at any time and we will.
        </p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:22px 30px 28px;">
    <p style="margin:0;font-size:14px;color:#7A8593;line-height:1.6;">
      Anything unclear, just reply. Your reference is
      <strong style="color:#222A35;">${esc(reference)}</strong>.
    </p>
  </td></tr>

  <tr><td style="background:#F6F7F9;padding:16px 30px;border-top:1px solid #E4E8ED;">
    <p style="margin:0;font-size:12px;color:#8A94A2;line-height:1.6;">
      FastKeys &middot; Maastricht, Netherlands &middot;
      <a href="${esc(siteUrl)}" style="color:#8A94A2;">fastkeyshousing.com</a>
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  return { subject: `Four documents we need for your search (${reference})`, text, html };
}
