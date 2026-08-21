/* Asks a client one question: should we keep looking for you?
 *
 * Sent as a check-in, usually in bulk, when a search has been running a while.
 * The honest reason to send it is the same as the useful one: some clients
 * found a place on their own, or went home, or changed plans, and never said
 * so. Every one of those is a search we are still running for nobody, and a
 * person still receiving property emails they no longer want.
 *
 * The email makes both answers one tap: a Yes button and a No button, each a
 * mailto with the reference in the subject so the reply files itself. Saying
 * no is presented as a completely fine outcome, with the offer to delete their
 * data, because a check-in that only makes "yes" easy is not a question.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function stillLookingEmail({ application, reference, siteUrl, supportEmail, extraNote, resume }) {
  const first = String(application?.name || '').split(' ')[0] || 'there';

  /* Two situations, one email shape. A live search gets "should we keep
   * looking?". A closed one — the client was archived — gets "want us to start
   * again?", because telling somebody their closed search is still open would
   * be untrue in the first line. */
  const yesSubject = resume ? `Start looking again — ${reference}` : `Keep looking — ${reference}`;
  const noSubject = resume ? `Stay stopped — ${reference}` : `Stop my search — ${reference}`;
  const yesLabel = resume ? 'Yes, start looking again' : 'Yes, keep looking';
  const noLabel = resume ? 'No thanks' : 'No, stop the search';
  const yesBody = resume
    ? 'Yes, please start looking again. My budget, dates and area are now:\n\n'
    : 'Yes, keep looking. Updates to my budget, dates or area (if any):\n\n';
  const noBody = resume ? 'No thanks, keep my search closed.\n\n' : 'Please stop my search.\n\n';
  const question = resume
    ? 'Your search with us is closed at the moment. Want us to start looking for a place for you again?'
    : 'Your search is still open with us \u2014 do you want us to keep looking for a place for you?';
  const headline = resume
    ? `Want us to start looking again, ${first}?`
    : `Should we keep looking, ${first}?`;
  const silence = resume
    ? 'If we do not hear from you, nothing happens: your search stays closed and that is that.'
    : 'If we do not hear from you, nothing bad happens: the search stays open and we may check in again.';

  const text = [
    `Hi ${first},`,
    ``,
    `A quick question, and one reply settles it: ${resume
      ? 'your search with us is closed at the moment. Want us to start looking again?'
      : 'should we keep looking for a place for you?'}`,
    ``,
    resume
      ? `If yes — reply "start again" with your current budget, dates and area, and`
      : `If yes — reply "keep looking" and we carry on. If your budget, dates or`,
    resume
      ? `we pick the search back up with those details.`
      : `area have changed since you signed up, tell us in the same reply and we`,
    resume ? `` : `will search with the new details.`,
    resume ? null : ``,
    resume
      ? `If no — that is completely fine. Your search simply stays closed, and if`
      : `If no — maybe you found a place, or your plans changed — reply "stop" and`,
    resume
      ? `you want us to delete the details we hold, say so and we will.`
      : `we will close the search. That is a completely fine answer, and if you`,
    resume ? null : `want us to delete the details we hold, say so and we will.`,
    ``,
    silence,
    ``,
    extraNote ? `${extraNote}` : null,
    extraNote ? `` : null,
    `Your reference is ${reference}.`,
    ``,
    `FastKeys`,
    siteUrl,
    supportEmail,
  ].filter((l) => l !== null).join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${resume ? 'Want us to start looking again?' : 'Should we keep looking?'}</title></head>
<body style="margin:0;padding:0;background:#EDEFF2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">One tap answers it, either way.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDEFF2;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;">

  <tr><td style="background:#445162;padding:24px 30px;">
    <div style="color:#E0A35E;font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;">FastKeys</div>
    <div style="color:#fff;font-size:21px;font-weight:600;margin-top:8px;line-height:1.3;">${esc(headline)}</div>
  </td></tr>

  <tr><td style="padding:26px 30px 0;">
    <p style="margin:0 0 14px;font-size:15.5px;line-height:1.68;color:#525E6D;">
      A quick check-in, and one tap settles it. ${question}
    </p>
  </td></tr>

  <tr><td style="padding:8px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:0 8px 0 0;" width="50%" align="center">
          <a href="mailto:${esc(supportEmail)}?subject=${encodeURIComponent(yesSubject)}&body=${encodeURIComponent(yesBody)}"
             style="display:block;background:#E0A35E;color:#2A2116;text-decoration:none;font-weight:700;font-size:15.5px;padding:14px 10px;border-radius:999px;">${esc(yesLabel)}</a>
        </td>
        <td style="padding:0 0 0 8px;" width="50%" align="center">
          <a href="mailto:${esc(supportEmail)}?subject=${encodeURIComponent(noSubject)}&body=${encodeURIComponent(noBody)}"
             style="display:block;background:#F6F7F9;color:#222A35;text-decoration:none;font-weight:700;font-size:15.5px;padding:14px 10px;border-radius:999px;border:1.5px solid #D6DBE2;">${esc(noLabel)}</a>
        </td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="padding:22px 30px 0;">
    <p style="margin:0 0 12px;font-size:14.6px;line-height:1.68;color:#525E6D;">
      <strong style="color:#222A35;">If yes</strong> &mdash; ${resume
        ? 'put your current budget, dates and area in the reply and we pick the search back up with those details.'
        : 'and your budget, dates or area have changed since you signed up, put the new details in the same reply and we will search with those instead.'}
    </p>
    <p style="margin:0;font-size:14.6px;line-height:1.68;color:#525E6D;">
      <strong style="color:#222A35;">If no</strong> &mdash; ${resume
        ? 'that is completely fine: your search simply stays closed. If you want the details we hold deleted, say so in the reply and we will delete them.'
        : 'maybe you found a place, or plans changed &mdash; that is a completely fine answer. We close the search, and if you want the details we hold deleted, say so in the reply and we will delete them.'}
    </p>
  </td></tr>

  ${extraNote ? `<tr><td style="padding:18px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF7EC;border:1.5px solid rgba(224,163,94,.5);border-radius:12px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0;font-size:14.8px;line-height:1.65;color:#222A35;">${esc(extraNote)}</p>
      </td></tr>
    </table>
  </td></tr>` : ''}

  <tr><td style="padding:22px 30px 28px;">
    <p style="margin:0;font-size:14px;color:#7A8593;line-height:1.6;">
      ${esc(silence)} Your reference is <strong style="color:#222A35;">${esc(reference)}</strong>.
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

  return {
    subject: resume
      ? `Want us to start looking again? (${reference})`
      : `Should we keep looking for you? (${reference})`,
    text, html,
  };
}
