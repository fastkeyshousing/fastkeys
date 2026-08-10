#!/usr/bin/env node
/* Creates or updates a panel account.
 *
 *   npm run admin:user -- --email you@fastkeyshousing.com --role owner
 *   npm run admin:user -- --email staff@fastkeyshousing.com --role staff
 *   npm run admin:user -- --list
 *   npm run admin:user -- --email x@y.com --disable
 *
 * Hashing happens here, on your machine. The password itself never travels: only
 * the derived hash and its salt reach the database, so nothing that could be
 * replayed is ever written down or sent anywhere.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomUUID, randomBytes, pbkdf2Sync, createHash } from 'node:crypto';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };

const LOCAL = has('--local');
/* Must match lib/admin-auth.js. The Workers runtime rejects anything above
 * 100,000, and a hash written here with a higher count can never be verified
 * there. */
const ITERATIONS = 100_000;

const WRANGLER = (() => {
  const local = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
  return existsSync(local) ? { cmd: local, pre: [] } : { cmd: 'npx', pre: ['wrangler'] };
})();

function d1(sql) {
  const args = [...WRANGLER.pre, 'd1', 'execute', 'fastkeys', LOCAL ? '--local' : '--remote',
    '--json', '--command', sql];
  let out;
  try {
    out = execFileSync(WRANGLER.cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
    console.error('\n' + (detail || err.message) + '\n');
    if (/no such table/i.test(detail)) {
      console.error(`Run:  npm run db:migrate${LOCAL ? ':local' : ''}\n`);
    }
    process.exit(1);
  }
  const i = out.indexOf('[');
  if (i === -1) throw new Error(`Unexpected wrangler output:\n${out}`);
  return JSON.parse(out.slice(i))[0]?.results ?? [];
}

const esc = (s) => String(s).replace(/'/g, "''");
const c = { ok:(s)=>`\x1b[32m${s}\x1b[0m`, bad:(s)=>`\x1b[31m${s}\x1b[0m`,
            dim:(s)=>`\x1b[2m${s}\x1b[0m`, b:(s)=>`\x1b[1m${s}\x1b[0m` };

if (has('--list')) {
  const rows = d1(`SELECT email, name, role, disabled, created_at, last_login_at FROM admin_users ORDER BY role, email;`);
  if (!rows.length) { console.log('\n  No accounts yet.\n'); process.exit(0); }
  console.log(c.b(`\n  Panel accounts ${c.dim(LOCAL ? '(local)' : '(production)')}\n`));
  for (const r of rows) {
    console.log(`  ${r.email.padEnd(34)} ${r.role.padEnd(6)} ${r.disabled ? c.bad('disabled') : c.ok('active')}`);
    console.log(c.dim(`  ${''.padEnd(34)} last login ${r.last_login_at || 'never'}`));
  }
  console.log();
  process.exit(0);
}

const email = String(val('--email', '')).trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
  console.error(c.bad('\n  --email is required and must be a real address.\n'));
  console.error('  npm run admin:user -- --email you@fastkeyshousing.com --role owner');
  console.error('  npm run admin:user -- --email them@fastkeyshousing.com --role staff');
  console.error('  npm run admin:user -- --list');
  console.error('  npm run admin:user -- --email them@x.com --disable   (keeps the account)');
  console.error('  npm run admin:user -- --email them@x.com --delete    (removes it)\n');
  process.exit(1);
}

/* Answers "why can I not log in" without guessing. Checks the table exists, the
 * account exists, and that a password you type actually verifies against the
 * stored hash, which separates a wrong password from a broken deployment. */
if (has('--check')) {
  let rows;
  try {
    rows = d1(`SELECT id,email,name,role,disabled,password_hash,salt,iterations,last_login_at
                 FROM admin_users WHERE email = '${esc(email)}';`);
  } catch { process.exit(1); }

  console.log(c.b(`\n  Checking ${email} ${c.dim(LOCAL ? '(local)' : '(production)')}\n`));
  if (!rows.length) {
    console.log(c.bad('  No account with that email in this database.'));
    const all = d1(`SELECT email FROM admin_users;`);
    if (all.length) {
      console.log(c.dim('  Accounts that do exist here:'));
      for (const a of all) console.log(c.dim(`    ${a.email}`));
      console.log(c.dim('\n  If yours is missing, it was probably created against the other'));
      console.log(c.dim('  database. Without --local the script writes to production.\n'));
    } else {
      console.log(c.dim('\n  This database has no accounts at all. Create one:'));
      console.log(c.dim(`    npm run admin:user -- ${LOCAL ? '--local ' : ''}--email ${email} --role owner\n`));
    }
    process.exit(1);
  }

  const u = rows[0];
  console.log(`  ${c.ok('found')}     ${u.email}  (${u.role})`);
  console.log(`  ${u.disabled ? c.bad('DISABLED') : c.ok('enabled')}`);
  console.log(c.dim(`  last login  ${u.last_login_at || 'never'}`));
  console.log(c.dim(`  iterations  ${u.iterations}`));

  const rl2 = createInterface({ input: process.stdin, output: process.stdout });
  const pw = await new Promise((r) => rl2.question('\n  Password to verify (blank to skip): ', r));
  rl2.close();
  if (pw) {
    const check = pbkdf2Sync(pw, Buffer.from(u.salt, 'hex'), u.iterations, 32, 'sha256').toString('hex');
    console.log(check === u.password_hash
      ? c.ok('\n  That password is correct. If the panel still refuses it, the problem')
        + c.ok('\n  is the deployment, not the account. Check npm run tail.\n')
      : c.bad('\n  That password does not match the stored hash.\n'));
  } else { console.log(); }
  process.exit(0);
}

if (has('--delete')) {
  const rows = d1(`SELECT id, role FROM admin_users WHERE email = '${esc(email)}';`);
  if (!rows.length) { console.error(c.bad(`\n  No account for ${email}.\n`)); process.exit(1); }

  /* Refusing to remove the last owner. An account list with only staff on it is
   * a panel nobody can administer, and the fix would mean going back to the
   * database by hand. */
  if (rows[0].role === 'owner') {
    const owners = d1(`SELECT COUNT(*) AS n FROM admin_users WHERE role = 'owner' AND disabled = 0;`);
    if ((owners[0]?.n ?? 0) <= 1) {
      console.error(c.bad('\n  That is the only active owner. Make somebody else an owner first.\n'));
      process.exit(1);
    }
  }

  d1(`DELETE FROM admin_sessions WHERE user_id = '${esc(rows[0].id)}';`);
  d1(`DELETE FROM admin_users WHERE email = '${esc(email)}';`);
  console.log(c.ok(`\n  Deleted ${email} and signed them out everywhere.\n`));
  process.exit(0);
}

if (has('--disable') || has('--enable')) {
  d1(`UPDATE admin_users SET disabled = ${has('--disable') ? 1 : 0} WHERE email = '${esc(email)}';`);
  if (has('--disable')) {
    /* Revoking the sessions is the part people forget. Disabling the account
     * without this leaves them signed in until their cookie expires. */
    d1(`DELETE FROM admin_sessions WHERE user_id IN (SELECT id FROM admin_users WHERE email = '${esc(email)}');`);
    console.log(c.ok(`\n  ${email} disabled and signed out everywhere.\n`));
  } else {
    console.log(c.ok(`\n  ${email} re-enabled.\n`));
  }
  process.exit(0);
}

const role = val('--role', 'staff') === 'owner' ? 'owner' : 'staff';
const name = val('--name', email.split('@')[0]);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, hidden) => new Promise((resolve) => {
  if (!hidden) return rl.question(q, resolve);
  /* Muting stdout so the password is not left on screen or in a screenshot. */
  process.stdout.write(q);
  const onData = (ch) => {
    if (['\n', '\r', '\u0004'].includes(ch.toString())) {
      process.stdin.removeListener('data', onData);
    } else {
      process.stdout.write('\x1b[2K\x1b[200D' + q + '*'.repeat(rl.line.length));
    }
  };
  process.stdin.on('data', onData);
  rl.question('', (v) => { process.stdout.write('\n'); resolve(v); });
});

console.log(c.b(`\n  ${role === 'owner' ? 'Owner' : 'Staff'} account for ${email} ${c.dim(LOCAL ? '(local)' : '(production)')}\n`));

const password = await ask('  Password (min 12 characters): ', true);
if (password.length < 12) {
  console.error(c.bad('\n  Too short. Twelve characters minimum, and please use a manager rather than something memorable.\n'));
  process.exit(1);
}
const again = await ask('  Again: ', true);
rl.close();
if (password !== again) { console.error(c.bad('\n  They do not match.\n')); process.exit(1); }

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');

const existing = d1(`SELECT id FROM admin_users WHERE email = '${esc(email)}';`);
if (existing.length) {
  d1(`UPDATE admin_users
         SET password_hash = '${hash.toString('hex')}', salt = '${salt.toString('hex')}',
             iterations = ${ITERATIONS}, role = '${role}', name = '${esc(name)}', disabled = 0
       WHERE email = '${esc(email)}';`);
  /* A password change signs out every existing session, which is the whole
   * point of changing it after something has gone wrong. */
  d1(`DELETE FROM admin_sessions WHERE user_id = '${esc(existing[0].id)}';`);
  console.log(c.ok(`\n  Updated ${email} (${role}). All existing sessions signed out.\n`));
} else {
  d1(`INSERT INTO admin_users (id, email, name, role, password_hash, salt, iterations, created_at)
      VALUES ('${randomUUID()}', '${esc(email)}', '${esc(name)}', '${role}',
              '${hash.toString('hex')}', '${salt.toString('hex')}', ${ITERATIONS},
              '${new Date().toISOString()}');`);
  console.log(c.ok(`\n  Created ${email} (${role}).\n`));
}
console.log(c.dim(`  Sign in at ${LOCAL ? 'http://localhost:8788' : 'https://fastkeyshousing.com'}/panel\n`));
