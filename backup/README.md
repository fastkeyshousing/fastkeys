# FastKeys Housing

Static site plus a small API, deployed as one Cloudflare Pages project.
`fastkeyshousing.com`

---

## Layout

```
functions/api/          each file becomes an endpoint on the live domain
  apply.js              POST /api/apply
  status.js             GET  /api/status
  stripe-webhook.js     POST /api/stripe-webhook
lib/                    shared modules, deliberately outside functions/ so
  http.js               nothing here is routable
  validate.js
  stripe.js
  notify.js
public/                 the Pages build output directory
  index.html            EN landing page
  nl.html               NL landing page
  apply.html            application form
  success.html          confirmation, driven entirely by the API
  terms.html
  404.html
  _headers  _redirects  *.png
migrations/
  0001_init.sql
wrangler.toml
```

Anything not inside `public/` is never served. That is the reason for the
directory: a stray file at the repository root used to be reachable on the live
domain.

---

## How payment works

```
/apply
   |  POST /api/apply
   v
validate -> store as 'pending' in D1 -> create Stripe Checkout Session
   |
   |  redirect
   v
Stripe hosted checkout
   |
   +---> POST /api/stripe-webhook  ->  mark 'paid', deliver the application
   |
   |  redirect to /success?session_id=cs_...
   v
GET /api/status  ->  the page shows only what the server confirms
```

Two properties matter and both are load-bearing:

**The application is delivered by the webhook, never by the browser.** There is
no client-side code path that causes an application to reach you. Opening
`/success` by hand therefore accomplishes nothing at all.

**The confirmation page holds no state.** It reads a Stripe session id from the
URL and asks the server about it. A session id is minted by Stripe and only ever
appears in the redirect after a genuine checkout, so it cannot be guessed or
constructed. Without one, the page says there is nothing to confirm.

The application is written to the database *before* payment, as `pending`. If
someone abandons checkout the row simply stays pending; it is never delivered and
never counted.

### The rest of the controls

- Webhook signatures verified with WebCrypto HMAC-SHA256 over the raw body, with
  a 5 minute timestamp tolerance, so a captured webhook is not replayable later.
- Stripe event ids recorded, so an event cannot be processed twice inside that
  window.
- The status update is guarded on `status <> 'paid'`, so Stripe's retries and the
  live status check cannot both notify you for one payment.
- The charge amount comes from `STRIPE_PRICE_ID` on the server. The client has no
  influence over what is charged.
- An idempotency key on session creation, so a double-submitted form cannot
  produce two charges.
- Every field revalidated server-side against a fixed schema with length caps.
  Browser validation is a convenience for the applicant, not a control.
- The landlord letter is **rebuilt** on the server from validated fields rather
  than accepted as submitted. Trusting the submitted text would make the form an
  open channel for writing arbitrary content into your inbox.
- Rate limiting in two tiers: a loose flood guard on all requests, and a tight
  quota applied only after validation passes, so an applicant who mistypes their
  email twice is not locked out.
- Origin check, body size cap, and hashed IPs rather than stored addresses.

---

## Setup

**New to this? Read `SETUP.md` instead.** It walks through the Cloudflare and
Stripe dashboards click by click, sets you up on a Stripe sandbox first, and
covers the switch to real payments. What follows here is the short version for
reference.

### 1. Database

Jurisdiction is fixed at creation and cannot be changed afterwards. The Terms
promise EEA storage, so this flag is not optional:

```sh
npx wrangler d1 create fastkeys --location=weur
```

Put the returned id into `wrangler.toml`, then:

```sh
npm run db:migrate
```

### 2. Stripe

1. Product catalogue: add *FastKeys application service*, EUR 50, one-off.
2. Copy the **Price ID** (`price_...`) into `wrangler.toml` under `[vars]`.
3. Developers -> Webhooks -> add endpoint
   `https://fastkeyshousing.com/api/stripe-webhook`, subscribed to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.expired`
4. Copy the signing secret (`whsec_...`).

No Payment Link is involved. Checkout sessions are created server-side, which is
what makes verification possible.

### 3. Secrets

Workers & Pages -> fastkeys -> Settings -> Variables and Secrets, or:

```sh
npx wrangler pages secret put STRIPE_SECRET_KEY
npx wrangler pages secret put STRIPE_WEBHOOK_SECRET
```

| name | kind | required | purpose |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | secret | yes | creating and reading sessions |
| `STRIPE_WEBHOOK_SECRET` | secret | yes | signature verification |
| `STRIPE_PRICE_ID` | var | yes | what gets charged |
| `SITE_URL` | var | yes | building redirect URLs |
| `TELEGRAM_BOT_TOKEN` | secret | no | notification |
| `TELEGRAM_CHAT_ID` | secret | no | notification |
| `RESEND_API_KEY` | secret | no | email notification |
| `NOTIFY_EMAIL` | var | no | where email lands |
| `NOTIFY_FROM` | var | no | verified sender |
| `TURNSTILE_SECRET_KEY` | secret | no | bot challenge |

Configure at least one notification channel. Without one, paid applications are
still stored safely in D1, but nothing tells you they arrived.

Cloudflare withdrew the free MailChannels route for Workers, so email requires
Resend or a similar provider. Telegram needs no sending domain and is the
simpler option.

### 4. Project settings

Build output directory: `public`. No build command.

### 5. Turnstile, optional

Set `TURNSTILE_SECRET_KEY` **and** paste the matching site key into
`TURNSTILE_SITE_KEY` near the bottom of `public/apply.html`, then add the widget
script. Configure both or neither: the server only enforces the challenge when
the secret is present, but if the secret is set and the page does not send a
token, every submission is rejected.

---

## Local development

```sh
cp .dev.vars.example .dev.vars     # fill in Stripe test keys
npm install
npm run db:migrate:local
npm run dev                        # http://localhost:8788
```

Forward webhooks to the local server with the Stripe CLI:

```sh
stripe listen --forward-to http://localhost:8788/api/stripe-webhook
```

Use the `whsec_` it prints as `STRIPE_WEBHOOK_SECRET` in `.dev.vars`; it differs
from the dashboard one.

---

## Reconciliation

Every application carries a reference (`FK-XXXXX-XXX`) that is sent to Stripe as
`client_reference_id` and stamped on the payment intent, so a payment in the
dashboard can always be matched to a record.

```sh
# paid but never delivered, which means both notification channels failed
npx wrangler d1 execute fastkeys --remote --command \
  "SELECT reference, email, paid_at FROM applications
    WHERE status='paid' AND notified_at IS NULL ORDER BY paid_at DESC;"

# abandoned checkouts
npx wrangler d1 execute fastkeys --remote --command \
  "SELECT reference, created_at FROM applications
    WHERE status='pending' AND created_at < datetime('now','-2 days');"
```

---

## Data retention

The applications table holds income, savings, employer and guarantor details.
Under the AVG that is personal data with no reason to persist indefinitely.
Nothing in this repository deletes it yet. Decide a retention period, then run
something like the following on a schedule:

```sql
DELETE FROM applications
 WHERE status IN ('pending','expired') AND created_at < datetime('now','-30 days');

DELETE FROM applications
 WHERE status = 'paid' AND paid_at < datetime('now','-12 months');

DELETE FROM rate_limits   WHERE window_start < strftime('%s','now') - 86400;
DELETE FROM webhook_events WHERE received_at  < datetime('now','-30 days');
```

Keep whatever the Belastingdienst requires for invoicing separately, in your
accounting records rather than here.

Still outstanding before launch: a verwerkersovereenkomst with Stripe and with
any notification provider, and MFA on every account that can reach this data.

---

## Content still to fill in

Search for these across `public/`:

- the version date in `terms.html`
- the KvK number, once registration completes. It was removed rather than left
  as zeros: a row of zeros reads as a fake business to exactly the audience that
  is already scanning for signs of one. Put it back in the `Details` footer
  column of `index.html` and `nl.html`, and in the imprint line of `terms.html`.

Email is now the only contact channel; WhatsApp and Facebook were removed
everywhere. If either comes back, the CSP in `public/_headers` does not need
changing for links, but `_headers` would need `frame-src` widening for any
embedded widget.

Placement counts and student numbers were left out deliberately. This audience is
already primed to expect scams, and one invented figure is the fastest way to
lose them.

---

## Notes

- `unsafe-inline` remains in the CSP because the CSS and JS are embedded in each
  page. It still blocks externally loaded script, which is the actual injection
  route. If those are ever split into separate files, switch to nonces.
- `js.stripe.com` is deliberately absent from the CSP. Checkout is Stripe's own
  hosted page, reached by redirect, so no Stripe script runs on this origin.
- The Functions have no npm dependencies. Stripe is reached over `fetch` and the
  HMAC is done with WebCrypto directly, which avoids the Node SDK's requirement
  to wire up `createFetchHttpClient` and `createSubtleCryptoProvider` — omitting
  either fails at runtime rather than at build time.
