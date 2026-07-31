/* Server-side validation of the application payload.
 *
 * The browser validates too, but that is a convenience for the applicant, not a
 * control. Nothing reaches the database or Stripe until it has passed through
 * here. Every field is length-capped and every choice field is checked against a
 * fixed list, so the stored record can only ever contain shapes we defined. */

const EMPLOYMENT = ['permanent', 'fixed', 'self', 'student', 'intern'];
const HOUSEHOLD = ['single', 'partner'];
const ADVANCE = ['0', '1', '2', '3', '6'];
const DURATION = ['6 to 12 months', '12+ months', '24+ months', 'an indefinite period'];
const TRAITS = [
  'quiet', 'clean', 'respectful', 'sociable',
  'organized', 'responsible', 'easygoing', 'an early riser',
];

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE_RE = /^[+()\d][\d\s().-]{5,24}$/;
/* The move-in field is a date input, so it arrives as YYYY-MM-DD. The shorter
 * YYYY-MM form is accepted too, since an older cached page may still send it. */
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

/* Strips control characters, collapses whitespace, enforces a length cap.
 * No HTML escaping here: the values are stored as data and escaped at the point
 * they are rendered, which is the only place that knows the right escaping. */
function text(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max);
}

function money(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return null;
  return Math.round(n);
}

function oneOf(value, list) {
  return list.includes(value) ? value : null;
}

export function validateApplication(raw) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['malformed body'] };
  }

  const name = text(raw.name, 120);
  const email = text(raw.email, 254).toLowerCase();
  const phone = text(raw.phone, 30);
  const city = text(raw.city, 100);

  need(name.length >= 2, 'name');
  need(EMAIL_RE.test(email), 'email');
  need(PHONE_RE.test(phone), 'phone');
  need(city.length >= 2, 'city');

  const employment = oneOf(raw.status, EMPLOYMENT);
  need(employment, 'status');

  const role = text(raw.role, 120);
  const organisation = text(raw.organisation ?? raw.org, 140);
  need(role.length >= 2, 'role');
  /* Self-employed applicants may legitimately have no trading name. */
  if (employment !== 'self') need(organisation.length >= 2, 'organisation');

  const income = money(raw.income);
  const budget = money(raw.budget);
  need(income !== null && income > 0, 'income');
  need(budget !== null && budget > 0, 'budget');

  const savings = money(raw.savings);
  const guarantorIncome = money(raw.guarantor_income ?? raw.gross);

  const advance = oneOf(String(raw.months_in_advance ?? raw.advance ?? '0'), ADVANCE);
  need(advance !== null, 'months_in_advance');

  const household = oneOf(raw.household, HOUSEHOLD);
  need(household, 'household');

  const availableFrom = text(raw.available_from ?? raw.from, 10);
  need(DATE_RE.test(availableFrom), 'available_from');

  const duration = oneOf(raw.duration, DURATION);
  need(duration, 'duration');

  const personality = String(raw.personality ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => TRAITS.includes(s));
  const traits = [...new Set(personality)].slice(0, 4);
  need(traits.length >= 3, 'personality');

  const hobbies = text(raw.hobbies, 600);
  need(hobbies.length >= 3, 'hobbies');

  /* These two are consent statements. The client cannot supply "false" and still
   * proceed, so anything other than a literal true is a rejected submission
   * rather than a silently-defaulted one. */
  need(raw.terms_accepted === true, 'terms_accepted');
  need(raw.immediate_start_requested === true, 'immediate_start_requested');

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      email,
      phone,
      city,
      employment,
      role,
      organisation,
      income,
      budget,
      savings,
      guarantor_income: guarantorIncome,
      months_in_advance: advance,
      household,
      available_from: availableFrom,
      duration,
      no_pets: raw.no_pets === true,
      non_smoker: raw.non_smoker === true,
      no_instruments: raw.no_instruments === true,
      personality: traits,
      hobbies,
      notes: text(raw.notes, 1500),
      terms_accepted: true,
      immediate_start_requested: true,
    },
  };
}

/* The landlord letter is rebuilt here rather than trusted from the browser.
 * If it were accepted as submitted text, the form would be an open channel for
 * writing arbitrary content into the email that lands in your inbox. */
export function buildLetter(a) {
  const eur = (n) => (n === null ? '' : n.toLocaleString('nl-NL'));
  const when = (() => {
    const iso = a.available_from.length === 7 ? `${a.available_from}-01` : a.available_from;
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(d.getTime())
      ? a.available_from
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  })();

  const lines = [];
  lines.push(`Hi,`, ``, `My name is ${a.name} and I would like to schedule a viewing at your earliest convenience.`, ``, `Financial:`);

  if (a.employment === 'student') {
    lines.push(`- ${a.role} student at ${a.organisation}${a.guarantor_income ? ', with a guarantor' : ''}`);
  } else if (a.employment === 'self') {
    lines.push(`- Self-employed — ${a.role}${a.organisation ? `, ${a.organisation}` : ''}`);
  } else {
    const contract =
      a.employment === 'fixed' ? 'fixed-term contract'
      : a.employment === 'intern' ? 'internship contract'
      : 'permanent contract';
    lines.push(`- ${a.role} at ${a.organisation}, ${contract}`);
  }

  lines.push(`- Monthly income: €${eur(a.income)} / Budget: €${eur(a.budget)}`);

  if (a.months_in_advance !== '0') {
    const m = a.months_in_advance;
    lines.push(`- Willing to pay ${m} month${m === '1' ? '' : 's'} rent in advance to secure the apartment`);
  }
  if (a.savings) lines.push(`- Savings: €${eur(a.savings)}`);
  if (a.guarantor_income) lines.push(`- Guarantor's monthly income: €${eur(a.guarantor_income)}`);

  lines.push(
    ``,
    `Personal:`,
    `- ${a.household === 'partner' ? 'With partner' : 'Single'}`,
    `- Available from: ${when}`,
    `- Looking for ${a.duration}`
  );

  const neg = [];
  if (a.no_pets) neg.push('No pets');
  if (a.non_smoker) neg.push('non-smoker');
  if (a.no_instruments) neg.push('no musical instruments');
  if (neg.length) {
    neg[0] = neg[0].charAt(0).toUpperCase() + neg[0].slice(1);
    lines.push(`- ${neg.join(', ')}`);
  }

  lines.push(
    ``,
    `About me:`,
    `- Personality: ${a.personality.join(', ')}`,
    `- Hobbies / lifestyle: ${a.hobbies}`,
    ``,
    `All necessary documents are prepared and available upon request.`,
    ``,
    `Best regards,`,
    a.name,
    a.email,
    a.phone
  );

  return lines.join('\n');
}
