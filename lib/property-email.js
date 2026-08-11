/* A property put in front of one applicant.
 *
 * The pitch of the whole service is that we look at places on your behalf, so
 * this email is the product. It carries images, the numbers a tenant decides on,
 * and whatever you want to say about it.
 *
 * Images are referenced by URL rather than attached. Attachments push a message
 * into spam far more readily, they cannot be updated once sent, and a listing
 * photo is already hosted somewhere on the internet. */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/* Only http(s), and only something that parses. A javascript: or data: URL in a
 * src attribute is how a template becomes an attack on your own customer. */
export function safeUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/* Paragraph breaks are honoured, everything else is escaped. Staff writing a
 * description should not be able to inject markup into their own email, whether
 * by accident or otherwise. */
function paragraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;font-size:15.5px;line-height:1.68;color:#525E6D;">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function factRow(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<tr>
    <td style="padding:8px 12px 8px 0;color:#7A8593;font-size:14.5px;width:42%;border-top:1px solid #EDEFF2;">${esc(label)}</td>
    <td style="padding:8px 0;color:#222A35;font-size:14.5px;font-weight:600;border-top:1px solid #EDEFF2;">${esc(value)}</td>
  </tr>`;
}

export function propertyEmail({
  recipientName, reference, headline, intro, images = [], listingUrl,
  address, rent, deposit, available, size, rooms, furnished, registration,
  bodyText, siteUrl, supportEmail,
}) {
  const first = String(recipientName || '').split(' ')[0] || 'there';
  const safeImages = images.map(safeUrl).filter(Boolean).slice(0, 6);
  const listing = safeUrl(listingUrl);

  const facts = [
    ['Address', address],
    ['Rent', rent],
    ['Deposit', deposit],
    ['Available from', available],
    ['Size', size],
    ['Rooms', rooms],
    ['Furnished', furnished],
    ['Registration possible', registration],
  ].map(([k, v]) => factRow(k, v)).join('');

  const text = [
    `Hi ${first},`,
    ``,
    headline ? headline : `We have found a property that may suit you.`,
    ``,
    intro || '',
    ``,
    address ? `Address:        ${address}` : null,
    rent ? `Rent:           ${rent}` : null,
    deposit ? `Deposit:        ${deposit}` : null,
    available ? `Available from: ${available}` : null,
    size ? `Size:           ${size}` : null,
    rooms ? `Rooms:          ${rooms}` : null,
    furnished ? `Furnished:      ${furnished}` : null,
    registration ? `Registration:   ${registration}` : null,
    ``,
    bodyText || '',
    ``,
    listing ? `Listing: ${listing}` : null,
    safeImages.length ? `Photos:\n${safeImages.map((i) => `  ${i}`).join('\n')}` : null,
    ``,
    `If you want it, reply to this email and we will put your application in`,
    `front of the landlord today. If it is not right, tell us why and we will`,
    `use that to narrow the search.`,
    ``,
    `FastKeys`,
    siteUrl,
    reference ? `Reference ${reference}` : null,
  ].filter((l) => l !== null).join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(headline || 'A property for you')}</title></head>
<body style="margin:0;padding:0;background:#EDEFF2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(address || 'A property we think fits what you asked for.')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDEFF2;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;">

  <tr><td style="background:#445162;padding:24px 30px;">
    <div style="color:#E0A35E;font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;">FastKeys</div>
    <div style="color:#fff;font-size:21px;font-weight:600;margin-top:8px;line-height:1.3;">${esc(headline || `${first}, we have found something for you.`)}</div>
  </td></tr>

  ${intro ? `<tr><td style="padding:24px 30px 0;">${paragraphs(intro)}</td></tr>` : ''}

  ${safeImages.length ? `<tr><td style="padding:${intro ? '8' : '24'}px 30px 0;">
    <img src="${esc(safeImages[0])}" alt="${esc(address || 'Property photo')}" width="540"
         style="width:100%;max-width:540px;height:auto;border-radius:12px;display:block;">
    ${safeImages.length > 1 ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr>
      ${safeImages.slice(1, 4).map((src) => `<td style="padding-right:8px;">
        <img src="${esc(src)}" alt="" width="170" style="width:100%;height:auto;border-radius:9px;display:block;">
      </td>`).join('')}
    </tr></table>` : ''}
  </td></tr>` : ''}

  ${facts ? `<tr><td style="padding:24px 30px 0;">
    <div style="font-size:16px;font-weight:700;color:#222A35;margin-bottom:6px;">The details</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${facts}</table>
  </td></tr>` : ''}

  ${bodyText ? `<tr><td style="padding:22px 30px 0;">
    <div style="font-size:16px;font-weight:700;color:#222A35;margin-bottom:8px;">What we think</div>
    ${paragraphs(bodyText)}
  </td></tr>` : ''}

  ${listing ? `<tr><td style="padding:20px 30px 0;">
    <a href="${esc(listing)}" style="color:#A8702B;font-weight:600;font-size:15px;">View the full listing &rarr;</a>
  </td></tr>` : ''}

  <tr><td style="padding:24px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF7EC;border:1.5px solid rgba(224,163,94,.5);border-radius:12px;">
      <tr><td style="padding:20px 22px;">
        <div style="font-size:16px;font-weight:700;color:#222A35;">Want it?</div>
        <p style="margin:8px 0 0;font-size:14.6px;line-height:1.65;color:#525E6D;">
          Reply to this email and we will put your application in front of the landlord today.
          Places in Maastricht move within days, so a quick yes or no helps more than a considered one.
        </p>
        <p style="margin:12px 0 0;font-size:14.6px;line-height:1.65;color:#525E6D;">
          Not right? Tell us what is wrong with it. That is genuinely useful, and it is how the
          next one gets closer.
        </p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:22px 30px 28px;">
    <p style="margin:0;font-size:14px;color:#7A8593;line-height:1.6;">
      Questions? Just reply, or email
      <a href="mailto:${esc(supportEmail)}" style="color:#A8702B;">${esc(supportEmail)}</a>.
    </p>
  </td></tr>

  <tr><td style="background:#F6F7F9;padding:16px 30px;border-top:1px solid #E4E8ED;">
    <p style="margin:0;font-size:12px;color:#8A94A2;line-height:1.6;">
      FastKeys &middot; Maastricht, Netherlands &middot;
      <a href="${esc(siteUrl)}" style="color:#8A94A2;">fastkeyshousing.com</a>
      ${reference ? `<br>Reference ${esc(reference)}` : ''}
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  return {
    subject: headline || `A property for you${address ? ` — ${address}` : ''}`,
    text,
    html,
  };
}
