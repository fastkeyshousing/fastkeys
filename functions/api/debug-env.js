/* GET /api/debug-env
 *
 * TEMPORARY. Delete this file once the deployment is configured correctly.
 *
 * Reports which keys are present in the Function's env and what shape they are.
 * It never returns a value, only names, types and lengths, because the whole
 * point is to answer "is this binding reaching the deployment at all" without
 * putting a live key in an HTTP response.
 *
 * Even so, the list of key names is information, so the endpoint requires a
 * token you choose. Set DEBUG_TOKEN as a secret, then call:
 *
 *   curl "https://fastkeyshousing.com/api/debug-env?token=YOUR_TOKEN"
 *
 * If DEBUG_TOKEN itself is missing, the endpoint reports only that, which is
 * still useful: it tells you whether secrets reach the deployment at all. */

const EXPECTED = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_ID',
  'SITE_URL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'DB',
];

function describe(value) {
  if (value === undefined) return 'MISSING';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    if (value.length === 0) return 'empty string';
    /* Enough to tell sk_live from sk_test, or a placeholder from a real id,
     * without disclosing anything usable. */
    const prefix = value.slice(0, 8).replace(/[^A-Za-z_]/g, '');
    return `string(${value.length}) starting "${prefix}…"`;
  }
  if (typeof value === 'object') {
    const methods = ['prepare', 'batch', 'exec'].filter((m) => typeof value[m] === 'function');
    return methods.length ? `D1 binding (${methods.join(', ')})` : 'object';
  }
  return typeof value;
}

export function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get('token');

  if (!env.DEBUG_TOKEN) {
    return Response.json({
      note: 'DEBUG_TOKEN is not set on this deployment.',
      meaning:
        'If you set DEBUG_TOKEN as a secret and redeployed, and you are still seeing ' +
        'this, then secrets are not reaching the deployment at all. That is the bug, ' +
        'not the Stripe key specifically.',
      secrets_reaching_deployment: false,
    }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }

  if (token !== env.DEBUG_TOKEN) {
    return new Response('forbidden', { status: 403, headers: { 'cache-control': 'no-store' } });
  }

  const report = {};
  for (const key of EXPECTED) report[key] = describe(env[key]);

  return Response.json({
    secrets_reaching_deployment: true,
    expected: report,
    all_env_keys_present: Object.keys(env).sort(),
  }, { headers: { 'cache-control': 'no-store' } });
}
