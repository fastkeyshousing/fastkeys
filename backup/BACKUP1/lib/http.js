/* Shared HTTP helpers.
 * Everything the API returns goes through here so headers stay consistent. */

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...BASE_HEADERS, ...extra },
  });
}

/* Client-facing errors are deliberately vague. Detail goes to the log, not the
 * response body, so probing the endpoint tells an attacker as little as possible. */
export function fail(status, code, logDetail) {
  if (logDetail) console.warn(`[api] ${code}: ${logDetail}`);
  return json({ error: code }, status);
}

/* Blocks cross-site form posts. The browser always sends Origin on a CORS-mode
 * POST, so a missing Origin on a POST is itself suspicious. */
export function sameOrigin(request, siteUrl) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const a = new URL(origin);
    const b = new URL(siteUrl);
    return a.host === b.host && a.protocol === b.protocol;
  } catch {
    return false;
  }
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || '0.0.0.0';
}

/* SHA-256 hex. Used to store a hashed IP rather than the address itself. */
export async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* Constant-time comparison of two hex strings of equal length. */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Fixed-window rate limit backed by D1. Fails open on a database error:
 * a broken limiter should not take the application form offline. */
export async function rateLimit(db, key, limit, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  try {
    await db
      .prepare(
        `INSERT INTO rate_limits (key, window_start, hits) VALUES (?1, ?2, 1)
         ON CONFLICT(key, window_start) DO UPDATE SET hits = hits + 1`
      )
      .bind(key, windowStart)
      .run();

    const row = await db
      .prepare(`SELECT hits FROM rate_limits WHERE key = ?1 AND window_start = ?2`)
      .bind(key, windowStart)
      .first();

    return { ok: (row?.hits ?? 0) <= limit };
  } catch (err) {
    console.error('[rate-limit] backend error, failing open:', err);
    return { ok: true };
  }
}

/* Pages routes an unmatched method to the static asset handler, which answers
 * with the homepage and a 200. Every API route pairs its method handler with a
 * catch-all that calls this instead. */
export function methodNotAllowed(allow) {
  return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
    status: 405,
    headers: {
      allow,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
