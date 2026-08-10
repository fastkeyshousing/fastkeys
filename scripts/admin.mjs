#!/usr/bin/env node
/* FastKeys admin — a local console over the production database.
 *
 *   npm run admin              # production data
 *   npm run admin -- --local   # your scratch database
 *
 * Deliberately local only. It binds to 127.0.0.1, so nothing outside this
 * machine can reach it, and it holds no credentials of its own: reads go through
 * the wrangler CLI you are already logged into, and sends reuse the Resend key
 * in .dev.vars.
 *
 * That matters because this window shows income, employer, guarantor and contact
 * details for every applicant. It is the most sensitive surface in the project
 * and it must never be deployed anywhere.
 *
 * A random token is minted at boot and required on every request. Binding to
 * localhost alone would not be enough: any website you visit can issue requests
 * to 127.0.0.1 in the background, and without the token one of them could read
 * this database through your own browser.
 */

import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, mkdirSync, createReadStream } from 'node:fs';
import { resolve, join, sep, extname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { applicantEmail } from '../lib/applicant-email.js';
import { reminderEmail } from '../lib/reminder-email.js';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const LOCAL = argv.includes('--local');
const PORT = Number(argv[argv.indexOf('--port') + 1]) || 8899;
const TOKEN = randomBytes(16).toString('hex');

const HTML = new URL('./admin-ui.html', import.meta.url);

/* Where applicants' documents live. Defaults to a sibling of the repository,
 * which is how the machine is laid out: .../files/website and .../files/documents.
 * Resolved from the repo rather than hard-coded so a different machine, or a
 * moved folder, only needs the flag.
 *
 * These files are the reason the panel is localhost only. Passports, payslips
 * and bank statements never touch Cloudflare, never enter the database, and
 * never leave this machine. */
const DOCS_ROOT = resolve(
  argv.includes('--docs') ? argv[argv.indexOf('--docs') + 1]
                          : new URL('../../documents', import.meta.url).pathname
);

/* ------------------------------------------------------------------ env --- */
function loadEnv() {
  try {
    const raw = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
    const env = {};
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const i = s.indexOf('=');
      if (i > 0) env[s.slice(0, i).trim()] = s.slice(i + 1).trim();
    }
    return env;
  } catch {
    return {};
  }
}
const env = loadEnv();

/* ------------------------------------------------------------------- d1 --- */
const esc = (s) => String(s).replace(/'/g, "''");

/* Calling the installed binary rather than `npx wrangler` cuts several seconds
 * off every query, because npx re-resolves the package on each invocation and
 * this UI queries on every keystroke. */
const WRANGLER = (() => {
  const local = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
  return existsSync(local) ? { cmd: local, pre: [] } : { cmd: 'npx', pre: ['wrangler'] };
})();

/* Returns one result set per statement, so several queries can share a single
 * process launch instead of paying the startup cost three times over. */
async function d1All(sql) {
  const args = [...WRANGLER.pre, 'd1', 'execute', 'fastkeys', LOCAL ? '--local' : '--remote',
    '--json', '--command', sql];
  let stdout;
  try {
    ({ stdout } = await run(WRANGLER.cmd, args, { maxBuffer: 64 * 1024 * 1024 }));
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
    throw new Error(detail || err.message);
  }
  const i = stdout.indexOf('[');
  if (i === -1) throw new Error(`Unexpected wrangler output:\n${stdout}`);
  return JSON.parse(stdout.slice(i)).map((r) => r.results ?? []);
}

async function d1(sql) {
  return (await d1All(sql))[0] ?? [];
}

const REF_RE = /^FK-[A-Z0-9]{5}-[A-Z0-9]{3}$/;
const VREF_RE = /^FV-[A-Z0-9]{5}-[A-Z0-9]{3}$/;
const STATUSES = ['pending', 'paid', 'expired', 'failed'];

/* Same alphabet and shape the live form uses, so a record created here is
 * indistinguishable from one that came through checkout. */
function makeReference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `FK-${chars.slice(0, 5).join('')}-${chars.slice(5, 8).join('')}`;
}

/* Fields of the stored application that may be edited by hand. Deliberately
 * excludes anything Stripe owns: amounts, session ids, customer ids and paid_at
 * are records of what actually happened with money, and letting them be typed
 * over would make the database disagree with the payment processor. */
const EDITABLE = [
  'name', 'email', 'phone', 'city', 'employment', 'role', 'organisation',
  'income', 'budget', 'savings', 'guarantor_income', 'months_in_advance',
  'household', 'available_from', 'duration', 'hobbies', 'notes',
];
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/* ---------------------------------------------------------------- routes --- */
/* Asks Stripe directly about a checkout session. The admin needs this because
 * nothing else in the system ever revisits a pending row: the webhook fires once
 * and the live status check only runs if the applicant loads the success page.
 * A payment that took money while both of those missed stays pending forever. */
async function stripeSession(id) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set in .dev.vars');
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent`,
    { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe HTTP ${res.status}`);
  return data;
}

/* Everything below resolves a path from a reference and then checks the result
 * is still inside DOCS_ROOT. The reference is already constrained to
 * FK-XXXXX-XXX or FV-XXXXX-XXX, which cannot contain a slash or a dot segment,
 * but the containment check stays: one regex being loosened later should not
 * turn into reading /etc/passwd. */
function folderFor(reference) {
  if (!REF_RE.test(reference) && !VREF_RE.test(reference)) {
    throw new Error('Not a valid reference');
  }
  const dir = resolve(join(DOCS_ROOT, reference));
  if (dir !== DOCS_ROOT && !dir.startsWith(DOCS_ROOT + sep)) {
    throw new Error('Refusing to leave the documents folder');
  }
  return dir;
}

const MIME = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.txt': 'text/plain', '.csv': 'text/csv', '.heic': 'image/heic',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const routes = {
  async list({ q, status }) {
    const where = [];
    if (status && status !== 'all') where.push(`status = '${esc(status)}'`);
    if (q) {
      const term = esc(q.toLowerCase());
      where.push(
        `(lower(reference) LIKE '%${term}%' OR lower(name) LIKE '%${term}%' ` +
        `OR lower(email) LIKE '%${term}%')`
      );
    }
    const [rows, counts, unemailed] = await d1All(
      `SELECT reference, status, name, email, amount_total, currency, created_at,
              paid_at, notified_at, applicant_emailed_at, failure_reason
         FROM applications
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY COALESCE(paid_at, created_at) DESC
        LIMIT 500;
       SELECT status, COUNT(*) AS n FROM applications GROUP BY status;
       SELECT COUNT(*) AS n FROM applications WHERE status='paid' AND applicant_emailed_at IS NULL;`
    );
    return { rows, counts, unemailed: unemailed[0]?.n ?? 0 };
  },

  /* Paid viewings, newest first. A separate route rather than a union with
   * applications: the two have different columns and different next actions, and
   * merging them would mean every row carrying half a set of empty fields. */
  async viewings({ q, status }) {
    const where = [];
    if (status && status !== 'all') where.push(`status = '${esc(status)}'`);
    if (q) {
      const term = esc(q.toLowerCase());
      where.push(
        `(lower(reference) LIKE '%${term}%' OR lower(name) LIKE '%${term}%' ` +
        `OR lower(email) LIKE '%${term}%' OR lower(property_url) LIKE '%${term}%')`
      );
    }
    const [rows, counts] = await d1All(
      `SELECT reference, service, status, name, email, phone, property_url,
              application_reference, amount_total, currency, created_at, paid_at,
              scheduled_for, attended_at, notified_at
         FROM viewings
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 300;
       SELECT status, COUNT(*) AS n FROM viewings GROUP BY status;`
    );
    return { rows, counts };
  },

  /* Records that we have agreed a slot, or been. Both are things only you know,
   * so they are typed in rather than inferred from anything. */
  async viewingUpdate({ reference, scheduled_for, attended_at, status }) {
    if (!VREF_RE.test(reference || '')) throw new Error('Not a valid viewing reference');
    const sets = [];
    if (scheduled_for !== undefined) {
      sets.push(scheduled_for ? `scheduled_for = '${esc(scheduled_for)}'` : `scheduled_for = NULL`);
    }
    if (attended_at !== undefined) {
      sets.push(attended_at ? `attended_at = '${esc(attended_at)}'` : `attended_at = NULL`);
    }
    if (status) {
      if (!['pending', 'paid', 'expired', 'failed', 'refunded'].includes(status)) {
        throw new Error('Not a valid status');
      }
      sets.push(`status = '${esc(status)}'`);
    }
    if (!sets.length) throw new Error('Nothing to change');
    await d1(`UPDATE viewings SET ${sets.join(', ')} WHERE reference = '${esc(reference)}';`);
    return { ok: true };
  },

  async detail({ reference }) {
    if (!REF_RE.test(reference || '')) throw new Error('Not a valid reference');
    const rows = await d1(
      `SELECT * FROM applications WHERE reference = '${esc(reference)}';`
    );
    if (!rows.length) throw new Error('No application with that reference');
    const row = rows[0];
    let application = {};
    try {
      application = JSON.parse(row.payload);
    } catch { /* leave empty; the raw row is still shown */ }
    delete row.payload;
    /* ip_hash is a salted hash and useless here, but there is no reason to put
     * it on screen either. */
    delete row.ip_hash;
    return { row, application };
  },

  /* Correcting an address the applicant mistyped. The stored payload is the
   * copy the confirmation email reads from, so both have to move together or a
   * resend would quietly go to the old address again. */
  async updateEmail({ reference, email }) {
    if (!REF_RE.test(reference || '')) throw new Error('Not a valid reference');
    if (!EMAIL_RE.test(email || '')) throw new Error('That does not look like an email address');

    const rows = await d1(`SELECT payload FROM applications WHERE reference = '${esc(reference)}';`);
    if (!rows.length) throw new Error('No application with that reference');

    let payload;
    try {
      payload = JSON.parse(rows[0].payload);
    } catch {
      throw new Error('The stored application could not be read');
    }
    payload.email = email;

    await d1(
      `UPDATE applications
          SET email = '${esc(email)}', payload = '${esc(JSON.stringify(payload))}'
        WHERE reference = '${esc(reference)}';`
    );
    return { ok: true, email };
  },

  /* Sends the confirmation again, to whatever address is on file now. Used when
   * the first one bounced, went to a typo, or was never sent because the email
   * integration was not switched on yet. */
  async resend({ reference }) {
    if (!REF_RE.test(reference || '')) throw new Error('Not a valid reference');
    if (!env.RESEND_API_KEY || !env.NOTIFY_FROM) {
      throw new Error('RESEND_API_KEY and NOTIFY_FROM are not set in .dev.vars');
    }

    const rows = await d1(
      `SELECT reference, email, payload, receipt_url, status
         FROM applications WHERE reference = '${esc(reference)}';`
    );
    if (!rows.length) throw new Error('No application with that reference');
    const row = rows[0];
    if (row.status !== 'paid') throw new Error(`This application is "${row.status}", not paid`);

    const application = JSON.parse(row.payload);
    if (!application.email) application.email = row.email;

    const support = env.NOTIFY_EMAIL || 'hello@fastkeyshousing.com';
    const site = 'https://fastkeyshousing.com';
    const { subject, html, text } = applicantEmail({
      reference: row.reference,
      application,
      receiptUrl: row.receipt_url || null,
      siteUrl: site,
      supportEmail: support,
    });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
        /* No idempotency key here, unlike the automatic path. A resend is an
         * explicit decision to send the same thing again, usually because the
         * first attempt went to the wrong address. */
      },
      body: JSON.stringify({
        from: env.NOTIFY_FROM,
        to: [application.email],
        reply_to: support,
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) throw new Error(`Resend: HTTP ${res.status} ${await res.text()}`);

    await d1(
      `UPDATE applications SET applicant_emailed_at = '${new Date().toISOString()}'
        WHERE reference = '${esc(reference)}';`
    );
    return { ok: true, sentTo: application.email };
  },

  /* Compares every pending row against Stripe and settles the ones that actually
   * paid. This is the repair for the gap described above: it is the only thing
   * in the system that looks backwards rather than reacting to an event. */
  async reconcile() {
    const rows = await d1(
      `SELECT reference, stripe_session_id FROM applications
        WHERE status = 'pending' AND stripe_session_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 200;`
    );
    const settled = [], stillUnpaid = [], errors = [];

    for (const row of rows) {
      try {
        const s = await stripeSession(row.stripe_session_id);
        if (s.payment_status === 'paid') {
          const pi = typeof s.payment_intent === 'object' ? s.payment_intent : null;
          const receipt = pi?.charges?.data?.[0]?.receipt_url ?? null;
          await d1(
            `UPDATE applications
                SET status = 'paid',
                    paid_at = COALESCE(paid_at, '${new Date().toISOString()}'),
                    amount_total = ${Number(s.amount_total) || 'NULL'},
                    currency = '${esc(s.currency || 'eur')}',
                    stripe_payment_intent = ${pi?.id ? `'${esc(pi.id)}'` : 'stripe_payment_intent'},
                    stripe_customer = ${s.customer ? `'${esc(String(s.customer))}'` : 'stripe_customer'}
                    ${receipt ? `, receipt_url = '${esc(receipt)}'` : ''}
              WHERE reference = '${esc(row.reference)}';`
          );
          settled.push(row.reference);
        } else if (s.status === 'expired') {
          await d1(`UPDATE applications SET status='expired' WHERE reference='${esc(row.reference)}';`);
          stillUnpaid.push({ reference: row.reference, why: 'checkout expired' });
        } else {
          stillUnpaid.push({ reference: row.reference, why: s.payment_status });
        }
      } catch (err) {
        errors.push({ reference: row.reference, error: err.message });
      }
    }
    return { checked: rows.length, settled, stillUnpaid, errors };
  },

  /* A nudge to somebody who never completed payment. Sent one at a time and by
   * hand: nothing about an abandoned checkout tells us whether the card failed
   * or the person changed their mind. */
  async remind({ reference }) {
    if (!REF_RE.test(reference || '')) throw new Error('Not a valid reference');
    if (!env.RESEND_API_KEY || !env.NOTIFY_FROM) {
      throw new Error('RESEND_API_KEY and NOTIFY_FROM are not set in .dev.vars');
    }
    const rows = await d1(
      `SELECT reference, email, payload, status, stripe_session_id
         FROM applications WHERE reference = '${esc(reference)}';`
    );
    if (!rows.length) throw new Error('No application with that reference');
    const row = rows[0];
    if (row.status === 'paid') {
      throw new Error('This one is paid. Send the confirmation instead.');
    }

    const application = JSON.parse(row.payload);
    if (!application.email) application.email = row.email;

    const support = env.NOTIFY_EMAIL || 'hello@fastkeyshousing.com';
    const site = 'https://fastkeyshousing.com';
    /* The failure page offers a retry against the stored application, so they
     * do not refill the form. If there is no session to resume, send them to
     * the form itself. */
    const resumeUrl = row.stripe_session_id
      ? `${site}/payment-failed?session_id=${encodeURIComponent(row.stripe_session_id)}`
      : `${site}/apply`;

    const { subject, html, text } = reminderEmail({
      application, reference: row.reference, resumeUrl, siteUrl: site, supportEmail: support,
    });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
        /* One reminder per application, ever. The email promises we will not
         * chase them again, and this is what keeps that true even if the button
         * is pressed twice. */
        'idempotency-key': `reminder-${row.reference}`,
      },
      body: JSON.stringify({
        from: env.NOTIFY_FROM, to: [application.email], reply_to: support, subject, html, text,
      }),
    });
    if (!res.ok) throw new Error(`Resend: HTTP ${res.status} ${await res.text()}`);
    return { ok: true, sentTo: application.email };
  },

  /* A record entered by hand: someone who paid by transfer, signed up over the
   * phone, or was migrated from before this system existed. */
  async create(params) {
    const name = String(params.name || '').trim();
    const email = String(params.email || '').trim();
    if (name.length < 2) throw new Error('A name is required');
    if (!EMAIL_RE.test(email)) throw new Error('A valid email is required');
    const status = STATUSES.includes(params.status) ? params.status : 'pending';

    const application = { name, email };
    for (const f of EDITABLE) {
      if (params[f] !== undefined && params[f] !== '') application[f] = params[f];
    }
    application.name = name;
    application.email = email;

    const reference = makeReference();
    const now = new Date().toISOString();
    await d1(
      `INSERT INTO applications
         (id, reference, status, name, email, payload, letter, created_at, paid_at)
       VALUES ('${esc(randomUUID())}', '${esc(reference)}', '${esc(status)}',
               '${esc(name)}', '${esc(email)}', '${esc(JSON.stringify(application))}',
               '${esc(params.letter || '')}', '${now}',
               ${status === 'paid' ? `'${now}'` : 'NULL'});`
    );
    return { ok: true, reference };
  },

  /* Corrects the details we hold. The stored payload is what every email and the
   * landlord letter read from, so the payload and the two mirrored columns have
   * to move together or a resend would use stale values. */
  async update({ reference, fields, status }) {
    if (!REF_RE.test(reference || '')) throw new Error('Not a valid reference');
    const rows = await d1(`SELECT payload, status FROM applications WHERE reference='${esc(reference)}';`);
    if (!rows.length) throw new Error('No application with that reference');

    let payload;
    try {
      payload = JSON.parse(rows[0].payload);
    } catch {
      throw new Error('The stored application could not be read');
    }

    const changed = [];
    for (const [k, v] of Object.entries(fields || {})) {
      if (!EDITABLE.includes(k)) continue;
      if (k === 'email' && v && !EMAIL_RE.test(v)) throw new Error('That does not look like an email address');
      /* The form posts every field on every save, so compare before recording a
       * change. Otherwise the confirmation claims seventeen edits when one box
       * was touched, and stops meaning anything. */
      const before = payload[k];
      const same = String(before ?? '') === String(v ?? '');
      payload[k] = v;
      if (!same) changed.push(k);
    }

    const sets = [`payload = '${esc(JSON.stringify(payload))}'`];
    /* name and email exist as columns as well, for searching and sending. */
    if (payload.name) sets.push(`name = '${esc(payload.name)}'`);
    if (payload.email) sets.push(`email = '${esc(payload.email)}'`);

    if (status && status !== rows[0].status) {
      if (!STATUSES.includes(status)) throw new Error('Not a valid status');
      sets.push(`status = '${esc(status)}'`);
      /* Marking something paid by hand still needs a paid_at, or it sorts and
       * reports as though the money never arrived. */
      if (status === 'paid') sets.push(`paid_at = COALESCE(paid_at, '${new Date().toISOString()}')`);
      changed.push('status');
    }

    await d1(`UPDATE applications SET ${sets.join(', ')} WHERE reference = '${esc(reference)}';`);
    return { ok: true, changed };
  },

  /* Hard delete. There is no soft-delete flag on purpose: when someone asks for
   * their data to be erased, a row still sitting there with a hidden flag is not
   * erasure. The confirmation is enforced in the interface, which requires the
   * reference to be typed out. */
  async remove({ reference, confirm }) {
    if (!REF_RE.test(reference || '')) throw new Error('Not a valid reference');
    if (confirm !== reference) throw new Error('Type the reference exactly to confirm deletion');
    const rows = await d1(`SELECT reference FROM applications WHERE reference='${esc(reference)}';`);
    if (!rows.length) throw new Error('No application with that reference');
    await d1(`DELETE FROM applications WHERE reference = '${esc(reference)}';`);
    return { ok: true, deleted: reference };
  },

  /* Lists what is on disk for one applicant. Creates the folder on first look,
   * so there is somewhere obvious to drop files rather than a path you have to
   * remember to make by hand. */
  async documents({ reference }) {
    const dir = folderFor(reference);
    let created = false;
    try {
      statSync(dir);
    } catch {
      mkdirSync(dir, { recursive: true });
      created = true;
    }

    const files = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => {
        const s = statSync(join(dir, e.name));
        return {
          name: e.name,
          size: human(s.size),
          modified: s.mtime.toISOString(),
          viewable: ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.txt'].includes(
            extname(e.name).toLowerCase()
          ),
        };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));

    return { folder: dir, files, created };
  },

  /* The reference's folder path, for pasting into a file manager. */
  async documentsPath({ reference }) {
    return { folder: folderFor(reference) };
  },

  /* The rendered email, so it can be checked before sending. */
  async preview({ reference, kind }) {
    if (!REF_RE.test(reference || '')) throw new Error('Not a valid reference');
    const rows = await d1(
      `SELECT reference, email, payload, receipt_url, stripe_session_id
         FROM applications WHERE reference = '${esc(reference)}';`
    );
    if (!rows.length) throw new Error('No application with that reference');
    const application = JSON.parse(rows[0].payload);
    if (!application.email) application.email = rows[0].email;
    const support = env.NOTIFY_EMAIL || 'hello@fastkeyshousing.com';
    const site = 'https://fastkeyshousing.com';

    const { subject, html } = kind === 'reminder'
      ? reminderEmail({
          application, reference: rows[0].reference, siteUrl: site, supportEmail: support,
          resumeUrl: rows[0].stripe_session_id
            ? `${site}/payment-failed?session_id=${encodeURIComponent(rows[0].stripe_session_id)}`
            : `${site}/apply`,
        })
      : applicantEmail({
          reference: rows[0].reference, application,
          receiptUrl: rows[0].receipt_url || null, siteUrl: site, supportEmail: support,
        });
    return { subject, html, to: application.email };
  },
};

/* ---------------------------------------------------------------- server --- */
function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'content-type': type + '; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    /* This page must never be framed, and must not talk to anything remote. */
    'content-security-policy':
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
      "img-src 'self' data: blob:; frame-src 'self' data: blob:; object-src 'self'; frame-ancestors 'none'",
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  /* Every response is either the shell or an authenticated call. */
  if (url.pathname === '/' ) {
    if (url.searchParams.get('k') !== TOKEN) {
      return send(res, 403, 'Missing or wrong token. Use the link printed in your terminal.', 'text/plain');
    }
    let page = readFileSync(HTML, 'utf8');
    /* replaceAll, not replace: the mode appears twice, once as a class and once
     * as the label, and replacing only the first left "__MODE__" on screen. */
    page = page.replaceAll('__TOKEN__', TOKEN)
               .replaceAll('__MODECLASS__', LOCAL ? 'local' : 'production')
               .replaceAll('__MODE__', LOCAL ? 'local database' : 'production');
    return send(res, 200, page, 'text/html');
  }

  const token = url.searchParams.get('k') || req.headers['x-admin-token'];

  /* Serving a document is not a JSON route: it streams bytes with a real
   * content type so the browser can preview a PDF or a photo in place. */
  if (url.pathname === '/file') {
    if (token !== TOKEN) return send(res, 403, 'bad token', 'text/plain');
    try {
      const dir = folderFor(url.searchParams.get('reference') || '');
      /* basename strips any directory part, so ../../etc/passwd becomes passwd
       * and then fails the containment check below anyway. Belt and braces. */
      const name = basename(url.searchParams.get('name') || '');
      if (!name || name.startsWith('.')) throw new Error('No such file');
      const full = resolve(join(dir, name));
      if (!full.startsWith(dir + sep)) throw new Error('Refusing to leave the folder');
      const s = statSync(full);
      if (!s.isFile()) throw new Error('Not a file');

      const type = MIME[extname(name).toLowerCase()] || 'application/octet-stream';
      const download = url.searchParams.get('download') === '1';
      res.writeHead(200, {
        'content-type': type,
        'content-length': s.size,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-disposition':
          `${download ? 'attachment' : 'inline'}; filename="${name.replace(/["\\]/g, '')}"`,
      });
      return createReadStream(full).pipe(res);
    } catch (err) {
      /* The raw error carries the absolute path, which is needless detail to put
       * in a response. It goes to the terminal instead. */
      console.warn('[file]', err.message);
      return send(res, 404, 'No such file', 'text/plain');
    }
  }

  if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });

  if (token !== TOKEN) return send(res, 403, { error: 'bad token' });

  const name = url.pathname.slice(5);
  const handler = routes[name];
  if (!handler) return send(res, 404, { error: 'no such route' });

  let params = Object.fromEntries(url.searchParams);
  if (req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => resolve(b));
    });
    try {
      params = { ...params, ...JSON.parse(body || '{}') };
    } catch {
      return send(res, 400, { error: 'bad json' });
    }
  }

  try {
    return send(res, 200, await handler(params));
  } catch (err) {
    return send(res, 400, { error: err.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  const mode = LOCAL ? 'LOCAL scratch database' : 'PRODUCTION database';
  console.log(`\n  \x1b[1mFastKeys admin\x1b[0m  \x1b[2m${mode}\x1b[0m\n`);
  console.log(`  \x1b[36mhttp://127.0.0.1:${PORT}/?k=${TOKEN}\x1b[0m\n`);
  console.log(`  \x1b[2mDocuments: ${DOCS_ROOT}\x1b[0m`);
  console.log('  \x1b[2mOpen that link. The token changes each time you start it.');
  console.log('  Reachable only from this machine. Ctrl+C to stop.\x1b[0m\n');
});
