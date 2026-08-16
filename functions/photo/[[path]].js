/* GET /photo/<listing-id>/<file>.jpg
 *
 * The same objects as /api/listing-image, served from a plain path instead of a
 * query string.
 *
 * That matters for email. Gmail, Outlook and the rest fetch remote images
 * through their own proxies, and a URL like
 *   /api/listing-image?key=listings%2Fabc%2Fp0.jpg
 * carries percent-encoded slashes in a query string, which proxies are prone to
 * decode, re-encode or drop. A URL ending in .jpg with no query survives that,
 * caches properly, and looks like what it is.
 *
 * The old route is kept so photos uploaded before this still resolve.
 */

import { fail, methodNotAllowed } from '../../lib/http.js';

const ID_RE = /^[0-9a-f-]{36}$/;
const FILE_RE = /^[A-Za-z0-9._-]{1,120}$/;

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

export async function onRequestGet({ params, env }) {
  if (!env.DOCS) return fail(503, 'not_configured', 'R2 binding DOCS is not bound');

  /* [[path]] gives the segments after /photo/. Exactly two, each validated, so
   * nothing here can reach outside listings/. */
  const parts = Array.isArray(params.path) ? params.path : [params.path];
  if (parts.length !== 2) return fail(404, 'not_found');

  const [id, file] = parts;
  if (!ID_RE.test(id || '') || !FILE_RE.test(file || '')) return fail(404, 'not_found');
  if (file.includes('..')) return fail(404, 'not_found');

  const object = await env.DOCS.get(`listings/${id}/${file}`);
  if (!object) return fail(404, 'not_found');

  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  return new Response(object.body, {
    headers: {
      'content-type': MIME[ext] || 'application/octet-stream',
      /* The filename contains a uuid, so a different photo is a different URL
       * and this can be cached hard. Email proxies cache aggressively too. */
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}

export function onRequest({ request }) {
  if (request.method === 'GET' || request.method === 'HEAD') return onRequestGet(...arguments);
  return methodNotAllowed('GET');
}
