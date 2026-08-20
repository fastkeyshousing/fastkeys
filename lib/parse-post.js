/* Pulls listing fields out of a rental advert.
 *
 * Two entry points: parseText for a post somebody has pasted, and parseHtml for
 * a page fetched by URL. Both end in the same shape so the panel only has one
 * form to fill.
 *
 * Everything here is a guess offered to a human for correction, never a fact.
 * A parser that is right most of the time and silently wrong the rest is worse
 * than one that is obviously incomplete, so anything uncertain is left empty
 * rather than filled with something plausible.
 */

/* Dutch street-name endings. A line containing one of these plus a number is
 * almost always the address, which is more reliable than any position rule. */
const STREET = '(?:straat|laan|weg|plein|gracht|singel|kade|hof|dijk|park|steeg|baan|dwarsstraat|boulevard|pad|markt|wal|erf|hoven|street|road|square)';

const clean = (s) => String(s || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();

/* Dutch writes 1.250,50 where English writes 1,250.50. Both appear in these
 * posts, often in the same group, so the separators are worked out from the
 * string rather than assumed. */
function money(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot > -1 && lastComma > -1) {
    /* Whichever comes last is the decimal separator. */
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    /* A lone comma with exactly two digits after it is decimal; otherwise it is
     * a thousands separator. "950,-" is neither, and falls out as 950. */
    s = /,\d{2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else {
    s = s.replace(/\.(?=\d{3}\b)/g, '');
  }
  const n = Math.round(Number(s));
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
}

const first = (text, patterns) => {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m;
  }
  return null;
};

export function parseText(raw) {
  const text = clean(raw);
  if (!text) return {};
  const lower = text.toLowerCase();
  const out = {};

  /* --- rent. "excl." matters: an excluding price is not comparable to an
     including one, so it is carried through into the label. --- */
  const rentMatch = first(text, [
    new RegExp(`(?:huur|rent|prijs|price|per maand|p\\/m|pm)\\s*[:=]?\\s*(?:€|eur)?\\s*([\\d.,]+)`, 'i'),
    /(?:€|eur)\s*([\d.,]+)\s*(?:,-)?\s*(?:p\/m|per maand|per month|pm|\/month|\/maand)/i,
    /(?:€|eur)\s*([\d.,]+)/i,
    /([\d.,]+)\s*(?:euro|eur)\b/i,
  ]);
  const rent = money(rentMatch && rentMatch[1]);
  if (rent) {
    const incl = /\b(incl|inclusief|including|all[- ]?in)\b/i.test(text);
    const excl = /\b(excl|exclusief|excluding)\b/i.test(text);
    out.rent = `€${rent}${incl ? ' incl.' : excl ? ' excl.' : ''}`;
  }

  /* --- deposit --- */
  const depMatch = first(text, [
    /(?:borg|waarborgsom|deposit)\s*[:=]?\s*(?:€|eur)?\s*([\d.,]+)/i,
  ]);
  const dep = money(depMatch && depMatch[1]);
  if (dep) out.deposit = `€${dep}`;

  /* --- address. A street-like line with a house number. --- */
  const addr = first(text, [
    new RegExp(`([A-Z][A-Za-zÀ-ÿ'’.\\- ]{2,40}${STREET}\\s*\\d+\\s*[a-zA-Z]?)`, 'i'),
    new RegExp(`([A-Z][A-Za-zÀ-ÿ'’.\\- ]{2,40}${STREET})`, 'i'),
  ]);
  if (addr) {
    /* Trim advert boilerplate that sits immediately before the street name.
     * "Kamer te huur Grote Gracht 4" is a sentence, not an address. */
    out.address = clean(addr[1])
      .replace(/^(?:kamer|studio|appartement|apartment|room|woning|huis)\s+(?:te\s+huur|for\s+rent|available)?\s*/i, '')
      .replace(/^(?:te\s+huur|for\s+rent|available|aangeboden|nieuw)\s*[:\-]?\s*/i, '')
      .trim();
  }

  const postcode = text.match(/\b(\d{4}\s?[A-Z]{2})\b/);
  if (postcode && out.address) out.address += `, ${postcode[1].toUpperCase()}`;

  /* --- city. Only from a known list: guessing a city wrong sends somebody to
     the wrong end of the country. --- */
  const city = first(text, [
    /\b(maastricht|heerlen|sittard|eindhoven|amsterdam|rotterdam|utrecht|nijmegen|tilburg|den bosch|venlo|roermond|aachen|liège|hasselt)\b/i,
  ]);
  if (city) out.city = city[1].replace(/\b\w/g, (c) => c.toUpperCase());

  /* --- size --- */
  const size = first(text, [/(\d{1,4})\s*(?:m2|m²|vierkante meter|sqm|square met)/i]);
  if (size) out.size = `${size[1]} m²`;

  /* --- what it is --- */
  if (/\bstudio\b/i.test(text)) out.rooms = 'Studio';
  else if (/\b(appartement|apartment|flat)\b/i.test(text)) out.rooms = 'Apartment';
  else if (/\b(kamer|room)\b/i.test(text)) out.rooms = 'Room';
  const beds = text.match(/(\d)\s*(?:slaapkamers?|bedrooms?)/i);
  if (beds) out.rooms = `${beds[1]} bedroom${beds[1] === '1' ? '' : 's'}`;

  /* --- furnished --- */
  if (/\b(gemeubileerd|gestoffeerd|furnished|möbliert)\b/i.test(lower)
      && !/\bunfurnished|ongemeubileerd\b/i.test(lower)) out.furnished = 'Furnished';
  else if (/\b(unfurnished|ongemeubileerd|kaal)\b/i.test(lower)) out.furnished = 'Unfurnished';

  /* --- registration. The single most important line for a student, and the one
     most often buried in the middle of a paragraph. --- */
  if (/\b(geen inschrijving|no registration|not possible to register|zonder inschrijving)\b/i.test(lower)) {
    out.registration = 'No';
  } else if (/\b(inschrijving mogelijk|registration possible|can register|inschrijven mogelijk|met inschrijving)\b/i.test(lower)) {
    out.registration = 'Yes';
  }

  /* --- available from --- */
  const avail = first(text, [
    /(?:beschikbaar|available|per|vanaf|from|ingang)\s*(?:per|from|vanaf)?\s*[:]?\s*(\d{1,2}[-/ ]\d{1,2}[-/ ]\d{2,4})/i,
    /(?:beschikbaar|available|per|vanaf|from)\s*(?:per|from)?\s*[:]?\s*(\d{1,2}\s+(?:jan|feb|mrt|maart|apr|mei|jun|jul|aug|sep|okt|oct|nov|dec)[a-z]*\s*\d{0,4})/i,
    /(?:beschikbaar|available|per|vanaf|from)\s*(?:per|from)?\s*[:]?\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s*\d{4})?)/i,
    /\b(?:per\s+)?(1\s+(?:januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december))/i,
  ]);
  if (avail) out.available_from = clean(avail[1]);

  /* --- how to reach whoever posted it --- */
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/);
  if (email) out.contact_email = email[0].toLowerCase();

  const phone = text.match(/(?:\+31|0031|\b06)[\s-]?\d(?:[\s-]?\d){7,9}/);
  if (phone) out.contact_phone = clean(phone[0]);

  /* --- the description is the post itself, minus the contact details, which
     are held privately rather than published. --- */
  let desc = text;
  if (out.contact_email) desc = desc.split(out.contact_email).join('[contact removed]');
  if (out.contact_phone) desc = desc.split(out.contact_phone).join('[contact removed]');
  out.description = desc.slice(0, 3500);

  /* A title only if there is something real to build it from. */
  if (out.rooms || out.address) {
    out.title = [out.rooms || 'Place', out.address ? `on ${out.address.split(',')[0]}` : null]
      .filter(Boolean).join(' ');
  }

  return out;
}

/* --------------------------------------------------------------- from HTML */

const stripTags = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();

function metaContent(html, keys) {
  for (const key of keys) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i');
    const m = html.match(re);
    if (m && m[1].trim()) return m[1].trim();
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i');
    const m2 = html.match(re2);
    if (m2 && m2[1].trim()) return m2[1].trim();
  }
  return null;
}

/* Structured data first, because a site that publishes schema.org is telling
 * you the answer rather than making you infer it from prose. */
function fromJsonLd(html) {
  const out = {};
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b[1].trim()); } catch { continue; }
    const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const addr = item.address;
      if (addr && typeof addr === 'object') {
        out.address = [addr.streetAddress, addr.postalCode].filter(Boolean).join(', ') || out.address;
        out.city = addr.addressLocality || out.city;
      }
      const offer = item.offers || item.offer;
      const price = offer?.price ?? item.price;
      if (price) out.rent = `€${money(price) ?? price}`;
      if (item.name && !out.title) out.title = String(item.name).slice(0, 160);
      if (item.description && !out.description) out.description = String(item.description).slice(0, 3500);
      const img = item.image;
      if (img) {
        const list = Array.isArray(img) ? img : [img];
        out.images = list.map((i) => (typeof i === 'string' ? i : i?.url)).filter(Boolean);
      }
      if (item.floorSize?.value) out.size = `${item.floorSize.value} m²`;
      if (item.numberOfRooms) out.rooms = `${item.numberOfRooms} rooms`;
    }
  }
  return out;
}

export function parseHtml(html, pageUrl) {
  const structured = fromJsonLd(html);
  const body = stripTags(html).slice(0, 20000);
  const guessed = parseText(body);

  /* Structured data wins where it exists, prose fills the gaps. */
  const out = { ...guessed, ...Object.fromEntries(Object.entries(structured).filter(([, v]) => v)) };

  out.title = structured.title || metaContent(html, ['og:title', 'twitter:title']) || out.title;
  const ogDesc = metaContent(html, ['og:description', 'description']);
  if (ogDesc && (!out.description || out.description.length < 80)) out.description = ogDesc.slice(0, 3500);

  /* Images: structured data, then og:image, then any <img> that looks like a
   * photo rather than an icon or a tracking pixel. */
  const images = new Set(structured.images || []);
  const og = metaContent(html, ['og:image', 'twitter:image']);
  if (og) images.add(og);
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const src = m[1];
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(src) && !/(logo|icon|sprite|avatar|pixel|badge)/i.test(src)) {
      images.add(src);
    }
  }

  /* Relative paths resolved against the page they came from. */
  out.images = [...images].map((src) => {
    try { return new URL(src, pageUrl).toString(); } catch { return null; }
  }).filter(Boolean).slice(0, 30);

  return out;
}
