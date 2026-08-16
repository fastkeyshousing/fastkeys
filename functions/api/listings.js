/* GET /api/listings          published listings, for the public page
 * GET /api/listings?slug=x   one listing
 *
 * Public and unauthenticated, so it returns only what a stranger may see and
 * only rows that are actually published. Draft and taken listings never leave
 * the database through this route.
 */

import { json, fail, methodNotAllowed } from '../../lib/http.js';

const SLUG_RE = /^[a-z0-9-]{3,80}$/;

function publicView(row) {
  let images = [];
  try { images = JSON.parse(row.images || '[]'); } catch { /* leave empty */ }
  return {
    slug: row.slug,
    title: row.title,
    address: row.address,
    city: row.city,
    rent: row.rent,
    deposit: row.deposit,
    available_from: row.available_from,
    size: row.size,
    rooms: row.rooms,
    furnished: row.furnished,
    registration: row.registration,
    description: row.description,
    images,
    submitted_by: row.submitted_by,
    /* Contact details and the lister's own link are held in the database but
     * deliberately not returned here. Enquiries come to FastKeys, who is acting
     * on the searcher's instruction, and the details are visible only in the
     * panel. Anything added to this object is public, so add carefully. */
    published_at: row.published_at,
  };
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return fail(503, 'not_configured', 'D1 binding DB is not bound');
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');

  if (slug) {
    if (!SLUG_RE.test(slug)) return fail(422, 'bad_slug');
    const row = await env.DB.prepare(
      `SELECT * FROM listings WHERE slug = ?1 AND status = 'published'`
    ).bind(slug).first();
    if (!row) return fail(404, 'not_found');
    return json({ listing: publicView(row) });
  }

  const city = (url.searchParams.get('city') || '').slice(0, 60);
  const rows = await env.DB.prepare(
    `SELECT * FROM listings
      WHERE status = 'published'
        ${city ? 'AND lower(city) = lower(?1)' : ''}
      ORDER BY published_at DESC LIMIT 120`
  ).bind(...(city ? [city] : [])).all();

  return json({ listings: (rows.results ?? []).map(publicView) });
}

export function onRequest({ request }) {
  if (request.method === 'GET' || request.method === 'HEAD') return onRequestGet(...arguments);
  return methodNotAllowed('GET');
}
