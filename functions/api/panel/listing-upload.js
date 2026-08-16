/* POST /api/panel/listing-upload?id=<listing id>&filename=x.jpg
 *
 * Raw image body. Owner only, because publishing to the public site is an owner
 * decision and a photo is the most visible part of a listing.
 *
 * Returns the URL the board should use. The object goes to R2 under
 * listings/<id>/, deliberately a different prefix from documents/, so the public
 * image route can be permissive about listings without ever exposing an
 * applicant's passport.
 */

import { json, fail, sameOrigin, methodNotAllowed } from '../../../lib/http.js';
import { currentUser } from '../../../lib/admin-auth.js';

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
};

export async function onRequestPost({ request, env }) {
  const siteUrl = (env.SITE_URL || 'https://fastkeyshousing.com').replace(/\/$/, '');
  if (!env.DB) return fail(503, 'not_configured', 'D1 binding DB is not bound');
  if (!env.DOCS) return fail(503, 'not_configured', 'R2 binding DOCS is not bound');
  if (!sameOrigin(request, siteUrl)) return fail(403, 'bad_origin');

  const user = await currentUser(request, env);
  if (!user) return fail(401, 'not_signed_in');
  if (user.role !== 'owner') return fail(403, 'not_permitted');

  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return fail(422, 'bad_id');

  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim();
  const ext = ALLOWED[contentType];
  if (!ext) return fail(415, 'unsupported_type');

  const body = await request.arrayBuffer();
  if (!body.byteLength) return fail(422, 'empty_file');
  if (body.byteLength > MAX_BYTES) return fail(413, 'too_large');

  /* The stored name is generated, not taken from the upload: a filename from a
   * browser is user input and has no business in an object key. */
  const key = `listings/${id}/${crypto.randomUUID()}.${ext}`;

  try {
    await env.DOCS.put(key, body, {
      httpMetadata: { contentType },
      customMetadata: { listing: id, uploadedBy: user.email },
    });
  } catch (err) {
    return fail(502, 'storage_failed', String(err));
  }

  const src = `/api/listing-image?key=${encodeURIComponent(key)}`;

  /* Appended to the listing straight away, so an upload cannot be lost by
   * somebody closing the form before saving. */
  try {
    const row = await env.DB.prepare(`SELECT images FROM listings WHERE id = ?1`).bind(id).first();
    if (row) {
      let images = [];
      try { images = JSON.parse(row.images || '[]'); } catch { images = []; }
      images.push(src);
      await env.DB.prepare(`UPDATE listings SET images = ?1, updated_at = ?2 WHERE id = ?3`)
        .bind(JSON.stringify(images.slice(0, 8)), new Date().toISOString(), id).run();
    }
  } catch (err) {
    console.error('[listing-upload] could not attach the image:', err);
  }

  console.log(`[listing-upload] ${user.email} added a photo to listing ${id}`);
  return json({ ok: true, src, size: body.byteLength });
}

export function onRequest({ request }) {
  if (request.method === 'POST') return onRequestPost(...arguments);
  return methodNotAllowed('POST');
}
