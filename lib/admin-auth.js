/* Authentication for the hosted admin panel.
 *
 * Three decisions worth stating, because they are the ones that go wrong:
 *
 * 1. PBKDF2-HMAC-SHA256 via WebCrypto. Workers have no bcrypt or argon2, and
 *    hand-rolling either would be worse than using the primitive the platform
 *    actually provides and audits.
 * 2. Sessions are stored server-side, keyed by a hash of the cookie value. The
 *    database never holds anything that could be replayed as a cookie, and a
 *    session can be revoked the moment somebody leaves.
 * 3. Login answers identically whether the email is unknown or the password is
 *    wrong, and hashes anyway on an unknown email, so the response neither
 *    confirms who has an account nor leaks it through timing.
 */

const ITERATIONS = 210_000;   // OWASP guidance for PBKDF2-HMAC-SHA256
const KEY_BITS = 256;
const SESSION_HOURS = 12;

const hex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function bytesFromHex(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function hashPassword(password, saltHex, iterations = ITERATIONS) {
  const salt = saltHex ? bytesFromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, KEY_BITS
  );
  return { hash: hex(bits), salt: hex(salt), iterations };
}

/* Length-independent comparison. A plain === on hex strings leaks how many
 * leading characters matched through timing. */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(input) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
}

export function newSessionToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export function sessionCookie(token, maxAgeSeconds) {
  /* HttpOnly keeps it away from any script on the page. Secure means it never
   * travels in the clear. SameSite=Strict means another site cannot cause the
   * browser to send it, which is what stops cross-site request forgery here. */
  return [
    `fk_admin=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export const clearCookie = () =>
  'fk_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';

export function readCookie(request, name = 'fk_admin') {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/* Returns the signed-in user, or null. Also extends nothing: the session expiry
 * is fixed from login, so a stolen cookie cannot be kept alive by using it. */
export async function currentUser(request, env) {
  const token = readCookie(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;

  const id = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.id AS sid, s.expires_at, u.id, u.email, u.name, u.role, u.disabled, u.must_change
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.user_id
      WHERE s.id = ?1`
  ).bind(id).first();

  if (!row) return null;
  if (row.disabled) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare(`DELETE FROM admin_sessions WHERE id = ?1`).bind(id).run().catch(() => {});
    return null;
  }

  return {
    id: row.id, email: row.email, name: row.name,
    role: row.role, mustChange: !!row.must_change, sessionId: id,
  };
}

export async function createSession(env, user, request) {
  const token = newSessionToken();
  const id = await sha256Hex(token);
  const now = Date.now();
  const expires = new Date(now + SESSION_HOURS * 3600_000).toISOString();

  await env.DB.prepare(
    `INSERT INTO admin_sessions (id, user_id, created_at, expires_at, last_seen_at, ip_hash, user_agent)
     VALUES (?1, ?2, ?3, ?4, ?3, ?5, ?6)`
  ).bind(
    id, user.id, new Date(now).toISOString(), expires,
    await sha256Hex(request.headers.get('cf-connecting-ip') || '0.0.0.0'),
    (request.headers.get('user-agent') || '').slice(0, 200)
  ).run();

  /* Opportunistic tidy-up so expired rows do not accumulate for ever. */
  await env.DB.prepare(`DELETE FROM admin_sessions WHERE expires_at < ?1`)
    .bind(new Date(now).toISOString()).run().catch(() => {});

  return { token, maxAge: SESSION_HOURS * 3600 };
}

export { ITERATIONS, SESSION_HOURS };
