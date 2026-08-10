/* POST /api/admin/login   { email, password }
 * POST /api/admin/logout
 * GET  /api/admin/me
 *
 * Rate limiting here is per IP and per account. The per-account limit matters
 * more than it looks: without it, a botnet spreads attempts across enough
 * addresses that a per-IP limit never fires, and the account is the thing being
 * attacked, not the address.
 */

import { json, fail, sameOrigin, clientIp, sha256Hex as ipHash, rateLimit } from '../../../lib/http.js';
import {
  hashPassword, timingSafeEqual, currentUser, createSession,
  sessionCookie, clearCookie, readCookie, sha256Hex, ITERATIONS,
} from '../../../lib/admin-auth.js';

/* Hashed against on an unknown email so the response takes the same time and
 * shape whether or not the account exists. */
const DECOY_SALT = '00000000000000000000000000000000';

export async function onRequestPost({ request, env, params }) {
  const action = params.action;
  const siteUrl = (env.SITE_URL || 'https://fastkeyshousing.com').replace(/\/$/, '');

  if (!env.DB) return fail(503, 'not_configured', 'D1 binding DB is not bound');
  if (!sameOrigin(request, siteUrl)) {
    return fail(403, 'bad_origin', request.headers.get('origin') || '(none)');
  }

  if (action === 'logout') {
    const token = readCookie(request);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      await env.DB.prepare(`DELETE FROM admin_sessions WHERE id = ?1`)
        .bind(await sha256Hex(token)).run().catch(() => {});
    }
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
  }

  if (action !== 'login') return fail(404, 'no_such_action');

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'bad_json');
  }

  const email = String(body?.email || '').trim().toLowerCase().slice(0, 254);
  const password = String(body?.password || '');
  if (!email || !password) return fail(422, 'missing_fields');

  const ip = clientIp(request);
  const byIp = await rateLimit(env.DB, `login:ip:${await ipHash(ip)}`, 10, 900);
  const byAccount = await rateLimit(env.DB, `login:acct:${await sha256Hex(email)}`, 8, 900);
  if (!byIp.ok || !byAccount.ok) {
    return fail(429, 'too_many_attempts', `${ip} / ${email}`);
  }

  /* Wrapped, because the failure this catches is not "wrong password" and must
   * not be reported as one. An unapplied migration used to surface as a 500 with
   * a raw stack trace, which the page then rendered as a credentials error and
   * sent people hunting for a typo that was never there. */
  let user;
  try {
    user = await env.DB.prepare(
      `SELECT id, email, name, role, password_hash, salt, iterations, disabled, must_change
         FROM admin_users WHERE email = ?1`
    ).bind(email).first();
  } catch (err) {
    const detail = String(err);
    console.error('[admin] login could not query admin_users:', detail);
    if (/no such table/i.test(detail)) {
      return fail(503, 'setup_incomplete', 'admin_users does not exist: run npm run db:migrate');
    }
    return fail(503, 'service_unavailable', detail);
  }

  /* Always derive a hash, even with no such account. Returning early here is the
   * classic way an login endpoint tells an attacker which addresses are real. */
  const candidate = await hashPassword(
    password,
    user?.salt || DECOY_SALT,
    user?.iterations || ITERATIONS
  );

  const ok = !!user && !user.disabled && timingSafeEqual(candidate.hash, user.password_hash);
  if (!ok) {
    console.warn(`[admin] failed login for ${email} from ${ip}`);
    /* One message for every failure: wrong email, wrong password, disabled
     * account. Distinguishing them is a favour to whoever is guessing. */
    return fail(401, 'invalid_credentials');
  }

  const { token, maxAge } = await createSession(env, user, request);
  await env.DB.prepare(`UPDATE admin_users SET last_login_at = ?1 WHERE id = ?2`)
    .bind(new Date().toISOString(), user.id).run().catch(() => {});

  console.log(`[admin] ${user.email} signed in from ${ip}`);
  return json(
    { ok: true, user: { email: user.email, name: user.name, role: user.role, mustChange: !!user.must_change } },
    200,
    { 'set-cookie': sessionCookie(token, maxAge) }
  );
}

export async function onRequestGet({ request, env, params }) {
  if (params.action !== 'me') return fail(404, 'no_such_action');
  if (!env.DB) return fail(503, 'not_configured');
  const user = await currentUser(request, env);
  if (!user) return json({ authenticated: false }, 200);
  return json({
    authenticated: true,
    user: { email: user.email, name: user.name, role: user.role, mustChange: user.mustChange },
  });
}
