/* Server-side validation for a viewing request.
 *
 * Shorter than the application form on purpose: this is a single errand, not a
 * profile. The one field that genuinely matters is the listing, because without
 * it we cannot attend anything, and a viewing request without a property is just
 * money with no instruction attached. */

const SERVICES = { online: 5000, express: 10000 };   // cents, for cross-checking only
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE_RE = /^[+()\d][\d\s().-]{5,24}$/;
const REF_RE = /^FK-[A-Z0-9]{5}-[A-Z0-9]{3}$/;

function text(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max);
}

/* Only http(s), and only something that parses. Anything else in this field is
 * either a mistake or an attempt to get a link of their choosing in front of
 * whoever reads the notification. */
function listingUrl(raw) {
  const v = text(raw, 500);
  if (!v) return null;
  let candidate = v;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function validateViewing(raw) {
  const errors = [];
  const need = (cond, field) => { if (!cond) errors.push(field); };

  if (typeof raw !== 'object' || raw === null) return { ok: false, errors: ['malformed body'] };

  const service = ['online', 'express'].includes(raw.service) ? raw.service : null;
  need(service, 'service');

  const name = text(raw.name, 120);
  const email = text(raw.email, 254).toLowerCase();
  const phone = text(raw.phone, 30);
  need(name.length >= 2, 'name');
  need(EMAIL_RE.test(email), 'email');
  need(PHONE_RE.test(phone), 'phone');

  /* The listing link is now optional: plenty of places circulate in Facebook
   * groups or by message with no public URL, and refusing those turned away
   * exactly the viewings people most need help with. The address carries the
   * requirement instead, because that is what we actually navigate to. */
  const propertyUrl = raw.property_url ? listingUrl(raw.property_url) : null;
  if (raw.property_url && String(raw.property_url).trim()) need(propertyUrl, 'property_url');

  const address = text(raw.property_address, 240);
  need(address.length >= 6, 'property_address');

  /* Whether they join live or get it recorded. This changes how we run the
   * viewing, so it cannot be inferred later. */
  const attendance = ['live', 'recorded'].includes(raw.attendance) ? raw.attendance : null;
  need(attendance, 'attendance');

  /* Optional link back to an application. Validated in shape only: a wrong
   * reference here is a note to us, not a security boundary. */
  const applicationReference = text(raw.application_reference, 20).toUpperCase();
  if (applicationReference) need(REF_RE.test(applicationReference), 'application_reference');

  /* Only asked for when they intend to join the call. On a recorded viewing we
   * go whenever the landlord offers a slot and send the footage afterwards, so
   * demanding their availability would be asking for something we do not use. */
  const availability = text(raw.availability, 400);
  if (raw.attendance === 'live') need(availability.length >= 3, 'availability');

  /* Optional. We check the usual things regardless, and forcing a sentence out
   * of somebody who has nothing particular in mind just produces filler. */
  const questions = text(raw.questions, 1200);

  need(raw.terms_accepted === true, 'terms_accepted');
  /* Express is sold on a 24-hour promise, so the buyer has to have seen it. */
  if (service === 'express') need(raw.express_understood === true, 'express_understood');

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      service,
      name,
      email,
      phone,
      property_url: propertyUrl,
      property_address: address,
      attendance,
      application_reference: applicationReference || null,
      availability,
      questions,
      expected_cents: SERVICES[service],
      terms_accepted: true,
    },
  };
}
