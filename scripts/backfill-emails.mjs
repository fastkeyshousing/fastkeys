#!/usr/bin/env node
/* Emails the applicants who paid before the confirmation email was switched on.
 *
 * Those people paid, heard nothing back, and have been waiting. This sends them
 * the same confirmation everyone gets now, with an opening that acknowledges the
 * delay rather than pretending it did not happen.
 *
 * Dry run by default. Nothing is sent, and nothing is written, until --send is
 * passed. That is deliberate: this is the one script in the project that
 * contacts real customers, and an accidental double-send to your entire early
 * list is not something you can take back.
 *
 *   npm run backfill                    # show who would be emailed
 *   npm run backfill -- --send          # actually send
 *   npm run backfill -- --send --limit 5
 *   npm run backfill -- --send --only FK-WV94N-LWG
 *   npm run backfill -- --local         # against the local database
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { applicantEmail } from '../lib/applicant-email.js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i === -1 ? d : argv[i + 1];
};

const SEND = has('--send');
const LOCAL = has('--local');
const LIMIT = Number(val('--limit', '500'));
const ONLY = val('--only', null);
const DELAY_MS = Number(val('--delay', '600'));

const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

/* ---------------------------------------------------------------- env ----- */
function loadEnv() {
  let raw;
  try {
    raw = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  } catch {
    console.error(c.bad('No .dev.vars found. This script reads its credentials from there.'));
    process.exit(1);
  }
  const env = {};
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq > 0) env[s.slice(0, eq).trim()] = s.slice(eq + 1).trim();
  }
  return env;
}

const env = loadEnv();
for (const key of ['RESEND_API_KEY', 'NOTIFY_FROM']) {
  if (!env[key]) {
    console.error(c.bad(`${key} is not set in .dev.vars.`));
    console.error('See EMAIL-DNS.md. Without it nothing can be sent.');
    process.exit(1);
  }
}
const SUPPORT = env.NOTIFY_EMAIL || 'hello@fastkeyshousing.com';
const SITE = (env.SITE_URL_PUBLIC || 'https://fastkeyshousing.com').replace(/\/$/, '');

/* ---------------------------------------------------------------- d1 ------ */
function d1(sql) {
  const args = ['wrangler', 'd1', 'execute', 'fastkeys', LOCAL ? '--local' : '--remote',
    '--json', '--command', sql];
  const out = execFileSync('npx', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  /* wrangler prints banner lines before the JSON, so start at the first bracket. */
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`Unexpected wrangler output:\n${out}`);
  const parsed = JSON.parse(out.slice(start));
  return parsed[0]?.results ?? [];
}

const esc = (s) => String(s).replace(/'/g, "''");

/* Only people who actually paid and were never emailed. Anyone whose payment
 * failed or who abandoned checkout is deliberately excluded: telling someone we
 * have started work when no money arrived would be worse than silence. */
let where = `status = 'paid' AND applicant_emailed_at IS NULL`;
if (ONLY) where += ` AND reference = '${esc(ONLY)}'`;

console.log(c.b(`\nBackfill  ${c.dim(LOCAL ? '(local database)' : '(production database)')}\n`));

let rows;
try {
  rows = d1(
    `SELECT reference, name, email, payload, receipt_url, paid_at
       FROM applications
      WHERE ${where}
      ORDER BY paid_at ASC
      LIMIT ${Number.isFinite(LIMIT) ? LIMIT : 500};`
  );
} catch (err) {
  console.error(c.bad('Could not read the database:'), err.message);
  process.exit(1);
}

if (!rows.length) {
  console.log(c.ok('Nobody is waiting. Every paid application has already been emailed.\n'));
  process.exit(0);
}

console.log(`${rows.length} paid application(s) never received a confirmation:\n`);
for (const r of rows) {
  console.log(`  ${c.b(r.reference.padEnd(15))} ${String(r.name).padEnd(26)} ${c.dim(r.email)}`);
  console.log(`  ${''.padEnd(15)} ${c.dim('paid ' + (r.paid_at || 'unknown'))}`);
}

const OPENING =
  'Thank you for trusting us with this, and for your patience. You signed up before our ' +
  'confirmation emails were running, so this is arriving later than it should have. ' +
  'Nothing was lost: your application has been on file the whole time, and everything below ' +
  'is exactly what we hold for you.';

if (!SEND) {
  console.log(c.warn('\nDry run. Nothing has been sent.'));
  console.log(`Re-run with ${c.b('--send')} to email these ${rows.length} people.\n`);
  console.log(c.dim('Opening paragraph they will see:\n'));
  console.log(c.dim('  ' + OPENING.replace(/(.{74}\s)/g, '$1\n  ')));
  console.log();
  process.exit(0);
}

/* --------------------------------------------------------------- send ----- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sent = 0, failed = 0;

console.log(c.b(`\nSending to ${rows.length}…\n`));

for (const row of rows) {
  let application;
  try {
    application = JSON.parse(row.payload);
  } catch {
    console.log(`  ${c.bad('skip')} ${row.reference} — stored application is not readable`);
    failed++;
    continue;
  }
  if (!application.email) application.email = row.email;

  const { subject, html, text } = applicantEmail({
    reference: row.reference,
    application,
    receiptUrl: row.receipt_url || null,
    siteUrl: SITE,
    supportEmail: SUPPORT,
    opening: OPENING,
  });

  try {
    const res = await fetch((process.env.RESEND_BASE || 'https://api.resend.com') + '/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
        /* Same key the live path uses, so if the webhook ever emailed this
         * person, Resend will not send a duplicate. */
        'idempotency-key': `applicant-${row.reference}`,
      },
      body: JSON.stringify({
        from: env.NOTIFY_FROM,
        to: [application.email],
        reply_to: SUPPORT,
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);

    /* Stamped immediately, one row at a time. If this run dies halfway, the next
     * run picks up exactly where it stopped rather than emailing anyone twice. */
    d1(`UPDATE applications SET applicant_emailed_at = '${new Date().toISOString()}'
         WHERE reference = '${esc(row.reference)}';`);

    console.log(`  ${c.ok('sent')} ${row.reference.padEnd(15)} ${application.email}`);
    sent++;
  } catch (err) {
    console.log(`  ${c.bad('fail')} ${row.reference.padEnd(15)} ${err.message.slice(0, 90)}`);
    failed++;
  }

  /* Paced to stay well inside Resend's rate limit and to avoid a burst of
   * identical mail from a young domain, which is how reputations get damaged. */
  await sleep(DELAY_MS);
}

console.log(`\n  ${c.ok(sent + ' sent')}${failed ? ', ' + c.bad(failed + ' failed') : ''}`);
if (failed) console.log(c.dim('  Failed rows keep applicant_emailed_at null, so re-running retries only those.'));
console.log();
