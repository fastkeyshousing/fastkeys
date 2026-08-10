/* /api/panel/<route>
 *
 * Everything the hosted panel reads or changes. Every route requires a valid
 * session; the owner-only ones check the role again here rather than trusting
 * that the interface hid the button, because hiding a button is a courtesy to
 * the user and not a control on anybody determined.
 *
 * What is deliberately absent: identity documents. Those live on one machine and
 * are reachable only from the local tool. A hosted panel could not read them
 * even if it wanted to, and that is the point rather than a limitation.
 */

import { json, fail, sameOrigin, methodNotAllowed } from '../../../lib/http.js';
import { currentUser } from '../../../lib/admin-auth.js';
import { retrieveCheckoutSession } from '../../../lib/stripe.js';

const REF_RE = /^FK-[A-Z0-9]{5}-[A-Z0-9]{3}$/;
const VREF_RE = /^FV-[A-Z0-9]{5}-[A-Z0-9]{3}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const STATUSES = ['pending', 'paid', 'expired', 'failed'];

/* Staff read the pipeline and handle documents. Anything that changes a record,
 * creates one, or removes one stays with the owner: a viewing schedule is
 * day-to-day work, an applicant's income figure is not. */
const OWNER_ONLY = new Set(['update', 'remove', 'create', 'updateEmail', 'reconcile']);

const esc = (s) => String(s).replace(/'/g, "''");

const EDITABLE = [
  'name', 'email', 'phone', 'city', 'employment', 'role', 'organisation',
  'income', 'budget', 'savings', 'guarantor_income', 'months_in_advance',
  'household', 'available_from', 'duration', 'hobbies', 'notes',
];

const routes = {
  async list(env, { q, status }) {
    const where = [];
    if (status && status !== 'all') where.push(`status = '${esc(status)}'`);
    if (q) {
      const term = esc(String(q).toLowerCase().slice(0, 80));
      where.push(
        `(lower(reference) LIKE '%${term}%' OR lower(name) LIKE '%${term}%' OR lower(email) LIKE '%${term}%')`
      );
    }
    const rows = await env.DB.prepare(
      `SELECT reference, status, name, email, amount_total, currency, created_at,
              paid_at, notified_at, applicant_emailed_at
         FROM applications
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 300`
    ).all();
    const counts = await env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM applications GROUP BY status`
    ).all();
    return { rows: rows.results ?? [], counts: counts.results ?? [] };
  },

  async viewings(env, { q, status }) {
    const where = [];
    if (status && status !== 'all') where.push(`status = '${esc(status)}'`);
    if (q) {
      const term = esc(String(q).toLowerCase().slice(0, 80));
      where.push(
        `(lower(reference) LIKE '%${term}%' OR lower(name) LIKE '%${term}%' ` +
        `OR lower(email) LIKE '%${term}%' OR lower(property_address) LIKE '%${term}%')`
      );
    }
    const rows = await env.DB.prepare(
      `SELECT reference, service, status, name, email, phone, property_address,
              property_url, attendance, application_reference, amount_total, currency,
              created_at, paid_at, scheduled_for, attended_at
         FROM viewings
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 300`
    ).all();
    const counts = await env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM viewings GROUP BY status`
    ).all();
    return { rows: rows.results ?? [], counts: counts.results ?? [] };
  },

  async detail(env, { reference }) {
    if (!REF_RE.test(reference || '')) throw new Error('Not a valid reference');
    const row = await env.DB.prepare(
      `SELECT * FROM applications WHERE reference = ?1`
    ).bind(reference).first();
    if (!row) throw new Error('No application with that reference');
    let application = {};
    try { application = JSON.parse(row.payload); } catch { /* show the row anyway */ }
    delete row.payload;
    delete row.ip_hash;
    return { row, application };
  },

  /* Scheduling is the one write staff need, so it is not owner-only. */
  async viewingUpdate(env, { reference, scheduled_for, attended_at, status }) {
    if (!VREF_RE.test(reference || '')) throw new Error('Not a valid viewing reference');
    const sets = [];
    if (scheduled_for !== undefined) {
      sets.push(scheduled_for ? `scheduled_for = '${esc(String(scheduled_for).slice(0, 120))}'` : 'scheduled_for = NULL');
    }
    if (attended_at !== undefined) {
      sets.push(attended_at ? `attended_at = '${esc(String(attended_at).slice(0, 60))}'` : 'attended_at = NULL');
    }
    if (status) {
      if (!['pending', 'paid', 'expired', 'failed', 'refunded'].includes(status)) {
        throw new Error('Not a valid status');
      }
      sets.push(`status = '${esc(status)}'`);
    }
    if (!sets.length) throw new Error('Nothing to change');
    await env.DB.prepare(
      `UPDATE viewings SET ${sets.join(', ')} WHERE reference = ?1`
    ).bind(reference).run();
    return { ok: true };
  },

  async update(env, { reference, fields, status }) {
    if (!REF_RE.test(reference || '')) throw new Error('Not a valid reference');
    const row = await env.DB.prepare(
      `SELECT payload, status FROM applications WHERE reference = ?1`
    ).bind(reference).first();
    if (!row) throw new Error('No application with that reference');

    let payload;
    try { payload = JSON.parse(row.payload); } catch { throw new Error('Stored application unreadable'); }

    const changed = [];
    for (const [k, v] of Object.entries(fields || {})) {
      if (!EDITABLE.includes(k)) continue;
      if (k === 'email' && v && !EMAIL_RE.test(v)) throw new Error('That does not look like an email address');
      if (String(payload[k] ?? '') !== String(v ?? '')) changed.push(k);
      payload[k] = v;
    }

    const sets = [`payload = '${esc(JSON.stringify(payload))}'`];
    if (payload.name) sets.push(`name = '${esc(payload.name)}'`);
    if (payload.email) sets.push(`email = '${esc(payload.email)}'`);
    if (status && status !== row.status) {
      if (!STATUSES.includes(status)) throw new Error('Not a valid status');
      sets.push(`status = '${esc(status)}'`);
      if (status === 'paid') sets.push(`paid_at = COALESCE(paid_at, '${new Date().toISOString()}')`);
      changed.push('status');
    }
    await env.DB.prepare(`UPDATE applications SET ${sets.join(', ')} WHERE reference = ?1`)
      .bind(reference).run();
    return { ok: true, changed };
  },

  /* A record entered by hand: paid by transfer, taken over the phone, or
   * predating this system. */
  async create(env, params) {
    const name = String(params.name || '').trim().slice(0, 120);
    const email = String(params.email || '').trim().toLowerCase().slice(0, 254);
    if (name.length < 2) throw new Error('A name is required');
    if (!EMAIL_RE.test(email)) throw new Error('A valid email is required');
    const status = STATUSES.includes(params.status) ? params.status : 'pending';

    const application = { name, email };
    for (const f of EDITABLE) {
      if (params[f] !== undefined && params[f] !== '') application[f] = String(params[f]).slice(0, 600);
    }
    application.name = name;
    application.email = email;

    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
    const reference = `FK-${chars.slice(0, 5).join('')}-${chars.slice(5, 8).join('')}`;
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO applications (id, reference, status, name, email, payload, letter, created_at, paid_at)
       VALUES (?1,?2,?3,?4,?5,?6,'',?7,?8)`
    ).bind(crypto.randomUUID(), reference, status, name, email,
           JSON.stringify(application), now, status === 'paid' ? now : null).run();

    return { ok: true, reference };
  },

  /* Checks every pending row against Stripe and settles the ones that paid. The
   * only thing in the system that looks backwards rather than reacting to an
   * event, which is why a webhook that missed leaves a row stuck without it. */
  async reconcile(env) {
    if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
    const rows = await env.DB.prepare(
      `SELECT reference, stripe_session_id FROM applications
        WHERE status = 'pending' AND stripe_session_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 60`
    ).all();

    const settled = [], stillUnpaid = [], errors = [];
    for (const row of rows.results ?? []) {
      try {
        const s = await retrieveCheckoutSession(env, row.stripe_session_id);
        if (s.payment_status === 'paid') {
          await env.DB.prepare(
            `UPDATE applications
                SET status='paid', paid_at=COALESCE(paid_at, ?1),
                    amount_total=?2, currency=?3
              WHERE reference=?4`
          ).bind(new Date().toISOString(), s.amount_total ?? null,
                 s.currency ?? null, row.reference).run();
          settled.push(row.reference);
        } else if (s.status === 'expired') {
          await env.DB.prepare(`UPDATE applications SET status='expired' WHERE reference=?1`)
            .bind(row.reference).run();
          stillUnpaid.push(row.reference);
        } else {
          stillUnpaid.push(row.reference);
        }
      } catch (err) {
        errors.push(row.reference);
        console.error('[reconcile]', row.reference, err);
      }
    }
    return { checked: (rows.results ?? []).length, settled, stillUnpaid, errors };
  },

  async remove(env, { reference, confirm }) {
    if (!REF_RE.test(reference || '')) throw new Error('Not a valid reference');
    if (confirm !== reference) throw new Error('Type the reference exactly to confirm');
    await env.DB.prepare(`DELETE FROM applications WHERE reference = ?1`).bind(reference).run();
    return { ok: true, deleted: reference };
  },
};

async function handle(context) {
  const { request, env, params } = context;
  const siteUrl = (env.SITE_URL || 'https://fastkeyshousing.com').replace(/\/$/, '');
  if (!env.DB) return fail(503, 'not_configured', 'D1 binding DB is not bound');

  const user = await currentUser(request, env);
  if (!user) return fail(401, 'not_signed_in');

  const name = params.route;
  const route = routes[name];
  if (!route) return fail(404, 'no_such_route');

  if (request.method === 'POST') {
    if (!sameOrigin(request, siteUrl)) {
      return fail(403, 'bad_origin', request.headers.get('origin') || '(none)');
    }
    if (OWNER_ONLY.has(name) && user.role !== 'owner') {
      return fail(403, 'not_permitted');
    }
  }

  let args = Object.fromEntries(new URL(request.url).searchParams);
  if (request.method === 'POST') {
    try {
      args = { ...args, ...(await request.json()) };
    } catch {
      return fail(400, 'bad_json');
    }
    console.log(`[panel] ${user.email} (${user.role}) -> ${name}`);
  }

  try {
    return json(await route(env, args, user));
  } catch (err) {
    return fail(400, err.message);
  }
}

export const onRequestGet = handle;
export const onRequestPost = handle;
export function onRequest({ request }) {
  if (request.method === 'GET' || request.method === 'POST') return handle(...arguments);
  return methodNotAllowed('GET, POST');
}
