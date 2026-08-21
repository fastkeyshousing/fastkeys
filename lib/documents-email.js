/* Asks a client for the paperwork that books a place.
 *
 * Sent at one moment in the relationship: a property went out to the client,
 * the client wants it, and the application is about to go in. Everything the
 * landlord will ask for is requested in one reply, because a file that is
 * complete the day it is needed is the difference between getting the place
 * and losing two days to admin while it goes to somebody else.
 *
 * Dutch privacy guidance treats identity documents and income evidence as
 * disproportionate to collect from everyone up front: they are proportionate
 * once somebody is actually applying. Asking now, and saying why, is both
 * better practice and a better email.
 *
 * The BSN warning is not decoration. A copy of a Dutch ID showing the BSN is
 * something we would have no lawful basis to hold, so the email tells the
 * client, and their guarantor, how to cover it before sending.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const ITEMS = [
  {
    title: 'Proof of your UM enrollment',
    body: 'Forward the enrollment confirmation email from Maastricht University, or a screenshot '
        + 'of your enrollment in the student portal. Landlords ask for proof that you are a '
        + 'registered student.',
  },
  {
    title: 'A recent payslip from your guarantor',
    body: 'One recent payslip from the person guaranteeing your rent, usually a parent, is enough. '
        + 'If you are guaranteeing yourself, send your own most recent payslip, or your employment '
        + 'contract if you have started recently.',
  },
  {
    title: 'A copy of your guarantor\u2019s passport or ID card',
    body: 'Photo page only. <strong>If it is a Dutch document, they should cover the BSN and the '
        + 'document number before sending it</strong> \u2014 the free KopieID app from the Dutch '
        + 'government does this in about a minute. We do not need a BSN and are not allowed to keep one.',
  },
  {
    title: 'Your guarantor\u2019s phone number and email address',
    body: 'The landlord or agency will contact them to confirm the guarantee, and they usually '
        + 'sign the contract too. Just write both in your reply.',
  },
  {
    title: 'A copy of your passport or ID card',
    body: 'Photo page only. <strong>Cover your BSN and your document number before you send it.</strong> '
        + 'The Dutch government has a free app called KopieID that does this for you in about a minute. '
        + 'We do not need your BSN and are not allowed to keep it.',
  },
  {
    title: 'Your IBAN',
    body: 'The bank account the rent and the deposit will be paid from. It goes on the contract '
        + 'and the payment forms. The IBAN alone is enough \u2014 never send card numbers or codes.',
  },
  {
    title: 'Your home address and date of birth',
    body: 'Your current home address, wherever that is in the world, and your date of birth. '
        + 'Both go on the application form and on the contract. Just write them in your reply.',
  },
];

/* The copy counts the items, so the copy follows the list rather than the
 * other way round: edit ITEMS and every "seven" updates itself. */
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
               'eight', 'nine', 'ten', 'eleven', 'twelve'];
const countWord = (n) => WORDS[n] || String(n);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function documentsEmail({ application, reference, siteUrl, supportEmail, extraNote }) {
  const first = String(application?.name || '').split(' ')[0] || 'there';
  const n = ITEMS.length;

  const text = [
    `Hi ${first},`,
    ``,
    `Good news: to book the place and put your application in, the landlord will`,
    `ask for the paperwork below. Every Dutch landlord asks for the same things,`,
    `so one reply with all ${countWord(n)} and we can submit the same day, rather than`,
    `losing two days to admin while the place goes to somebody else.`,
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
    `proportionate to ask for once you are actually applying for a place, so we`,
    `wait until it is useful rather than collecting it on principle.`,
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
<title>The documents that book your place</title></head>
<body style="margin:0;padding:0;background:#EDEFF2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${cap(countWord(n))} things in one reply, and your application goes in the same day.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDEFF2;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;">

  <tr><td style="background:#445162;padding:24px 30px;">
    <div style="color:#E0A35E;font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;">FastKeys</div>
    <div style="color:#fff;font-size:21px;font-weight:600;margin-top:8px;line-height:1.3;">${cap(countWord(n))} things that book your place, ${esc(first)}.</div>
  </td></tr>

  <tr><td style="padding:26px 30px 0;">
    <p style="margin:0 0 14px;font-size:15.5px;line-height:1.68;color:#525E6D;">
      Good news. To book the place and put your application in, the landlord will ask for the
      paperwork below. Every Dutch landlord asks for the same things, so one reply with all
      ${countWord(n)} and we can submit <strong style="color:#222A35;">the same day</strong>, rather
      than losing two days to admin while the place goes to somebody else.
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
          actually applying for a place. So we wait until it is useful rather than collecting
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

  return { subject: `The ${countWord(n)} documents that book your place (${reference})`, text, html };
}
