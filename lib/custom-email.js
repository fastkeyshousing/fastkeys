/* A branded email with whatever you want to say in it.
 *
 * The escaping matters more here than in the fixed templates. Those interpolate
 * values we generated; this one interpolates whatever somebody typed, and if
 * that reached the HTML unescaped then the composer would be a way to put
 * arbitrary markup into a message signed with your domain's DKIM key. So the
 * body is escaped and only paragraph breaks are honoured.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

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

function paragraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 15px;font-size:15.5px;line-height:1.7;color:#525E6D;">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function customEmail({ heading, body, attachments = [], ctaLabel, ctaUrl, siteUrl, supportEmail }) {
  const cta = safeUrl(ctaUrl);
  const files = attachments.filter((a) => a && a.filename);

  const text = [
    heading || 'From FastKeys',
    '',
    String(body || ''),
    '',
    cta && ctaLabel ? `${ctaLabel}: ${cta}` : null,
    files.length ? `Attached: ${files.map((f) => f.filename).join(', ')}` : null,
    '',
    'FastKeys',
    siteUrl,
    `Questions? ${supportEmail}`,
  ].filter((l) => l !== null).join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(heading || 'FastKeys')}</title></head>
<body style="margin:0;padding:0;background:#EDEFF2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDEFF2;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;">

  <tr><td style="background:#445162;padding:24px 30px;">
    <div style="color:#E0A35E;font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;">FastKeys</div>
    ${heading ? `<div style="color:#fff;font-size:21px;font-weight:600;margin-top:8px;line-height:1.3;">${esc(heading)}</div>` : ''}
  </td></tr>

  <tr><td style="padding:26px 30px 0;">${paragraphs(body)}</td></tr>

  ${cta && ctaLabel ? `<tr><td style="padding:6px 30px 0;">
    <a href="${esc(cta)}" style="display:inline-block;background:#E0A35E;color:#222A35;text-decoration:none;font-weight:700;font-size:15.5px;padding:13px 24px;border-radius:999px;">${esc(ctaLabel)}</a>
  </td></tr>` : ''}

  ${files.length ? `<tr><td style="padding:22px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F9;border-radius:12px;">
      <tr><td style="padding:16px 20px;">
        <div style="font-size:14px;font-weight:700;color:#222A35;">Attached to this email</div>
        ${files.map((f) => `<div style="font-size:14px;color:#525E6D;margin-top:6px;">${esc(f.filename)}</div>`).join('')}
      </td></tr>
    </table>
  </td></tr>` : ''}

  <tr><td style="padding:24px 30px 28px;">
    <p style="margin:0;font-size:14px;color:#7A8593;line-height:1.6;">
      Questions? Just reply, or email
      <a href="mailto:${esc(supportEmail)}" style="color:#A8702B;">${esc(supportEmail)}</a>.
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

  return { subject: heading || 'A message from FastKeys', text, html };
}
