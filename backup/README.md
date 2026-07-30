# FastKeys — website

Five pages, each one completely self-contained. The CSS, the JavaScript, the logo and
the favicon are embedded in every file, so nothing can fail to load and there is no
`assets/` folder to lose.

```
index.html      English home page
nl.html         Dutch home page
apply.html      application form, live letter preview, payment step
success.html    where Stripe sends people back to; delivers the application
terms.html      Terms & Conditions
og-image.png    preview image for WhatsApp/Facebook link shares (optional)
fastkeys-*.png  transparent logos for your Facebook page and print (optional)
.nojekyll       tells GitHub to serve files as-is (optional, hidden)
```

Only the five HTML files are required.

---

## 1 · Connect Stripe (15 minutes)

The site uses a **Stripe Payment Link**, not a custom checkout. That is the only way to
take card payments from a static host like GitHub Pages without exposing a secret key.

1. Stripe Dashboard → **Product catalogue** → add a product, e.g.
   *"FastKeys application service"*, price **€50**, one-off.
2. → **Payment links** → create a link for that product.
3. In the link settings, under *After payment*, choose **Redirect customers to a page
   you specify** and enter your success URL, e.g.
   `https://fastkeys.nl/success.html` (or `https://<you>.github.io/<repo>/success.html`).
4. Copy the link (it looks like `https://buy.stripe.com/aEU00abc123`).
5. Open `apply.html`, find `STRIPE_LINK` near the bottom in the `EDIT THESE TWO LINES`
   block, and paste it in.

Until you do this, the form stops at the last step and says payment is not connected —
it will not send anything or take money.

### What you must know about how this works

The flow is: fill in the form → the details are held **in the applicant's own browser** →
Stripe takes the €50 → Stripe redirects back to `success.html` → the details are sent to you.

**This does not cryptographically verify payment.** Someone who worked out the URL could
open `success.html` directly and submit an application without paying. Nothing is exposed
and no money is at risk, but you could receive an unpaid application.

Two things make that a non-issue in practice:

- Stripe emails you a receipt for every payment, and each application carries a reference
  code (`FK-XXXXX-XXX`) that is also passed to Stripe as the `client_reference_id`.
  **Before you start work, match the reference on the application to the payment in Stripe.**
- The volume of people motivated to guess a URL to get free housing admin is roughly zero.

If you later want real enforcement, the upgrade is a small serverless function
(Cloudflare Workers, Vercel and Netlify all have free tiers) that verifies the Stripe
Checkout Session server-side before accepting the application. The site is structured so
that only `success.html` would need to change.

## 2 · Connect the form delivery

The application is delivered to you by an HTTP form service. Create a form at
[formspree.io](https://formspree.io) (or an equivalent) and paste the endpoint into
**both** places:

- `apply.html` → `FORM_ENDPOINT`
- `success.html` → `FORM_ENDPOINT`

They must match. If delivery fails, the applicant is not left stranded: `success.html`
shows them their application text with a copy button and a WhatsApp link.

> **Compliance note.** This form carries income, savings, employer and guarantor data.
> Your own Terms say it is stored in the EEA under processor agreements. Before you
> publish, make that true: choose an EU-hosted form provider, sign a processor agreement
> (verwerkersovereenkomst) with them and with Stripe, and turn on MFA everywhere.
> Formspree's default hosting is US-based — check their current EU options or pick a
> European alternative.

## 3 · Everything else to fill in

Search each file for `EDIT`.

| What | Where |
|---|---|
| WhatsApp number | all five pages, several times each |
| Email address | all five pages |
| Stripe payment link | `apply.html` |
| Form endpoint | `apply.html` **and** `success.html` |
| Legal name, address, KvK, VAT, phone | `terms.html` clause 1, all footers |
| Terms version date | bottom of `terms.html` |
| Engagement period (60 days) | `terms.html` clause 5.4 |
| Cities you cover | `index.html` and `nl.html` |
| Real testimonials | `index.html` and `nl.html` — the three there are placeholders |
| Pricing answer in the FAQ | `index.html` and `nl.html` |

## 4 · Read the note at the top of terms.html

`terms.html` opens with an HTML comment addressed to you. It flags the four clauses
that carry real risk if they are wrong for your actual business — in particular
**clause 4**, which commits you to being strictly tenant-side. Under Article 7:417(4)
of the Dutch Civil Code and the Wet goed verhuurderschap, you may not charge the tenant
a mediation fee if you also act for, or take money from, the landlord for the same
property. Your whole €50 model rests on that.

The document is a serious draft, not legal advice. Have a Dutch jurist read it before
you take a single payment.

## 5 · Publishing

```bash
git init && git add . && git commit -m "FastKeys site"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Or drag the HTML files into your repo on github.com → *Add file* → *Upload files*.
Each file is complete on its own, so this works.

Then **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save.**
Hard-refresh once after publishing (Ctrl/Cmd + Shift + R) — GitHub's CDN caches for a
few minutes.

**Custom domain:** add it under Settings → Pages, then at your registrar set `A` records
for `@` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`,
and a `CNAME` for `www` → `<you>.github.io`. Tick "Enforce HTTPS" afterwards.

A real domain matters more than usual here: people are about to hand over their salary
and savings figures and then pay you. `fastkeys.nl` earns that. `<username>.github.io`
does not.

## 6 · Notes on the application form

- The letter template you supplied is reproduced exactly, with one addition: a
  **situation** dropdown. Your template assumes a salaried professional
  (*"permanent contract"*), which does not fit a first-year student. The first
  financial line adapts — student, fixed-term, self-employed, intern — and the rest of
  the letter is unchanged.
- Optional lines (savings, guarantor, rent in advance) disappear from the letter when
  left blank, rather than printing an empty field.
- The three "no pets / non-smoker / no musical instruments" claims are tick boxes,
  because the line should not be there if it is not true. A landlord who discovers
  otherwise at the viewing ends the conversation there.
- Personality is capped at four words, as your template specifies.
- Amounts are formatted the Dutch way (€2.500) since Dutch landlords are reading them.
- The "For us only" box at the bottom never appears in the letter.
- `apply.html` and `terms.html` are English-only for now. The Dutch home page links
  through to them. Dutch versions can be added if you want them.

## 7 · Everything else

- Colours are taken from the logo: slate `#445162`, gold `#E0A35E`, off-white `#E5E5E5`.
- Fonts load from Google Fonts; if that fails the pages fall back to system fonts and
  still look deliberate.
- All motion switches off for anyone with "reduce motion" enabled. Keyboard navigable,
  no horizontal scroll down to 360px wide.
- `apply.html` and `success.html` are set to `noindex` so they stay out of search results.
