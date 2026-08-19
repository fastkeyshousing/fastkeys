/* The email that goes to a landlord or agency about one specific client.
 *
 * Different from every other template here, because it is the only one written
 * to somebody who has never heard of us. So it does three things in order:
 * says who we are in one line, presents one real tenant with the numbers a
 * landlord actually screens on, and asks for one small next step.
 *
 * On the incentive: whatever is passed in is printed verbatim. Nothing about a
 * payment is hard-coded, because who pays whom is the single most consequential
 * detail in this business and it must be a deliberate decision each time rather
 * than a default baked into a template. See the note in the panel.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const euro = (n) => {
  if (n === null || n === undefined || n === '') return null;
  const num = Number(String(n).replace(/[^\d.]/g, ''));
  return Number.isFinite(num) && num > 0 ? `€${num.toLocaleString('nl-NL')}` : String(n);
};

function paragraphs(text, colour = '#525E6D') {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;font-size:15.5px;line-height:1.68;color:${colour};">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function row(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<tr>
    <td style="padding:8px 12px 8px 0;color:#7A8593;font-size:14.5px;width:44%;border-top:1px solid #EDEFF2;">${esc(label)}</td>
    <td style="padding:8px 0;color:#222A35;font-size:14.5px;font-weight:600;border-top:1px solid #EDEFF2;">${esc(value)}</td>
  </tr>`;
}

/* The tenant, described the way a landlord screens: can they pay, how long will
 * they stay, and will they be a nuisance. Nothing else belongs here, and the
 * applicant's full contact details deliberately do not: they are introduced at
 * the meeting, not handed out in a cold email. */
function tenantRows(client) {
  const employment = {
    permanent: 'Employed, permanent contract',
    fixed: 'Employed, fixed-term contract',
    self: 'Self-employed',
    student: 'Student',
    intern: 'Intern / trainee',
  }[client.employment] || client.employment;

  return [
    ['Situation', [employment, client.role, client.organisation].filter(Boolean).join(' · ')],
    ['Monthly income', euro(client.income)],
    ['Guarantor income', euro(client.guarantor_income)],
    ['Savings', euro(client.savings)],
    ['Rent they can pay in advance', client.months_in_advance && client.months_in_advance !== '0'
      ? `${client.months_in_advance} month(s)` : null],
    ['Household', client.household === 'partner' ? 'Two people, a couple' : 'One person'],
    ['Wants to move', client.available_from],
    ['Looking to stay', client.duration],
    ['How they describe themselves', Array.isArray(client.personality)
      ? client.personality.join(', ') : client.personality],
  ].map(([k, v]) => row(k, v)).join('');
}

export function landlordEmail({
  recipientName, address, clientFirstName, client = {},
  intro, incentive, meetingText, listingUrl,
  siteUrl, supportEmail, senderName, reference,
}) {
  const greeting = recipientName ? `Dear ${recipientName}` : 'Hello';
  const rows = tenantRows(client);

  const text = [
    `${greeting},`,
    ``,
    intro || `I am writing about ${address}.`,
    ``,
    `I am ${senderName || 'from FastKeys'}, a tenant-side housing service in Maastricht.`,
    `We work for the tenant, not for landlords: we are paid by the person looking`,
    `for a home and we take no commission from you.`,
    ``,
    `I have one client who fits this property:`,
    ``,
    ...[
      ['Situation', [client.employment, client.role, client.organisation].filter(Boolean).join(' · ')],
      ['Monthly income', euro(client.income)],
      ['Guarantor income', euro(client.guarantor_income)],
      ['Rent in advance', client.months_in_advance && client.months_in_advance !== '0' ? `${client.months_in_advance} month(s)` : null],
      ['Household', client.household === 'partner' ? 'Two people, a couple' : 'One person'],
      ['Wants to move', client.available_from],
      ['Looking to stay', client.duration],
    ].filter(([, v]) => v).map(([k, v]) => `  ${k}: ${v}`),
    ``,
    incentive ? `${incentive}` : null,
    incentive ? `` : null,
    meetingText || `Could we arrange a short introductory meeting so you can meet ${clientFirstName || 'them'} in person? Twenty minutes at the property is usually enough for both sides to know.`,
    ``,
    `Every document you would normally ask for is already on file and can be with`,
    `you the same day: proof of enrolment or employment, income evidence and a`,
    `guarantor where there is one. I also read the contract before my client signs,`,
    `which tends to mean fewer questions later rather than more.`,
    ``,
    listingUrl ? `The property: ${listingUrl}` : null,
    ``,
    `Just reply to this email and I will work around your availability.`,
    ``,
    senderName || 'FastKeys',
    siteUrl,
    supportEmail,
    reference ? `Our reference for this client: ${reference}` : null,
  ].filter((l) => l !== null).join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(address)}</title></head>
<body style="margin:0;padding:0;background:#EDEFF2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">A screened tenant for ${esc(address)}, and no commission to pay.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDEFF2;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;">

  <tr><td style="background:#445162;padding:24px 30px;">
    <div style="color:#E0A35E;font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;">FastKeys</div>
    <div style="color:#fff;font-size:20px;font-weight:600;margin-top:8px;line-height:1.35;">A tenant for ${esc(address)}</div>
  </td></tr>

  <tr><td style="padding:26px 30px 0;">
    <p style="margin:0 0 14px;font-size:15.5px;line-height:1.68;color:#525E6D;">${esc(greeting)},</p>
    ${paragraphs(intro || `I am writing about ${address}.`)}
    <p style="margin:0 0 14px;font-size:15.5px;line-height:1.68;color:#525E6D;">
      I am ${esc(senderName || 'from FastKeys')}, a tenant-side housing service in Maastricht.
      <strong style="color:#222A35;">We work for the tenant, not for landlords</strong> &mdash; we are
      paid by the person looking for a home and take no commission from you.
    </p>
  </td></tr>

  ${rows ? `<tr><td style="padding:10px 30px 0;">
    <div style="font-size:16.5px;font-weight:700;color:#222A35;margin-bottom:4px;">My client${clientFirstName ? `, ${esc(clientFirstName)}` : ''}</div>
    <p style="margin:0 0 8px;font-size:14.2px;color:#7A8593;line-height:1.6;">
      Already screened by us and ready to move. Full name and contact details at the meeting.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </td></tr>` : ''}

  ${incentive ? `<tr><td style="padding:22px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF7EC;border:1.5px solid rgba(224,163,94,.55);border-radius:12px;">
      <tr><td style="padding:18px 22px;">
        <div style="font-size:12.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#A8702B;">To hold it for us</div>
        ${paragraphs(incentive, '#222A35')}
      </td></tr>
    </table>
  </td></tr>` : ''}

  <tr><td style="padding:22px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F9;border-radius:12px;">
      <tr><td style="padding:18px 22px;">
        <div style="font-size:16px;font-weight:700;color:#222A35;">An introductory meeting</div>
        ${paragraphs(meetingText || `Could we arrange a short introductory meeting so you can meet ${clientFirstName || 'them'} in person? Twenty minutes at the property is usually enough for both sides to know.`)}
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:22px 30px 0;">
    <div style="font-size:16px;font-weight:700;color:#222A35;margin-bottom:6px;">What you get from dealing with us</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14.6px;color:#525E6D;">
      <tr><td style="padding:6px 0;">&bull;&nbsp; One screened candidate rather than forty unread messages.</td></tr>
      <tr><td style="padding:6px 0;">&bull;&nbsp; Every document the same day: enrolment or employment, income, guarantor.</td></tr>
      <tr><td style="padding:6px 0;">&bull;&nbsp; I read the contract before my client signs, so there are fewer questions later.</td></tr>
      <tr><td style="padding:6px 0;">&bull;&nbsp; One point of contact, and no commission from you.</td></tr>
    </table>
  </td></tr>

  ${listingUrl ? `<tr><td style="padding:18px 30px 0;">
    <a href="${esc(listingUrl)}" style="color:#A8702B;font-weight:600;font-size:15px;">The property &rarr;</a>
  </td></tr>` : ''}

  <tr><td style="padding:22px 30px 0;">
    <p style="margin:0;font-size:15.5px;line-height:1.68;color:#525E6D;">
      Just reply to this email and I will work around your availability.
    </p>
    <p style="margin:14px 0 0;">
      <a href="mailto:${esc(supportEmail)}?subject=${encodeURIComponent(`Re: ${address}`)}"
         style="display:inline-block;background:#E0A35E;color:#2A2116;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:999px;">Reply about ${esc(address).slice(0, 40)}</a>
    </p>
  </td></tr>

  <tr><td style="padding:24px 30px 28px;">
    <p style="margin:0;font-size:14.5px;line-height:1.7;color:#525E6D;">
      Kind regards,<br>
      <strong style="color:#222A35;">${esc(senderName || 'FastKeys')}</strong><br>
      <a href="mailto:${esc(supportEmail)}" style="color:#A8702B;">${esc(supportEmail)}</a>
    </p>
  </td></tr>

  <tr><td style="background:#F6F7F9;padding:16px 30px;border-top:1px solid #E4E8ED;">
    <p style="margin:0;font-size:12px;color:#8A94A2;line-height:1.6;">
      FastKeys &middot; Maastricht, Netherlands &middot;
      <a href="${esc(siteUrl)}" style="color:#8A94A2;">fastkeyshousing.com</a><br>
      We act for tenants only. We do not advertise properties on a landlord's behalf and take no
      commission from landlords or agents.
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  return {
    subject: `A screened tenant for ${address}`,
    text,
    html,
  };
}
