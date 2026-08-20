/* POST /api/panel/import
 *
 *   { mode: 'text', text: '<the post>' }   parse something already pasted
 *   { mode: 'url',  url: 'https://...' }   fetch a page and parse it
 *
 * Neither creates anything. Both return a draft for a human to check, because a
 * parser is a guess and a listing on a public site is a claim about somebody
 * else's property.
 *
 * Open to any signed-in staff member: the board is day-to-day work, nothing
 * here publishes by itself, and the url fetcher below refuses private hosts.
 */

import { json, fail, sameOrigin, methodNotAllowed } from '../../../lib/http.js';
import { currentUser } from '../../../lib/admin-auth.js';
import { parseText, parseHtml } from '../../../lib/parse-post.js';

const MAX_HTML = 2 * 1024 * 1024;

/* Fetching a URL chosen by a signed-in user is still a request this server
 * makes, so it is kept to public http(s) hosts. Localhost and the private
 * ranges are refused: a panel that will fetch any address on request is a way
 * to reach things behind the network boundary. */
function checkUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    return { error: 'That does not look like a link' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Only http and https links' };

  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return { error: 'That host is not allowed' };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    const private_ = a === 10 || a === 127 || a === 0
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254);
    if (private_) return { error: 'That host is not allowed' };
  }
  if (host.includes(':')) return { error: 'That host is not allowed' };  // raw IPv6

  /* Facebook is deliberately refused. Their pages need an authenticated session
   * and automated collection is against their terms, so the honest route for a
   * Facebook post is to paste its text, which is the text mode above. */
  if (/(^|\.)(facebook|fb|instagram|messenger)\.com$/.test(host)) {
    return { error: 'Facebook pages cannot be fetched. Copy the post text and use "Paste a post" instead.' };
  }

  return { url: u.toString(), host };
}

export async function onRequestPost({ request, env }) {
  const siteUrl = (env.SITE_URL || 'https://fastkeyshousing.com').replace(/\/$/, '');
  if (!sameOrigin(request, siteUrl)) return fail(403, 'bad_origin');

  const user = await currentUser(request, env);
  if (!user) return fail(401, 'not_signed_in');

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'bad_json');
  }

  if (body.mode === 'text') {
    const text = String(body.text || '');
    if (text.trim().length < 20) return fail(422, 'too_short', 'Paste the whole post');
    const draft = parseText(text.slice(0, 20000));
    return json({
      ok: true, draft, source: 'facebook',
      /* Facebook's CDN URLs expire and are theirs, so hot-linking them would
       * leave a listing full of broken images within days. The photos have to
       * be saved and uploaded, which the panel does after the draft is saved. */
      note: 'Photos cannot be pulled from Facebook. Save them from the post and upload them once the listing is created.',
    });
  }

  if (body.mode === 'url') {
    const checked = checkUrl(body.url);
    if (checked.error) return fail(422, 'bad_url', checked.error);

    let res;
    try {
      res = await fetch(checked.url, {
        headers: {
          /* Named honestly. A scraper pretending to be a browser is a scraper
           * that does not want to be identified, and this one has permission. */
          'user-agent': 'FastKeysBot/1.0 (+https://fastkeyshousing.com; listing import with permission)',
          'accept': 'text/html,application/xhtml+xml',
          'accept-language': 'nl,en;q=0.8',
        },
        redirect: 'follow',
        cf: { cacheTtl: 60 },
      });
    } catch (err) {
      return fail(502, 'fetch_failed', String(err));
    }

    if (!res.ok) return fail(502, 'fetch_failed', `The page returned ${res.status}`);

    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (!type.includes('html') && !type.includes('text')) {
      return fail(415, 'not_a_page', `That link is ${type || 'not a web page'}`);
    }

    const raw = await res.text();

    /* A page assembled in the browser arrives as an empty shell: a bit of markup
     * and a script tag. Parsing it produces a listing full of wrong guesses,
     * which is worse than none, so it is refused with an explanation instead. */
    const visible = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const hasStructured = /application\/ld\+json/i.test(raw) || /property=["']og:/i.test(raw);
    if (visible.length < 400 && !hasStructured) {
      return fail(422, 'page_is_empty',
        'That page builds itself in the browser, so there is nothing to read from the server. '
        + 'Open it, select the text and use "Paste a post" instead.');
    }

    const html = raw.slice(0, MAX_HTML);
    const draft = parseHtml(html, checked.url);
    draft.source_url = checked.url;

    /* Reported so a thin result is visibly thin rather than quietly wrong. */
    const filled = ['address', 'rent', 'city', 'size', 'rooms', 'available_from']
      .filter((k) => draft[k]).length;
    if (filled < 2) {
      return fail(422, 'nothing_found',
        'The page loaded but nothing recognisable came out of it. Copy the text and use '
        + '"Paste a post" instead, which reads free text rather than page structure.');
    }

    console.log(`[import] ${user.email} imported ${checked.host}`);
    return json({
      ok: true, draft, source: 'renthunter', host: checked.host,
      images: draft.images || [],
    });
  }

  return fail(422, 'bad_mode');
}

export function onRequest({ request }) {
  if (request.method === 'POST') return onRequestPost(...arguments);
  return methodNotAllowed('POST');
}
