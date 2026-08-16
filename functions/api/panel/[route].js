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
import { reminderEmail } from '../../../lib/reminder-email.js';
import { applicantEmail } from '../../../lib/applicant-email.js';
import { propertyEmail, safeUrl } from '../../../lib/property-email.js';
import { sendAndLog } from '../../../lib/send-log.js';
import { customEmail } from '../../../lib/custom-email.js';

const REF_RE = /^FK-[A-Z0-9]{5}-[A-Z0-9]{3}$/;
const VREF_RE = /^FV-[A-Z0-9]{5}-[A-Z0-9]{3}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const STATUSES = ['pending', 'paid', 'expired', 'failed'];

/* Staff read the pipeline and handle documents. Anything that changes a record,
 * creates one, or removes one stays with the owner: a viewing schedule is
 * day-to-day work, an applicant's income figure is not. */
const OWNER_ONLY = new Set(['update', 'remove', 'create', 'updateEmail', 'reconcile',
  /* Publishing to the public site is an owner decision: a listing that names a
   * landlord is the one artefact on this site with legal consequences. */
  'listingSave', 'listingDelete']);
const EMAIL_KINDS = ['confirmation', 'receipt', 'reminder', 'property', 'custom'];

const esc = (s) => String(s).replace(/'/g, "''");

const EDITABLE = [
  'name', 'email', 'phone', 'city', 'employment', 'role', 'organisation',
  'income', 'budget', 'savings', 'guarantor_income', 'months_in_advance',
  'household', 'available_from', 'duration', 'hobbies', 'notes',
];

const routes = {
  async list(env, { q, status, sort, closed, docs, budgetMin, budgetMax }) {
    const where = [];
    if (status && status !== 'all') where.push(`a.status = '${esc(status)}'`);
    if (q) {
      const term = esc(String(q).toLowerCase().slice(0, 80));
      where.push(
        `(lower(a.reference) LIKE '%${term}%' OR lower(a.name) LIKE '%${term}%' OR lower(a.email) LIKE '%${term}%')`
      );
    }
    /* Closed cases are shown by default and dimmed, rather than hidden: they are
     * still the record of somebody we placed, and hiding them by default is how
     * you lose track of your own successes. */
    if (closed === 'open') where.push(`a.case_closed_at IS NULL`);
    if (closed === 'closed') where.push(`a.case_closed_at IS NOT NULL`);
    if (docs === 'yes') where.push(`EXISTS (SELECT 1 FROM documents d WHERE d.reference = a.reference AND d.deleted_at IS NULL)`);
    if (docs === 'no') where.push(`NOT EXISTS (SELECT 1 FROM documents d WHERE d.reference = a.reference AND d.deleted_at IS NULL)`);

    /* Budget lives inside the JSON payload, so it is pulled out with
     * json_extract and compared as a number. Rows with no budget are excluded
     * from a budget filter rather than treated as zero. */
    const bmin = Number(budgetMin);
    const bmax = Number(budgetMax);
    if (Number.isFinite(bmin) && bmin > 0) {
      where.push(`CAST(COALESCE(json_extract(a.payload,'$.budget'),0) AS REAL) >= ${bmin}`);
    }
    if (Number.isFinite(bmax) && bmax > 0) {
      where.push(`CAST(COALESCE(json_extract(a.payload,'$.budget'),0) AS REAL) <= ${bmax}`);
      where.push(`json_extract(a.payload,'$.budget') IS NOT NULL`);
    }

    const ORDERS = {
      recent: 'COALESCE(a.paid_at, a.created_at) DESC',
      oldest: 'COALESCE(a.paid_at, a.created_at) ASC',
      name: 'lower(a.name) ASC',
      nameDesc: 'lower(a.name) DESC',
      budget: "CAST(COALESCE(json_extract(a.payload,'$.budget'),0) AS REAL) DESC",
      budgetAsc: "CAST(COALESCE(json_extract(a.payload,'$.budget'),0) AS REAL) ASC",
    };
    const order = ORDERS[sort] || ORDERS.recent;

    const rows = await env.DB.prepare(
      `SELECT a.reference, a.status, a.name, a.email, a.amount_total, a.currency,
              a.created_at, a.paid_at, a.notified_at, a.applicant_emailed_at,
              a.reminder_sent_at, a.reminder_count, a.case_closed_at, a.case_note,
              json_extract(a.payload,'$.budget') AS budget,
              json_extract(a.payload,'$.city')   AS city,
              (SELECT COUNT(*) FROM documents d WHERE d.reference = a.reference AND d.deleted_at IS NULL) AS doc_count
         FROM applications a
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY ${order} LIMIT 300`
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
              created_at, paid_at, scheduled_for, attended_at,
              reminder_sent_at, reminder_count
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
    const docs = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM documents WHERE reference = ?1 AND deleted_at IS NULL`
    ).bind(reference).first().catch(() => ({ n: 0 }));
    row.doc_count = docs?.n ?? 0;
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

  /* Nudges somebody whose payment did not complete. Open to staff: chasing a
   * failed payment is ordinary follow-up work, and it sends a fixed template to
   * an address already on file, so there is no way to use it to write arbitrary
   * mail to an arbitrary person.
   *
   * Never sent to a paid record. That would tell somebody who has paid that they
   * have not, which is the single worst thing this button could do. */
  async remind(env, { reference, force }, user) {
    const isViewing = VREF_RE.test(reference || '');
    if (!isViewing && !REF_RE.test(reference || '')) throw new Error('Not a valid reference');
    if (!env.RESEND_API_KEY || !env.NOTIFY_FROM) {
      throw new Error('Email is not configured on this deployment');
    }

    const table = isViewing ? 'viewings' : 'applications';
    const row = await env.DB.prepare(
      `SELECT reference, email, payload, status, stripe_session_id,
              reminder_count, reminder_sent_at
         FROM ${table} WHERE reference = ?1`
    ).bind(reference).first();
    if (!row) throw new Error('No record with that reference');

    if (row.status === 'paid') throw new Error('This one is paid. Do not chase it.');
    if (!['pending', 'failed', 'expired'].includes(row.status)) {
      throw new Error(`Nothing to chase: this is "${row.status}"`);
    }

    /* Two is the ceiling. One nudge is a service, a second is a fair reminder,
     * and beyond that we are pestering somebody who has told us no by silence. */
    const already = row.reminder_count ?? 0;
    if (already >= 2) throw new Error('Two reminders have already gone out. Leave it there.');
    if (already >= 1 && !force) {
      throw new Error(`Already reminded once on ${String(row.reminder_sent_at || '').slice(0, 10)}. Send again?`);
    }

    let payload = {};
    try { payload = JSON.parse(row.payload); } catch { /* fall back to columns */ }
    if (!payload.email) payload.email = row.email;
    if (!payload.name) payload.name = row.name;

    const site = (env.SITE_URL || 'https://fastkeyshousing.com').replace(/\/$/, '');
    const support = env.NOTIFY_EMAIL || 'hello@fastkeyshousing.com';
    /* Applications can resume against the stored record; a viewing has no retry
     * endpoint, so it goes back to the short booking form. */
    const resumeUrl = isViewing
      ? `${site}/book-viewing`
      : (row.stripe_session_id
          ? `${site}/payment-failed?session_id=${encodeURIComponent(row.stripe_session_id)}`
          : `${site}/apply`);

    const { subject, html, text } = reminderEmail({
      application: payload, reference: row.reference, resumeUrl,
      siteUrl: site, supportEmail: support, kind: isViewing ? 'viewing' : 'application',
    });

    await sendAndLog(env, {
      reference: row.reference, kind: 'reminder', to: payload.email,
      subject, html, text, sentBy: user.email,
      meta: { attempt: already + 1, status: row.status },
      /* Keyed on the attempt number, so a double click cannot send twice but a
       * deliberate second reminder still can. */
      idempotencyKey: `reminder-${row.reference}-${already + 1}`,
    });

    await env.DB.prepare(
      `UPDATE ${table}
          SET reminder_sent_at = ?1, reminder_count = ?2, reminder_sent_by = ?3
        WHERE reference = ?4`
    ).bind(new Date().toISOString(), already + 1, user.email, row.reference).run();

    console.log(`[remind] ${user.email} chased ${row.reference} (attempt ${already + 1})`);
    return { ok: true, sentTo: payload.email, attempt: already + 1 };
  },

  /* Everything on one applicant's email history, plus the case flag, for the
   * mail view. Deliberately thin on personal detail: this screen is about what
   * was sent and when, not about their income. */
  async emails(env, { q, kind, unsent }) {
    const where = [];
    if (q) {
      const term = esc(String(q).toLowerCase().slice(0, 80));
      where.push(`(lower(a.reference) LIKE '%${term}%' OR lower(a.name) LIKE '%${term}%' OR lower(a.email) LIKE '%${term}%')`);
    }
    if (unsent === 'confirmation') where.push(`a.applicant_emailed_at IS NULL AND a.status = 'paid'`);
    if (unsent === 'reminder') where.push(`a.reminder_count = 0 AND a.status <> 'paid'`);

    const rows = await env.DB.prepare(
      `SELECT a.reference, a.name, a.email, a.status, a.created_at, a.paid_at,
              a.applicant_emailed_at, a.reminder_sent_at, a.reminder_count,
              a.receipt_url, a.case_closed_at,
              (SELECT COUNT(*) FROM email_log e WHERE e.reference = a.reference AND e.status='sent') AS sent_count,
              (SELECT COUNT(*) FROM email_log e WHERE e.reference = a.reference AND e.status='failed') AS failed_count,
              (SELECT MAX(sent_at) FROM email_log e WHERE e.reference = a.reference) AS last_email_at
         FROM applications a
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY COALESCE(a.paid_at, a.created_at) DESC LIMIT 300`
    ).all();
    return { rows: rows.results ?? [] };
  },

  /* The full send history for one reference. */
  async emailLog(env, { reference }) {
    if (!REF_RE.test(reference || '') && !VREF_RE.test(reference || '')) {
      throw new Error('Not a valid reference');
    }
    const rows = await env.DB.prepare(
      `SELECT kind, subject, recipient, sent_by, sent_at, status, error, meta
         FROM email_log WHERE reference = ?1 ORDER BY sent_at DESC LIMIT 100`
    ).bind(reference).all();
    return { rows: rows.results ?? [] };
  },

  /* Resends the confirmation, which doubles as the receipt: it carries the
   * Stripe receipt link and the details on file. */
  async sendConfirmation(env, { reference }, user) {
    if (!REF_RE.test(reference || '')) throw new Error('Not a valid reference');
    const row = await env.DB.prepare(
      `SELECT reference, email, payload, receipt_url, status FROM applications WHERE reference = ?1`
    ).bind(reference).first();
    if (!row) throw new Error('No application with that reference');
    if (row.status !== 'paid') throw new Error(`This one is "${row.status}", not paid`);

    const application = JSON.parse(row.payload);
    if (!application.email) application.email = row.email;
    const site = (env.SITE_URL || 'https://fastkeyshousing.com').replace(/\/$/, '');
    const support = env.NOTIFY_EMAIL || 'hello@fastkeyshousing.com';
    const { subject, html, text } = applicantEmail({
      reference: row.reference, application, receiptUrl: row.receipt_url || null,
      siteUrl: site, supportEmail: support,
    });

    await sendAndLog(env, {
      reference: row.reference, kind: 'confirmation', to: application.email,
      subject, html, text, sentBy: user.email,
      meta: { receipt: !!row.receipt_url },
    });

    await env.DB.prepare(`UPDATE applications SET applicant_emailed_at = ?1 WHERE reference = ?2`)
      .bind(new Date().toISOString(), row.reference).run();
    return { ok: true, sentTo: application.email };
  },

  /* A specific property, put in front of one applicant. */
  async sendProperty(env, params, user) {
    const reference = String(params.reference || '');
    if (!REF_RE.test(reference)) throw new Error('Not a valid reference');
    const row = await env.DB.prepare(
      `SELECT reference, name, email, payload FROM applications WHERE reference = ?1`
    ).bind(reference).first();
    if (!row) throw new Error('No application with that reference');

    let application = {};
    try { application = JSON.parse(row.payload); } catch { /* columns will do */ }
    const to = application.email || row.email;

    const images = (Array.isArray(params.images) ? params.images : String(params.images || '').split(/\s+/))
      .map(safeUrl).filter(Boolean).slice(0, 30);

    if (!params.address && !params.headline) throw new Error('Give it an address or a headline');

    const site = (env.SITE_URL || 'https://fastkeyshousing.com').replace(/\/$/, '');
    const { subject, html, text } = propertyEmail({
      recipientName: application.name || row.name,
      reference: row.reference,
      headline: String(params.headline || '').slice(0, 160),
      intro: String(params.intro || '').slice(0, 2000),
      images, listingUrl: params.listing_url,
      address: String(params.address || '').slice(0, 200),
      rent: String(params.rent || '').slice(0, 60),
      deposit: String(params.deposit || '').slice(0, 60),
      available: String(params.available || '').slice(0, 60),
      size: String(params.size || '').slice(0, 60),
      rooms: String(params.rooms || '').slice(0, 60),
      furnished: String(params.furnished || '').slice(0, 60),
      registration: String(params.registration || '').slice(0, 60),
      bodyText: String(params.body || '').slice(0, 4000),
      siteUrl: site, supportEmail: env.NOTIFY_EMAIL || 'hello@fastkeyshousing.com',
    });

    await sendAndLog(env, {
      reference: row.reference, kind: 'property', to, subject, html, text,
      sentBy: user.email,
      meta: { address: params.address || null, rent: params.rent || null, images: images.length },
    });
    return { ok: true, sentTo: to, subject };
  },

  /* Marks a case closed, or reopens it. A toggle, so a mistake costs one click. */
  async caseToggle(env, { reference, closed, note }, user) {
    if (!REF_RE.test(reference || '')) throw new Error('Not a valid reference');
    if (closed) {
      await env.DB.prepare(
        `UPDATE applications SET case_closed_at = ?1, case_closed_by = ?2, case_note = ?3 WHERE reference = ?4`
      ).bind(new Date().toISOString(), user.email, String(note || '').slice(0, 400), reference).run();
    } else {
      await env.DB.prepare(
        `UPDATE applications SET case_closed_at = NULL, case_closed_by = NULL WHERE reference = ?1`
      ).bind(reference).run();
    }
    return { ok: true, closed: !!closed };
  },

  /* ------------------------------------------------------- property tracker */
  async properties(env, { reference, status, q }) {
    const where = [];
    if (reference) {
      if (!REF_RE.test(reference)) throw new Error('Not a valid reference');
      where.push(`p.reference = '${esc(reference)}'`);
    }
    if (status && status !== 'all') where.push(`p.status = '${esc(status)}'`);
    if (q) {
      const term = esc(String(q).toLowerCase().slice(0, 80));
      where.push(`(lower(p.address) LIKE '%${term}%' OR lower(p.landlord) LIKE '%${term}%' OR lower(a.name) LIKE '%${term}%')`);
    }
    const rows = await env.DB.prepare(
      `SELECT p.*, a.name AS client_name, a.email AS client_email
         FROM property_applications p
         LEFT JOIN applications a ON a.reference = p.reference
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY COALESCE(p.updated_at, p.created_at) DESC LIMIT 300`
    ).all();
    const counts = await env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM property_applications GROUP BY status`
    ).all();
    return { rows: rows.results ?? [], counts: counts.results ?? [] };
  },

  async propertySave(env, params, user) {
    const STATUSES_P = ['shortlisted','applied','viewing_booked','viewed','offered','accepted','rejected','withdrawn','gone'];
    const reference = String(params.reference || '');
    if (!REF_RE.test(reference)) throw new Error('Pick a client first');
    const address = String(params.address || '').trim().slice(0, 240);
    if (address.length < 4) throw new Error('An address is required');
    const status = STATUSES_P.includes(params.status) ? params.status : 'applied';

    const cols = {
      reference, address, status,
      listing_url: String(params.listing_url || '').slice(0, 500),
      rent: String(params.rent || '').slice(0, 60),
      deposit: String(params.deposit || '').slice(0, 60),
      available_from: String(params.available_from || '').slice(0, 60),
      landlord: String(params.landlord || '').slice(0, 160),
      landlord_email: String(params.landlord_email || '').slice(0, 254),
      landlord_phone: String(params.landlord_phone || '').slice(0, 40),
      applied_at: String(params.applied_at || '').slice(0, 40),
      viewing_at: String(params.viewing_at || '').slice(0, 40),
      decision_at: String(params.decision_at || '').slice(0, 40),
      outcome_note: String(params.outcome_note || '').slice(0, 600),
      notes: String(params.notes || '').slice(0, 2000),
    };
    const now = new Date().toISOString();

    if (params.id) {
      if (!/^[0-9a-f-]{36}$/.test(params.id)) throw new Error('Bad id');
      const sets = Object.entries(cols).map(([k, v]) => `${k} = '${esc(v)}'`).join(', ');
      await env.DB.prepare(
        `UPDATE property_applications SET ${sets}, updated_at = ?1 WHERE id = ?2`
      ).bind(now, params.id).run();
      return { ok: true, id: params.id };
    }

    const id = crypto.randomUUID();
    const keys = Object.keys(cols);
    await env.DB.prepare(
      `INSERT INTO property_applications (id, ${keys.join(', ')}, created_at, created_by, updated_at)
       VALUES (?1, ${keys.map((_, i) => `?${i + 2}`).join(', ')}, ?${keys.length + 2}, ?${keys.length + 3}, ?${keys.length + 4})`
    ).bind(id, ...keys.map((k) => cols[k]), now, user.email, now).run();
    return { ok: true, id };
  },

  async propertyDelete(env, { id }, user) {
    if (!/^[0-9a-f-]{36}$/.test(id || '')) throw new Error('Bad id');
    await env.DB.prepare(`DELETE FROM property_applications WHERE id = ?1`).bind(id).run();
    console.log(`[tracker] ${user.email} removed property application ${id}`);
    return { ok: true };
  },

  /* A branded email to anybody, with files from our own bucket attached. The
   * recipient may be a client or a typed address, because the common case is
   * forwarding somebody's paperwork to a landlord. */
  async sendCustom(env, params, user) {
    const to = String(params.to || '').trim().toLowerCase();
    if (!EMAIL_RE.test(to)) throw new Error('That recipient address does not look right');
    const heading = String(params.heading || '').slice(0, 160);
    const body = String(params.body || '');
    if (body.trim().length < 5) throw new Error('Write something in the body');

    /* Attachments are chosen from documents we already hold, by id, rather than
     * uploaded here. That keeps one storage path and one deletion path, and
     * means nothing can be attached that was not already vetted on upload. */
    const ids = (Array.isArray(params.attachmentIds) ? params.attachmentIds : [])
      .filter((i) => /^[0-9a-f-]{36}$/.test(i)).slice(0, 5);

    const attachments = [];
    if (ids.length) {
      if (!env.DOCS) throw new Error('Document storage is not configured');
      for (const id of ids) {
        const doc = await env.DB.prepare(
          `SELECT r2_key, filename FROM documents WHERE id = ?1 AND deleted_at IS NULL`
        ).bind(id).first();
        if (!doc) continue;
        const object = await env.DOCS.get(doc.r2_key);
        if (!object) continue;
        const buf = await object.arrayBuffer();
        /* Resend caps a message at about 40MB; well under it is the sane place
         * to stop, and a large attachment is a deliverability problem anyway. */
        if (buf.byteLength > 8 * 1024 * 1024) {
          throw new Error(`${doc.filename} is too large to attach. Send a link instead.`);
        }
        let binary = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        attachments.push({ filename: doc.filename, content: btoa(binary) });
      }
    }

    const site = (env.SITE_URL || 'https://fastkeyshousing.com').replace(/\/$/, '');
    const { subject, html, text } = customEmail({
      heading, body, attachments,
      ctaLabel: String(params.ctaLabel || '').slice(0, 60),
      ctaUrl: params.ctaUrl,
      siteUrl: site, supportEmail: env.NOTIFY_EMAIL || 'hello@fastkeyshousing.com',
    });

    await sendAndLog(env, {
      reference: String(params.reference || 'ADHOC'), kind: 'custom', to,
      subject, html, text, sentBy: user.email, attachments,
      meta: { attachments: attachments.map((a) => a.filename), custom_recipient: !params.reference },
    });
    return { ok: true, sentTo: to, attached: attachments.length };
  },

  /* ------------------------------------------------------------- listings */
  async listings(env, { status, q }) {
    const where = [];
    if (status && status !== 'all') where.push(`status = '${esc(status)}'`);
    if (q) {
      const term = esc(String(q).toLowerCase().slice(0, 80));
      where.push(`(lower(title) LIKE '%${term}%' OR lower(address) LIKE '%${term}%' OR lower(contact_name) LIKE '%${term}%')`);
    }
    const rows = await env.DB.prepare(
      `SELECT * FROM listings ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY COALESCE(published_at, created_at) DESC LIMIT 200`
    ).all();
    const counts = await env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM listings GROUP BY status`
    ).all();
    return { rows: rows.results ?? [], counts: counts.results ?? [] };
  },

  async listingSave(env, params, user) {
    const L_STATUS = ['draft', 'published', 'taken', 'expired'];
    const title = String(params.title || '').trim().slice(0, 160);
    const address = String(params.address || '').trim().slice(0, 240);
    if (title.length < 4) throw new Error('Give it a title');
    if (address.length < 4) throw new Error('An address is required');

    /* Optional, and never published. Held for your own use: when a client says
     * yes you still need to reach whoever listed it, and keeping it here means
     * that is one click rather than a search through old email. */
    const contactEmail = String(params.contact_email || '').trim().toLowerCase();
    const contactPhone = String(params.contact_phone || '').trim();
    if (contactEmail && !EMAIL_RE.test(contactEmail)) throw new Error('That contact email does not look right');

    const status = L_STATUS.includes(params.status) ? params.status : 'draft';
    /* Uploaded photos are appended by the upload route, not by this form. If the
     * link textarea is empty on an edit, that means "no extra links", not
     * "delete the photos I just uploaded". */
    let images = (Array.isArray(params.images) ? params.images : [])
      .map((i) => String(i).trim()).filter(Boolean);
    /* replaceImages is set only by the remove-photo button, which sends the exact
     * list it wants kept. Everywhere else the uploaded photos are merged back in,
     * because an empty link textarea means "no extra links", not "delete them". */
    if (params.id && !params.replaceImages) {
      const existing = await env.DB.prepare(`SELECT images FROM listings WHERE id = ?1`)
        .bind(params.id).first();
      let uploaded = [];
      try { uploaded = JSON.parse(existing?.images || '[]'); } catch { uploaded = []; }
      const fromUpload = uploaded.filter((u) => String(u).startsWith('/api/listing-image'));
      images = [...fromUpload, ...images.filter((i) => !i.startsWith('/api/listing-image'))];
    }
    images = images.slice(0, 30);

    const slugFrom = (s) => String(s).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'listing';

    const cols = {
      title, address,
      city: String(params.city || 'Maastricht').slice(0, 60),
      rent: String(params.rent || '').slice(0, 60),
      deposit: String(params.deposit || '').slice(0, 60),
      available_from: String(params.available_from || '').slice(0, 60),
      size: String(params.size || '').slice(0, 60),
      rooms: String(params.rooms || '').slice(0, 60),
      furnished: String(params.furnished || '').slice(0, 60),
      registration: String(params.registration || '').slice(0, 60),
      description: String(params.description || '').slice(0, 4000),
      images: JSON.stringify(images),
      submitted_by: ['landlord', 'student', 'agency'].includes(params.submitted_by) ? params.submitted_by : 'landlord',
      contact_name: String(params.contact_name || '').slice(0, 160),
      contact_email: contactEmail,
      contact_phone: contactPhone.slice(0, 40),
      external_url: String(params.external_url || '').slice(0, 500),
      expires_at: String(params.expires_at || '').slice(0, 40),
      status,
    };
    const now = new Date().toISOString();

    if (params.id) {
      if (!/^[0-9a-f-]{36}$/.test(params.id)) throw new Error('Bad id');
      const sets = Object.entries(cols).map(([k, v]) => `${k} = '${esc(v)}'`).join(', ');
      await env.DB.prepare(
        `UPDATE listings SET ${sets}, updated_at = ?1,
            published_at = CASE WHEN '${status}' = 'published' AND published_at IS NULL THEN ?1 ELSE published_at END
          WHERE id = ?2`
      ).bind(now, params.id).run();
      return { ok: true, id: params.id };
    }

    /* A collision only happens when two listings share a title and a street, so
     * a short random tail is cheaper than a lookup loop. */
    const tail = Math.random().toString(36).slice(2, 6);
    const slug = `${slugFrom(title)}-${tail}`;
    const id = crypto.randomUUID();
    const keys = Object.keys(cols);
    await env.DB.prepare(
      `INSERT INTO listings (id, slug, ${keys.join(', ')}, published_at, created_at, created_by, updated_at)
       VALUES (?1, ?2, ${keys.map((_, i) => `?${i + 3}`).join(', ')}, ?${keys.length + 3}, ?${keys.length + 4}, ?${keys.length + 5}, ?${keys.length + 6})`
    ).bind(id, slug, ...keys.map((k) => cols[k]), status === 'published' ? now : null, now, user.email, now).run();
    return { ok: true, id, slug };
  },

  async listingDelete(env, { id }, user) {
    if (!/^[0-9a-f-]{36}$/.test(id || '')) throw new Error('Bad id');
    await env.DB.prepare(`DELETE FROM listings WHERE id = ?1`).bind(id).run();
    console.log(`[listings] ${user.email} deleted listing ${id}`);
    return { ok: true };
  },

  /* Sends a published listing to one client, reusing the branded property
   * email. The listing's own contact details go in the body, so the client
   * deals with the lister directly. */
  async shareListing(env, { id, reference }, user) {
    if (!/^[0-9a-f-]{36}$/.test(id || '')) throw new Error('Bad id');
    if (!REF_RE.test(reference || '')) throw new Error('Pick a client');

    const listing = await env.DB.prepare(`SELECT * FROM listings WHERE id = ?1`).bind(id).first();
    if (!listing) throw new Error('No such listing');
    if (listing.status !== 'published') throw new Error('Publish it before sharing it');

    const client = await env.DB.prepare(
      `SELECT reference, name, email, payload FROM applications WHERE reference = ?1`
    ).bind(reference).first();
    if (!client) throw new Error('No application with that reference');

    let application = {};
    try { application = JSON.parse(client.payload); } catch { /* columns will do */ }
    const to = application.email || client.email;

    let images = [];
    try { images = JSON.parse(listing.images || '[]'); } catch { /* none */ }

    const site = (env.SITE_URL || 'https://fastkeyshousing.com').replace(/\/$/, '');
    const contactLines = [
      listing.contact_name ? `Listed by: ${listing.contact_name}` : null,
      listing.contact_email ? `Their email: ${listing.contact_email}` : null,
      listing.contact_phone ? `Their phone: ${listing.contact_phone}` : null,
    ].filter(Boolean).join('\n');

    const { subject, html, text } = propertyEmail({
      recipientName: application.name || client.name,
      reference: client.reference,
      headline: listing.title,
      intro: 'This one is on our noticeboard. It was listed by the person below, and you can contact them directly. Tell us if you want us to apply on your behalf.',
      images, listingUrl: `${site}/listings/${listing.slug}`,
      address: listing.address, rent: listing.rent, deposit: listing.deposit,
      available: listing.available_from, size: listing.size, rooms: listing.rooms,
      furnished: listing.furnished, registration: listing.registration,
      bodyText: [listing.description, contactLines].filter(Boolean).join('\n\n'),
      siteUrl: site, supportEmail: env.NOTIFY_EMAIL || 'hello@fastkeyshousing.com',
    });

    await sendAndLog(env, {
      reference: client.reference, kind: 'property', to, subject, html, text,
      sentBy: user.email,
      meta: { listing: listing.slug, address: listing.address, from_noticeboard: true },
    });
    return { ok: true, sentTo: to };
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
