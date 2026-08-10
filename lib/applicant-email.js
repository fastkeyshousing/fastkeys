/* The email the applicant receives once the euro clears.
 *
 * Four jobs: give them the reference in a form they can search their inbox for,
 * link the Stripe receipt, show back the details we hold so mistakes surface
 * now rather than in front of a landlord, and tell them which documents to get
 * ready.
 *
 * On that last point, note what this email does NOT do: it does not ask anyone
 * to send identity documents or payslips. The Autoriteit Persoonsgegevens
 * position is that income evidence may be requested when someone is seriously
 * in the running for a specific property, not as a condition of signing up, and
 * that anyone holding copies of identity documents takes on extra security
 * obligations because of the identity-fraud risk. Asking at this point would be
 * both too early and, over ordinary email, the wrong channel. So the applicant
 * is told what to prepare and how to redact it, and the actual request happens
 * per property, when a landlord asks. */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function euro(n) {
  return n === null || n === undefined || n === '' ? null : `€${Number(n).toLocaleString('nl-NL')}`;
}

function prettyDate(value) {
  if (!value) return null;
  const iso = value.length === 7 ? `${value}-01` : value;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/* Shown back so the applicant can catch a typo in their own email address or a
 * budget with a digit missing. Only fields they gave us; nothing inferred. */
function detailRows(a) {
  const employment = {
    permanent: 'Employed, permanent contract',
    fixed: 'Employed, fixed-term contract',
    self: 'Self-employed',
    student: 'Student',
    intern: 'Intern / trainee',
  }[a.employment] || a.employment;

  return [
    ['Name', a.name],
    ['Email', a.email],
    ['Phone', a.phone],
    ['Looking in', a.city],
    ['Situation', `${employment}${a.role ? ` — ${a.role}` : ''}${a.organisation ? `, ${a.organisation}` : ''}`],
    ['Monthly income', euro(a.income)],
    ['Monthly budget', euro(a.budget)],
    ['Savings', euro(a.savings)],
    ['Guarantor income', euro(a.guarantor_income)],
    ['Rent in advance', a.months_in_advance && a.months_in_advance !== '0' ? `${a.months_in_advance} month(s)` : null],
    ['Household', a.household === 'partner' ? 'With partner' : 'Single'],
    ['Available from', prettyDate(a.available_from)],
    ['Looking for', a.duration],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
}

/* Asked for now, by reply. An enrolment certificate is proof of student status,
 * not income and not an identity document, so requesting it up front is
 * proportionate in a way that payslips and passport scans are not. It is also
 * the single document Dutch landlords ask students for first, so having it on
 * file is what lets us answer within the hour. */
const REQUEST_NOW = {
  title: 'Your university enrolment certificate',
  body:
    'Please reply to this email with it attached. It is the one document Dutch landlords ' +
    'ask students for first, and having it on file means we can answer a landlord within ' +
    'the hour instead of waiting on you. Your university calls it a bewijs van inschrijving ' +
    'or enrolment certificate, and you can usually download it from your student portal in ' +
    'under a minute.',
};

/* Everything else stays as preparation. We ask for a specific document when a
 * specific landlord needs it, which keeps us holding as little as possible. */
const DOCUMENTS = [
  ['Proof of identity', 'Passport or ID card. Cover your BSN before sending it to anyone — the free KopieID app from the Dutch government does this for you.'],
  ['Proof of income', 'Your last three payslips, or an employer statement (werkgeversverklaring), or your guarantor\'s payslips if you have one.'],
  ['Employment contract', 'The signed contract, or your internship agreement.'],
  ['Bank statements', 'The last three months, showing salary arriving. You can black out unrelated transactions.'],
  ['Guarantor documents', 'If someone is guaranteeing your rent: their ID (BSN covered), their payslips, and their written agreement to act as guarantor.'],
];

export function applicantEmail({ reference, application, receiptUrl, siteUrl, supportEmail, opening }) {
  const first = (application.name || '').split(' ')[0] || 'there';
  const rows = detailRows(application);

  /* ---------------------------------------------------------------- plain text
   * Sent alongside the HTML. Some clients show it, some filters score it, and
   * it is what remains readable if the styling is stripped. */
  const text = [
    `Your spot is confirmed, ${first}.`,
    ``,
    opening ? `${opening}\n` : `Thank you for trusting us with this. We know handing money to a housing`,
    opening ? `` : `service you found online takes a leap of faith, and we do not take that lightly.`,
    ``,
    `We start work on your search today.`,
    ``,
    `YOUR REFERENCE: ${reference}`,
    `Save this. Quote it in any email to us.`,
    ``,
    receiptUrl ? `Receipt for your €1 confirmation: ${receiptUrl}` : `Receipt: sent separately by Stripe.`,
    ``,
    `WHAT WE HOLD FOR YOU`,
    ...rows.map(([k, v]) => `  ${k}: ${v}`),
    ``,
    `If anything above is wrong, reply to this email and we will correct it.`,
    ``,
    `WHAT HAPPENS NEXT`,
    `  1. We start searching today. Our system watches the listing sites around`,
    `     the clock and applies for you the moment something matching appears,`,
    `     under your name.`,
    `  2. We contact you as soon as we find a property that may interest you.`,
    `     You do not need to check in with us, we come to you.`,
    `  3. You hear from us as soon as a landlord responds.`,
    `  4. We read any contract before you sign it.`,
    ``,
    `Our work costs you nothing until you have signed a lease we found you.`,
    ``,
    `PLEASE REPLY WITH ONE DOCUMENT`,
    `${REQUEST_NOW.title}.`,
    REQUEST_NOW.body,
    ``,
    `WHEN WE ARE AROUND`,
    `Office hours are Monday to Friday, 9:00 to 17:00. That is when we reply to`,
    `email and speak to landlords.`,
    ``,
    `Viewings are different. Properties get shown in the evening and at weekends,`,
    `so we attend whenever a landlord offers a slot, office hours or not. If you`,
    `cannot get to one yourself, we can go for you:`,
    `${siteUrl}/viewings`,
    ``,
    `GET THESE READY TOO (do not send them yet)`,
    `Dutch landlords move fast and usually ask for paperwork within hours of`,
    `inviting you to view. Having it ready is often what decides who gets the`,
    `place. We will ask you for a specific document only when a specific landlord`,
    `needs it.`,
    ``,
    ...DOCUMENTS.flatMap(([k, v]) => [`  * ${k}`, `      ${v}`]),
    ``,
    `A note on your BSN: your citizen service number appears on your ID and your`,
    `payslips. Landlords and agents are not allowed to process it, so cover it`,
    `before sending anything to anyone. The KopieID app does this properly.`,
    `Never email an unedited passport scan to a landlord you have not verified.`,
    ``,
    `Questions: ${supportEmail}`,
    `${siteUrl}`,
  ].join('\n');

  /* ---------------------------------------------------------------------- html */
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>Your spot is confirmed</title></head>
<body style="margin:0;padding:0;background:#EDEFF2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Reference ${esc(reference)} — save this, and what to get ready next.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDEFF2;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">

  <tr><td style="background:#445162;padding:26px 30px;">
    <div style="color:#E0A35E;font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;">FastKeys</div>
    <div style="color:#ffffff;font-size:23px;font-weight:600;margin-top:8px;line-height:1.3;">Your spot is confirmed, ${esc(first)}.</div>
  </td></tr>

  <tr><td style="padding:24px 30px 0;">
    <p style="margin:0;font-size:15.5px;line-height:1.65;color:#525E6D;">
      ${opening ? esc(opening) : 'Thank you for trusting us with this. We know handing money to a housing service you found online takes a leap of faith, and we do not take that lightly.'}
    </p>
    <p style="margin:12px 0 0;font-size:15.5px;line-height:1.65;color:#222A35;font-weight:600;">
      We start work on your search today.
    </p>
  </td></tr>

  <tr><td style="padding:22px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#FFF7EC;border:1.5px dashed rgba(224,163,94,.6);border-radius:12px;">
      <tr><td align="center" style="padding:18px;">
        <div style="font-size:12.5px;color:#A8702B;font-weight:700;letter-spacing:.05em;text-transform:uppercase;">Your reference</div>
        <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:24px;font-weight:700;color:#222A35;letter-spacing:.06em;margin:9px 0 6px;">${esc(reference)}</div>
        <div style="font-size:13px;color:#525E6D;">Save this now. Quote it in any email to us.</div>
      </td></tr>
    </table>
  </td></tr>

  ${receiptUrl ? `<tr><td style="padding:16px 30px 0;">
    <p style="margin:0;font-size:14.5px;color:#525E6D;line-height:1.6;">
      Your &euro;1 confirmation went through.
      <a href="${esc(receiptUrl)}" style="color:#A8702B;font-weight:600;">View your receipt</a>.
      <span style="color:#7A8593;">Stripe receipt links expire after 30 days, so save a copy if you need one.</span>
    </p>
  </td></tr>` : ''}

  <tr><td style="padding:26px 30px 0;">
    <div style="font-size:16px;font-weight:700;color:#222A35;">What we hold for you</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;font-size:14.5px;">
      ${rows.map(([k, v], i) => `<tr>
        <td style="padding:8px 12px 8px 0;color:#7A8593;width:42%;border-top:${i ? '1px solid #EDEFF2' : 'none'};">${esc(k)}</td>
        <td style="padding:8px 0;color:#222A35;font-weight:600;border-top:${i ? '1px solid #EDEFF2' : 'none'};">${esc(v)}</td>
      </tr>`).join('')}
    </table>
    <p style="margin:14px 0 0;font-size:13.5px;color:#7A8593;line-height:1.6;">
      If anything here is wrong, just reply to this email and we will fix it.
    </p>
  </td></tr>

  <tr><td style="padding:26px 30px 0;">
    <div style="font-size:16px;font-weight:700;color:#222A35;">What happens next</div>
    <ol style="margin:12px 0 0;padding-left:20px;font-size:14.5px;color:#525E6D;line-height:1.7;">
      <li><strong>We start searching today.</strong> Our system watches the listing sites around the clock and applies for you the moment something matching appears, under your name.</li>
      <li><strong>We contact you as soon as we find a property that may interest you.</strong> You do not need to check in with us — we come to you.</li>
      <li>You hear from us as soon as a landlord responds.</li>
      <li>We read any contract before you sign it.</li>
    </ol>
    <p style="margin:14px 0 0;font-size:14.5px;color:#525E6D;line-height:1.6;">
      All of that costs you nothing until you have signed a lease we found you.
    </p>
  </td></tr>

  <tr><td style="padding:26px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#FFF7EC;border:1.5px solid rgba(224,163,94,.5);border-radius:12px;">
      <tr><td style="padding:20px 22px;">
        <div style="font-size:12.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#A8702B;">One thing we need from you</div>
        <div style="font-size:16.5px;font-weight:700;color:#222A35;margin-top:8px;">${esc(REQUEST_NOW.title)}</div>
        <p style="margin:8px 0 0;font-size:14.4px;color:#525E6D;line-height:1.65;">${esc(REQUEST_NOW.body)}</p>
        <p style="margin:14px 0 0;">
          <a href="mailto:${esc(supportEmail)}?subject=${encodeURIComponent('Enrolment certificate — ' + reference)}"
             style="display:inline-block;background:#E0A35E;color:#222A35;text-decoration:none;font-weight:700;font-size:14.5px;padding:11px 20px;border-radius:999px;">Reply with my certificate</a>
        </p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:20px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F9;border-radius:12px;">
      <tr><td style="padding:20px 22px;">
        <div style="font-size:16px;font-weight:700;color:#222A35;">When we are around</div>
        <p style="margin:9px 0 0;font-size:14.4px;color:#525E6D;line-height:1.65;">
          Office hours are <strong>Monday to Friday, 9:00 to 17:00</strong>. That is when we reply to
          email and speak to landlords.
        </p>
        <p style="margin:10px 0 0;font-size:14.4px;color:#525E6D;line-height:1.65;">
          Viewings are different. Properties get shown in the evening and at weekends, so we attend
          whenever a landlord offers a slot, office hours or not. If you cannot get to one yourself,
          <a href="${esc(siteUrl)}/viewings" style="color:#A8702B;font-weight:600;">we can go for you</a>
          — online from &euro;50, or same-day express from &euro;100.
        </p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:20px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F9;border-radius:12px;">
      <tr><td style="padding:20px 22px;">
        <div style="font-size:16px;font-weight:700;color:#222A35;">Get these ready too — don't send them yet</div>
        <p style="margin:9px 0 0;font-size:14px;color:#525E6D;line-height:1.6;">
          Dutch landlords move fast and usually want paperwork within hours of inviting you
          to view. Having it ready is often what decides who gets the place. We will ask you
          for a specific document only when a specific landlord needs it.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
          ${DOCUMENTS.map(([k, v]) => `<tr><td style="padding:9px 0;border-top:1px solid #E4E8ED;">
            <div style="font-size:14.5px;font-weight:600;color:#222A35;">${esc(k)}</div>
            <div style="font-size:13.5px;color:#7A8593;line-height:1.55;margin-top:3px;">${esc(v)}</div>
          </td></tr>`).join('')}
        </table>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:18px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#FDF3F3;border-left:3px solid #C4666A;border-radius:8px;">
      <tr><td style="padding:15px 18px;">
        <div style="font-size:14px;font-weight:700;color:#8C3A3F;">Protect your BSN</div>
        <p style="margin:6px 0 0;font-size:13.5px;color:#6B4247;line-height:1.6;">
          Your citizen service number appears on your ID and your payslips. Landlords and
          agents are not allowed to process it, so cover it before sending anything to anyone.
          The free <strong>KopieID</strong> app from the Dutch government does this properly.
          Never email an unedited passport scan to a landlord you have not verified.
        </p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:26px 30px 30px;">
    <p style="margin:0;font-size:14px;color:#525E6D;line-height:1.6;">
      Questions? Just reply, or email
      <a href="mailto:${esc(supportEmail)}" style="color:#A8702B;">${esc(supportEmail)}</a>.
    </p>
  </td></tr>

  <tr><td style="background:#F6F7F9;padding:18px 30px;border-top:1px solid #E4E8ED;">
    <p style="margin:0;font-size:12px;color:#8A94A2;line-height:1.6;">
      FastKeys · Maastricht, Netherlands · <a href="${esc(siteUrl)}" style="color:#8A94A2;">fastkeyshousing.com</a><br>
      You are receiving this because you confirmed an application with us. Your details are
      stored in the EU and never sold. Reply to this email to have them corrected or deleted.
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  return {
    subject: `Your spot is confirmed — ${reference}`,
    text,
    html,
  };
}

/* Delivery. Resend is the provider here because Cloudflare withdrew the free
 * MailChannels route for Workers; any provider with a REST API would slot in.
 *
 * reply_to is set to the support address so a reply lands somewhere a person
 * reads, rather than at a noreply nobody watches. */
export async function sendApplicantEmail(env, { reference, application, receiptUrl }) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM) {
    return { channel: 'applicant-email', status: 'skipped' };
  }
  if (!application?.email) {
    return { channel: 'applicant-email', status: 'skipped' };
  }

  const siteUrl = (env.SITE_URL || 'https://fastkeyshousing.com').replace(/\/$/, '');
  const supportEmail = env.NOTIFY_EMAIL || 'hello@fastkeyshousing.com';
  const { subject, text, html } = applicantEmail({
    reference,
    application,
    receiptUrl,
    siteUrl,
    supportEmail,
  });

  const res = await fetch(`${env.RESEND_API_BASE || 'https://api.resend.com'}/emails`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      /* Resend keys idempotency off this header, so a webhook retry cannot send
       * the applicant a second copy of the same confirmation. */
      'idempotency-key': `applicant-${reference}`,
    },
    body: JSON.stringify({
      from: env.NOTIFY_FROM,
      to: [application.email],
      reply_to: supportEmail,
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend (applicant): HTTP ${res.status} ${await res.text()}`);
  }
  return { channel: 'applicant-email', status: 'sent' };
}
