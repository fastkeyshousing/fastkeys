/* /api/panel/document
 *
 *   POST   ?reference=FK-...&filename=...&kind=...   raw body is the file
 *   GET    ?id=...                                   streams it back
 *   GET    ?reference=FK-...                         lists what is held
 *   DELETE ?id=...                                   removes object and row
 *
 * Owner only, all of it. Staff can run the pipeline; identity documents are a
 * different question and the answer is no.
 *
 * The bucket is private and has no public URL. Every read comes through here,
 * after the session is checked, which is the only reason it is safe to put
 * passports in object storage at all: a bucket with a public r2.dev address is
 * a filing cabinet on the pavement.
 */

import { json, fail, sameOrigin } from '../../../lib/http.js';
import { currentUser } from '../../../lib/admin-auth.js';

const REF_RE = /^(FK|FV)-[A-Z0-9]{5}-[A-Z0-9]{3}$/;
const MAX_BYTES = 15 * 1024 * 1024;

/* An allowlist, not a blocklist. The point is not that .exe is dangerous, it is
 * that nothing outside this list has any business being an applicant document,
 * and a stored file with an unexpected type is a file somebody may later open. */
const ALLOWED = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const KINDS = ['passport', 'enrolment', 'payslip', 'contract', 'bank', 'guarantor', 'other'];

/* Strips directory parts and anything that is not plainly a filename. What
 * reaches R2 is prefixed with a uuid anyway, so this is about what gets shown
 * and what lands in a Content-Disposition header. */
function safeName(raw) {
  const base = String(raw || 'document').split(/[\\/]/).pop();
  const cleaned = base
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'document';
}

async function requireOwner(request, env) {
  const user = await currentUser(request, env);
  if (!user) return { error: fail(401, 'not_signed_in') };
  if (user.role !== 'owner') return { error: fail(403, 'not_permitted') };
  return { user };
}

export async function onRequestPost({ request, env }) {
  const siteUrl = (env.SITE_URL || 'https://fastkeyshousing.com').replace(/\/$/, '');
  if (!env.DB) return fail(503, 'not_configured', 'D1 binding DB is not bound');
  if (!env.DOCS) return fail(503, 'not_configured', 'R2 binding DOCS is not bound');
  if (!sameOrigin(request, siteUrl)) return fail(403, 'bad_origin');

  const { user, error } = await requireOwner(request, env);
  if (error) return error;

  const url = new URL(request.url);
  const reference = String(url.searchParams.get('reference') || '').toUpperCase();
  if (!REF_RE.test(reference)) return fail(422, 'bad_reference');

  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim();
  if (!ALLOWED[contentType]) return fail(415, 'unsupported_type');

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) return fail(413, 'too_large');

  const filename = safeName(url.searchParams.get('filename'));
  const kind = KINDS.includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'other';

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return fail(422, 'empty_file');
  /* Checked again after reading: content-length is a claim, byteLength is a fact. */
  if (body.byteLength > MAX_BYTES) return fail(413, 'too_large');

  const digest = await crypto.subtle.digest('SHA-256', body);
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const id = crypto.randomUUID();
  const key = `documents/${reference}/${id}-${filename}`;

  try {
    await env.DOCS.put(key, body, {
      httpMetadata: {
        contentType,
        /* If the object is ever fetched directly it should download, not render.
         * An inline HTML-ish file served from a bucket is how stored XSS happens. */
        contentDisposition: `attachment; filename="${filename}"`,
      },
      customMetadata: { reference, uploadedBy: user.email, kind },
    });
  } catch (err) {
    return fail(502, 'storage_failed', String(err));
  }

  try {
    await env.DB.prepare(
      `INSERT INTO documents
         (id, reference, r2_key, filename, content_type, size_bytes, sha256, kind, uploaded_by, uploaded_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`
    ).bind(id, reference, key, filename, contentType, body.byteLength, sha256, kind,
           user.email, new Date().toISOString()).run();
  } catch (err) {
    /* The row is what makes the object findable, so an orphan in the bucket is
     * worse than no upload at all. */
    await env.DOCS.delete(key).catch(() => {});
    return fail(500, 'index_failed', String(err));
  }

  console.log(`[docs] ${user.email} uploaded ${filename} (${body.byteLength} bytes) for ${reference}`);
  return json({ ok: true, id, filename, size: body.byteLength, kind });
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return fail(503, 'not_configured');
  const { user, error } = await requireOwner(request, env);
  if (error) return error;

  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (id) {
    if (!env.DOCS) return fail(503, 'not_configured', 'R2 binding DOCS is not bound');
    if (!/^[0-9a-f-]{36}$/.test(id)) return fail(422, 'bad_id');

    const row = await env.DB.prepare(
      `SELECT r2_key, filename, content_type FROM documents WHERE id = ?1 AND deleted_at IS NULL`
    ).bind(id).first();
    if (!row) return fail(404, 'not_found');

    const object = await env.DOCS.get(row.r2_key);
    if (!object) return fail(404, 'not_found');

    console.log(`[docs] ${user.email} opened ${row.filename}`);
    const inline = url.searchParams.get('inline') === '1'
      && ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(row.content_type);

    return new Response(object.body, {
      headers: {
        'content-type': row.content_type,
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${row.filename.replace(/["\\]/g, '')}"`,
        'cache-control': 'no-store, private',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  }

  const reference = String(url.searchParams.get('reference') || '').toUpperCase();
  if (!REF_RE.test(reference)) return fail(422, 'bad_reference');

  const rows = await env.DB.prepare(
    `SELECT id, filename, content_type, size_bytes, kind, uploaded_by, uploaded_at
       FROM documents WHERE reference = ?1 AND deleted_at IS NULL
      ORDER BY uploaded_at DESC`
  ).bind(reference).all();

  return json({ files: rows.results ?? [] });
}

export async function onRequestDelete({ request, env }) {
  const siteUrl = (env.SITE_URL || 'https://fastkeyshousing.com').replace(/\/$/, '');
  if (!env.DB || !env.DOCS) return fail(503, 'not_configured');
  if (!sameOrigin(request, siteUrl)) return fail(403, 'bad_origin');
  const { user, error } = await requireOwner(request, env);
  if (error) return error;

  const id = new URL(request.url).searchParams.get('id');
  if (!/^[0-9a-f-]{36}$/.test(id || '')) return fail(422, 'bad_id');

  const row = await env.DB.prepare(
    `SELECT r2_key, filename FROM documents WHERE id = ?1`
  ).bind(id).first();
  if (!row) return fail(404, 'not_found');

  /* The object goes first. A row without an object is a broken link; an object
   * without a row is a passport nobody knows is there, which is worse. */
  await env.DOCS.delete(row.r2_key).catch((err) => console.error('[docs] R2 delete failed:', err));
  await env.DB.prepare(`DELETE FROM documents WHERE id = ?1`).bind(id).run();

  console.log(`[docs] ${user.email} deleted ${row.filename}`);
  return json({ ok: true });
}
