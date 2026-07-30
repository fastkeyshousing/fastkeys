#!/usr/bin/env node
/* Checks the Telegram credentials on their own, without involving Stripe, the
 * database or a payment.
 *
 * Reads .dev.vars by default so it tests exactly what `npm run dev` would use.
 * Pass --remote to test values from the shell environment instead, which is how
 * you check what production has.
 *
 *   npm run check:telegram
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... npm run check:telegram -- --remote
 */
import { readFileSync } from 'node:fs';
import { sendTelegram } from '../lib/notify.js';

const useShellEnv = process.argv.includes('--remote');
const API = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

function loadDevVars() {
  let raw;
  try {
    raw = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  } catch {
    console.error(c.bad('No .dev.vars file found.'));
    console.error('Create it with:  cp .dev.vars.example .dev.vars');
    process.exit(1);
  }
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

function explain(description) {
  const d = (description || '').toLowerCase();
  if (d.includes('unauthorized')) {
    return ['The bot token is wrong or has been revoked.',
            'Message @BotFather, send /mybots, pick your bot, then API Token.'];
  }
  if (d.includes('chat not found')) {
    return ['The chat id does not exist, or your bot has never spoken to it.',
            'Open Telegram, find your bot by its @username, and send it any message.',
            'Then re-read the chat id from the getUpdates URL printed below.'];
  }
  if (d.includes('blocked')) {
    return ['You blocked the bot in Telegram.',
            'Open the chat with the bot and choose Restart or Unblock.'];
  }
  if (d.includes('chat_id') && d.includes('empty')) {
    return ['TELEGRAM_CHAT_ID is set but empty.'];
  }
  if (d.includes('group chat was upgraded')) {
    return ['The group became a supergroup, which changes its id.',
            'Re-read the chat id; supergroup ids start with -100.'];
  }
  return ['See the Telegram error text above.'];
}

const env = useShellEnv ? process.env : loadDevVars();
if (process.env.TELEGRAM_API_BASE) env.TELEGRAM_API_BASE = process.env.TELEGRAM_API_BASE;

const token = env.TELEGRAM_BOT_TOKEN;
const chatId = env.TELEGRAM_CHAT_ID;

console.log(c.b(`\nTelegram check  ${c.dim(useShellEnv ? '(shell environment)' : '(.dev.vars)')}\n`));

/* --- 1. are the values even present ------------------------------------- */
let fatal = false;
if (!token) {
  console.log(`${c.bad('✗')} TELEGRAM_BOT_TOKEN is not set`);
  fatal = true;
} else if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
  console.log(`${c.bad('✗')} TELEGRAM_BOT_TOKEN does not look like a bot token`);
  console.log(c.dim(`    got: ${token.slice(0, 12)}…  expected: 8123456789:AAF-xxxxxxxxxxxxxxxxxxxxxxxxxxxx`));
  console.log(c.dim('    A common mistake is pasting the bot username instead of the token.'));
  fatal = true;
} else {
  console.log(`${c.ok('✓')} TELEGRAM_BOT_TOKEN present  ${c.dim(token.slice(0, 10) + '…')}`);
}

if (!chatId) {
  console.log(`${c.bad('✗')} TELEGRAM_CHAT_ID is not set`);
  fatal = true;
} else if (!/^-?\d+$/.test(chatId)) {
  console.log(`${c.bad('✗')} TELEGRAM_CHAT_ID must be a number, not a username`);
  console.log(c.dim(`    got: ${chatId}   expected something like 123456789, or -1001234567890 for a group`));
  fatal = true;
} else {
  console.log(`${c.ok('✓')} TELEGRAM_CHAT_ID present    ${c.dim(chatId)}`);
}

if (fatal) {
  console.log(`\n${c.b('How to get these:')}`);
  console.log('  1. In Telegram, message @BotFather and send /newbot. Copy the token.');
  console.log('  2. Find your new bot by its @username and send it any message. This step');
  console.log('     is required: a bot cannot message someone who has never messaged it.');
  console.log(`  3. Open  https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`);
  console.log('     and look for  "chat":{"id":123456789  . That number is the chat id.');
  console.log('  4. Put both into .dev.vars, then run this again.\n');
  process.exit(1);
}

/* --- 2. does the token work --------------------------------------------- */
let me;
try {
  const res = await fetch(`${API}/bot${token}/getMe`);
  me = await res.json();
  if (!me.ok) throw new Error(me.description || `HTTP ${res.status}`);
  console.log(`${c.ok('✓')} token valid                 ${c.dim('@' + me.result.username)}`);
} catch (err) {
  console.log(`${c.bad('✗')} token rejected: ${err.message}`);
  for (const line of explain(err.message)) console.log(c.dim('    ' + line));
  console.log();
  process.exit(1);
}

/* --- 3. can the bot actually reach that chat ----------------------------- */
try {
  const res = await fetch(`${API}/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || `HTTP ${res.status}`);
  const chat = data.result;
  const who = chat.username ? '@' + chat.username : (chat.title || chat.first_name || chat.type);
  console.log(`${c.ok('✓')} chat reachable              ${c.dim(who)}`);
} catch (err) {
  console.log(`${c.bad('✗')} chat unreachable: ${err.message}`);
  for (const line of explain(err.message)) console.log(c.dim('    ' + line));
  console.log(c.dim(`    https://api.telegram.org/bot${token}/getUpdates`));
  console.log();
  process.exit(1);
}

/* --- 4. send a real message through the production code path ------------- */
try {
  await sendTelegram(env, 'FK-CHECK-000', '50.00 EUR',
    'This is a test from `npm run check:telegram`.\n' +
    'If you can read this, paid applications will arrive here.\n' +
    'No payment was taken and nothing was written to the database.');
  console.log(`${c.ok('✓')} test message sent`);
  console.log(`\n${c.ok('Telegram is working.')} Check your phone.\n`);
} catch (err) {
  console.log(`${c.bad('✗')} send failed: ${err.message}`);
  for (const line of explain(err.message)) console.log(c.dim('    ' + line));
  console.log();
  process.exit(1);
}
