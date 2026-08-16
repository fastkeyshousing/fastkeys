/* GET /api/listing-image?key=listings/<id>/<file>
 *
 * Serves a listing photo from R2. Public and unauthenticated, because the board
 * itself is public and an <img> tag carries no session.
 *
 * That makes the key check the only guard, so it is strict: the key must sit
 * under listings/ and contain no traversal. Applicant documents live under
 * documents/ in the same bucket and must never be reachable from here.
 */

import { fail, methodNotAllowed } from '../../lib/http.js';

const KEY_RE = /^listings\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/;

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

export async function onRequestGet({ request, env }) {
  if (!env.DOCS) return fail(503, 'not_configured', 'R2 binding DOCS is not bound');

  const key = new URL(request.url).searchParams.get('key') || '';
  /* Belt and braces: the regex already forbids dots as a path segment, but an
   * encoded traversal that slipped through would be caught here. */
  if (!KEY_RE.test(key) || key.includes('..')) return fail(404, 'not_found');

  const object = await env.DOCS.get(key);
  if (!object) return fail(404, 'not_found');

  const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
  return new Response(object.body, {
    headers: {
      'content-type': MIME[ext] || 'application/octet-stream',
      /* Immutable: the key contains a uuid, so a changed photo is a new key. */
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}

export function onRequest({ request }) {
  if (request.method === 'GET' || request.method === 'HEAD') return onRequestGet(...arguments);
  return methodNotAllowed('GET');
}
