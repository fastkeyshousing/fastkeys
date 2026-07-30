# FastKeys setup, start to finish

Follow this in order. Part 1 to Part 5 gets you a fully working site taking
**fake** payments in a Stripe sandbox. Part 6 switches it to real money.

Nothing here charges anybody until Part 6, so work through it without worrying
about breaking anything.

There are two websites you will be moving between:

| what | where | what it does |
|---|---|---|
| Cloudflare dashboard | `https://dash.cloudflare.com` | hosts the site, runs the API, stores the database |
| Stripe dashboard | `https://dashboard.stripe.com` | takes the payments |

You will also use a terminal. Every command below is run from inside the repo
folder, the one containing `wrangler.toml`.

---

# Part 0 · Get the tools

```sh
node --version      # need v18 or newer; if this errors, install from nodejs.org
cd path/to/fastkeys
npm install
npx wrangler login  # opens a browser, log in, click Allow
```

`npx wrangler login` connects your terminal to your Cloudflare account. If it
prints your email at the end, it worked.

---

# Part 1 · Find your way around the Cloudflare dashboard

You already have an account, because fastkeyshousing.com is already served from
Cloudflare Pages. Go to `https://dash.cloudflare.com` and log in.

The two places that matter:

**Your Pages project.** In the left sidebar, look for **Workers & Pages** (some
accounts show this as **Compute**). Click it, and you will see a list containing
your project, `fastkeys` or similar. Click it. The tabs across the top of that
project page are where you will set secrets and check the build settings.

**Your databases.** Back in the left sidebar, find **Storage & Databases**, then
**D1 SQL Database**. This is where the database you are about to create will
appear.

Cloudflare renames these menus every so often. If a name does not match, use the
search box at the top of the dashboard and type `D1` or the project name.

---

# Part 2 · Create the database

The database stores each application. It has to be created in the EU, because
your own Terms and Conditions promise that applicant data is stored in the EEA.

**The region cannot be changed after creation.** If you get this wrong the only
fix is to delete the database and start again, so read the command before you
run it.

```sh
npx wrangler d1 create fastkeys --location=weur
```

`weur` means Western Europe. The output looks like this:

```
✅ Successfully created DB 'fastkeys' in region WEUR

[[d1_databases]]
binding = "DB"
database_name = "fastkeys"
database_id = "a1b2c3d4-5e6f-7890-abcd-ef1234567890"
```

**Copy that `database_id`.** You need it in the next part.

If you would rather do it in the browser: Storage & Databases → D1 SQL Database →
**Create** → name it `fastkeys` → set location to **Western Europe (WEUR)** →
Create. Then open the database and copy the **Database ID** from the page.

Now create the tables:

```sh
npx wrangler d1 migrations apply fastkeys --remote
```

It will ask for confirmation. Say yes. You should see a success line reporting
the commands it ran. Check it worked:

```sh
npx wrangler d1 execute fastkeys --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table';"
```

You want to see `applications`, `webhook_events` and `rate_limits` in the list.

---

# Part 3 · Fill in wrangler.toml

Open `wrangler.toml` in the repo root. It has exactly two placeholders.

**Line 10** — leave this for now, you get the value in Part 4:

```toml
STRIPE_PRICE_ID = "price_REPLACE_ME"
```

**Line 15** — paste the database id from Part 2:

```toml
database_id = "REPLACE_WITH_ID_FROM_d1_create"
```

becomes

```toml
database_id = "a1b2c3d4-5e6f-7890-abcd-ef1234567890"
```

Line 9, `SITE_URL`, is already correct and should stay as
`https://fastkeyshousing.com`.

Nothing secret goes in this file. It is committed to git, and anything in it is
public the moment you push.

---

# Part 4 · Stripe, in a sandbox

A sandbox is a complete copy of a Stripe account that cannot move real money.
Card numbers that would be declined in reality work fine in it. Stripe now
treats sandboxes as the default way to test, and you can have up to five, free.

Everything you create in Part 4 exists **only** in the sandbox. The products,
the keys, the webhook: none of it carries across to live. Part 6 repeats these
steps on the live side. That is not a mistake in the guide, it is how Stripe
works, and it is the single most common thing people trip over.

## 4.1 · Create the sandbox

1. Go to `https://dashboard.stripe.com` and log in. Create an account if you
   have not already; you do not need to finish business verification to use a
   sandbox.
2. Click the **account picker** in the top left, the control showing your
   business name.
3. Click **Sandboxes**, then **Create sandbox**.
4. Name it `fastkeys-dev`. Choose **Create an account from scratch** unless you
   already have live settings worth copying.
5. Click **Create sandbox**.

You are now inside the sandbox. The dashboard will show a marker saying so.
**Check for that marker before every step below.** If it is missing, you are on
the live account and you are creating the wrong things.

## 4.2 · Create the product and get the Price ID

1. In the sandbox, go to **Product catalogue** in the left sidebar, then
   **Add a product**.
2. Name: `FastKeys application service`
3. Description: `One-off fee for a full housing application, viewings and contract check.`
4. Under pricing, choose **One-off** (not recurring).
5. Price: `50.00`, currency **EUR**.
6. Click **Add product**.

On the product page you will see a **Pricing** section with an entry that starts
`price_`. Click the copy icon next to it.

> Careful: the product id starts `prod_` and the price id starts `price_`. You
> need the **`price_`** one. Using `prod_` produces a confusing error later.

Paste it into `wrangler.toml` line 10:

```toml
STRIPE_PRICE_ID = "price_1QxxxxxxxxxxxxxxxxxxxxYY"
```

## 4.3 · Get the secret API key

1. Still in the sandbox, click **Developers** in the bottom left, then
   **API keys**. (In some layouts this is a **Developers** item in the top bar.)
2. You will see a **Publishable key** and a **Secret key**.
3. You need only the **Secret key**. Click **Reveal**, then copy it.

It starts with `sk_test_`. If yours starts with `sk_live_`, stop: you are not in
the sandbox. Go back to 4.1.

This key can move money on your behalf. Never paste it into an HTML file, never
commit it, never send it in a chat message. It goes in exactly two places: the
local `.dev.vars` file, which is gitignored, and the Cloudflare secrets store.

## 4.4 · Set up the local environment file

```sh
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` and fill in the four values:

```
STRIPE_SECRET_KEY=sk_test_51Abc...            # from 4.3
STRIPE_WEBHOOK_SECRET=whsec_...               # from 5.2, leave blank for now
STRIPE_PRICE_ID=price_1Qxxx...                # from 4.2
SITE_URL=http://localhost:8788
```

`.dev.vars` is listed in `.gitignore`, so it will not be committed. Confirm:

```sh
git check-ignore -v .dev.vars
```

If that prints nothing, **stop** and fix `.gitignore` before going further.

---

# Part 5 · Test it locally

## 5.1 · Set up the local database

The remote database from Part 2 is separate from your local test one. Create the
local copy:

```sh
npm run db:migrate:local
```

## 5.2 · Forward webhooks to your machine

Stripe cannot reach `localhost`, so its command line tool tunnels the webhooks
to you.

Install it from `https://docs.stripe.com/stripe-cli` (on macOS,
`brew install stripe/stripe-cli/stripe`), then, in a terminal you leave open:

```sh
stripe login
stripe listen --forward-to http://localhost:8788/api/stripe-webhook
```

It prints something like:

```
> Ready! Your webhook signing secret is whsec_1a2b3c4d5e6f...
```

**Copy that `whsec_` value into `.dev.vars` line 5.**

> This secret is different from the one in the Stripe dashboard, and it changes
> each time you run `stripe listen`. Using the dashboard one here means every
> webhook gets rejected as an invalid signature, payments get taken, and no
> application ever reaches you. If exactly one thing goes wrong in this whole
> guide, it will be this.

## 5.3 · Run the site

In a second terminal:

```sh
npm run dev
```

Open `http://localhost:8788`.

## 5.4 · Make a fake payment

1. Click **Start your application**.
2. Fill the form in. Pick at least three personality words and tick both boxes.
3. Submit. You land on Stripe's checkout page.
4. Pay with the test card:
   - number `4242 4242 4242 4242`
   - expiry: any future date, for example `12/30`
   - CVC: any three digits
   - postcode: any
5. You land back on the success page, which should show your reference and the
   "what happens next" list.

Check the terminal running `stripe listen`: you should see
`checkout.session.completed`.

Check the database:

```sh
npx wrangler d1 execute fastkeys --local --command \
  "SELECT reference, status, email, amount_total FROM applications;"
```

`status` should be `paid` and `amount_total` should be `5000`, which is 50 euro
in cents.

## 5.5 · Confirm the payment gate holds

Open `http://localhost:8788/success` directly, with nothing after it. It must say
**"Nothing to confirm here"**. If it congratulates you on a payment, something is
badly wrong; stop and check you have not modified `success.html`.

## 5.6 · Optional, get notified

Without this, paid applications sit safely in the database but nothing tells you
they arrived.

1. In Telegram, message `@BotFather`, send `/newbot`, follow the prompts, and
   copy the token it gives you.
2. Message your new bot once, saying anything.
3. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and
   find `"chat":{"id":123456789`. That number is your chat id.
4. Add both to `.dev.vars`:

```
TELEGRAM_BOT_TOKEN=8123456789:AAF...
TELEGRAM_CHAT_ID=123456789
```

Restart `npm run dev` and make another test payment. The application should
arrive in Telegram.

---

# Part 6 · Go live

Do this only once Part 5 works end to end.

## 6.1 · Repeat Part 4 on the live account

Switch out of the sandbox using the account picker, back to your live business.
You now need to complete Stripe's business verification if you have not: legal
entity, bank account for payouts, identity documents. Stripe will not release
live keys until that is done.

Then repeat, on the **live** side:

- **6.1a** Create the same product and price. Copy the new `price_` id. It is a
  different id from the sandbox one.
- **6.1b** Developers → API keys → copy the **live secret key**. It starts
  `sk_live_`.

## 6.2 · Create the real webhook endpoint

In the live dashboard, go to **Developers → Webhooks → Add endpoint**.

- Endpoint URL: `https://fastkeyshousing.com/api/stripe-webhook`
- Select these three events and no others:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.expired`
- Click **Add endpoint**.

On the endpoint page, find **Signing secret**, click **Reveal**, copy it. It
starts `whsec_`. This is the production one, and unlike the CLI secret it does
not change.

## 6.3 · Put the live price id in wrangler.toml

```toml
STRIPE_PRICE_ID = "price_LIVE_ID_FROM_6.1a"
```

Commit and push this. It is not a secret.

## 6.4 · Set the secrets on Cloudflare

Two ways. Either works.

**Terminal:**

```sh
npx wrangler pages secret put STRIPE_SECRET_KEY
# paste the sk_live_ key when prompted, press enter

npx wrangler pages secret put STRIPE_WEBHOOK_SECRET
# paste the whsec_ from 6.2

npx wrangler pages secret put TELEGRAM_BOT_TOKEN
npx wrangler pages secret put TELEGRAM_CHAT_ID
```

**Dashboard:** Workers & Pages → your project → **Settings** → **Variables and
Secrets** → **Add** → choose type **Secret** (not Plaintext) → name and value →
Save. Secrets are write-only: once saved you cannot read them back, only replace
them. That is intended.

## 6.5 · Check the build output directory

Workers & Pages → your project → **Settings** → **Build**. The **build output
directory** must be `public`. Build command stays empty.

If this is wrong the site will not deploy correctly, because all the pages live
in `public/` now.

## 6.6 · Check the database binding

Workers & Pages → your project → **Settings** → **Bindings**. You should see a
**D1 database** binding with variable name `DB` pointing at `fastkeys`.

It should be there automatically from `wrangler.toml`. If it is not, add it by
hand: Add binding → D1 database → variable name `DB` → select `fastkeys`.

**The variable name must be exactly `DB`**, in capitals. The code looks for
`env.DB` and nothing else.

## 6.7 · Deploy and verify

Push to your main branch. Watch the deploy finish in the dashboard, then:

1. Visit `https://fastkeyshousing.com/success` directly. It must say "Nothing to
   confirm here".
2. Make one real payment with your own card. Fifty euro moves from you to you,
   minus Stripe's fee of roughly 1.5% plus 25 cents on a European card.
3. Confirm the application reaches Telegram, and check the database:

```sh
npx wrangler d1 execute fastkeys --remote --command \
  "SELECT reference, status, paid_at, notified_at FROM applications;"
```

`notified_at` being null means the payment worked but delivery failed. Check
your Telegram values.

4. In Stripe, refund yourself: find the payment, **Refund**, full amount.

Do not skip step 2. A live webhook secret that does not match is invisible until
the first real payment, and the symptom is money arriving with no application
attached.

---

# Where every credential lives

| value | example | where it goes | secret |
|---|---|---|---|
| D1 database id | `a1b2c3d4-...` | `wrangler.toml` line 15 | no |
| Stripe price id | `price_1Qxx...` | `wrangler.toml` line 10 | no |
| Site URL | `https://fastkeyshousing.com` | `wrangler.toml` line 9 | no |
| Stripe secret key | `sk_live_...` | Cloudflare secret, and `.dev.vars` locally | **yes** |
| Webhook signing secret | `whsec_...` | Cloudflare secret, and `.dev.vars` locally | **yes** |
| Telegram bot token | `8123...:AAF...` | Cloudflare secret, and `.dev.vars` locally | **yes** |
| Telegram chat id | `123456789` | Cloudflare secret, and `.dev.vars` locally | **yes** |
| Turnstile site key | `0x4AAA...` | `public/apply.html` line 1008, optional | no |

There is no Stripe link to paste into a page. The old version used a Stripe
Payment Link pasted into `apply.html`, and that is exactly what allowed someone
to skip payment: a static page cannot verify that money moved. Checkout sessions
are now created by the server, which is why the secret key never touches the
browser.

---

# When something breaks

**"Payments are not switched on yet"** — `STRIPE_SECRET_KEY` or
`STRIPE_PRICE_ID` is missing. Locally, check `.dev.vars`. In production, check
Settings → Variables and Secrets.

**"We could not reach Stripe just now"** — the secret key is wrong, or the price
id belongs to the other environment. A sandbox price id with a live key fails
exactly like this.

**Payment succeeds, nothing arrives** — the webhook signing secret does not
match. Locally it must be the one `stripe listen` printed this session. In
production it must be the one from the endpoint page in 6.2. In Stripe,
Developers → Webhooks → your endpoint shows recent attempts and their responses;
a `400` there means a signature mismatch.

**"We cannot find that payment" after paying** — the payment happened in one
environment and the site is reading another. Check whether the key in use starts
`sk_test_` or `sk_live_`.

**`no such table: applications`** — migrations were not applied. Run
`npm run db:migrate:local` for local, `npm run db:migrate` for production.

**Nothing on the live site changed after pushing** — check the build output
directory is `public` (6.5).

To watch the live API as it runs:

```sh
npx wrangler pages deployment tail
```
