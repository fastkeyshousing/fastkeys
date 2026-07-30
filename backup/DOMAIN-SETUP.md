# Pointing fastkeyshousing.com at your site

Two routes. Pick one — don't do both.

---

## Route A — Namecheap DNS straight to GitHub Pages

Fastest. Ten minutes, live within the hour. Choose this if you want the domain
working today and you're not sure yet about Cloudflare.

### 1 · Put the files in your repo

Upload the whole folder, **including `CNAME`**. That file contains one line,
`fastkeyshousing.com`, and it is what tells GitHub which domain to answer on.

> GitHub creates this file automatically when you set a custom domain in Settings,
> but it deletes it if you later re-upload the repo without it. Since you upload
> through the web UI, keep `CNAME` in your local folder and it will survive.

### 2 · Namecheap: clear the parking records first

Domain List → **Manage** → **Advanced DNS**.

Namecheap ships every new domain with a `URL Redirect Record` on `@` and a
`CNAME` on `www` pointing at parkingpage.namecheap.com. **Delete both.** Leaving
them there is the single most common reason this setup fails.

### 3 · Add these records

| Type | Host | Value | TTL |
|---|---|---|---|
| A | @ | 185.199.108.153 | Automatic |
| A | @ | 185.199.109.153 | Automatic |
| A | @ | 185.199.110.153 | Automatic |
| A | @ | 185.199.111.153 | Automatic |
| AAAA | @ | 2606:50c0:8000::153 | Automatic |
| AAAA | @ | 2606:50c0:8001::153 | Automatic |
| AAAA | @ | 2606:50c0:8002::153 | Automatic |
| AAAA | @ | 2606:50c0:8003::153 | Automatic |
| CNAME | www | fastkeyshousing.github.io. | Automatic |

The AAAA records are optional but cheap, and some university networks are
IPv6-first. Note the trailing dot on the CNAME value.

### 4 · GitHub

Repo → **Settings** → **Pages** → **Custom domain** → `fastkeyshousing.com` → **Save**.
Wait for the DNS check to go green, then tick **Enforce HTTPS**. The certificate
can take 15 minutes to an hour; the tickbox stays greyed out until it's issued.

Your site then serves at `https://fastkeyshousing.com/` — the `/fastkeys/` path
disappears. Every internal link is relative, so nothing breaks.

---

## Route B — Move DNS to Cloudflare, keep hosting on GitHub

Half an hour. Choose this if you're going to add the Stripe Worker, which you are.

1. Cloudflare → **Add a site** → `fastkeyshousing.com` → Free plan. It scans your
   existing records.
2. Cloudflare gives you two nameservers, e.g. `xxx.ns.cloudflare.com`.
3. Namecheap → **Domain** tab → **Nameservers** → switch from *Namecheap BasicDNS*
   to **Custom DNS** → paste both. Propagation is usually under an hour.
4. In Cloudflare DNS, add the same records from the table above. Set the proxy
   toggle to **DNS only** (grey cloud) for now — GitHub needs to see the real
   request to issue its certificate. You can turn the orange cloud on afterwards.
5. Then GitHub → Settings → Pages → custom domain → Enforce HTTPS, as in Route A.

Why bother: when you add the Stripe Worker later, you attach it to a route like
`fastkeyshousing.com/api/*` and it lands on the same origin as the site. No CORS,
no second domain, no changes to `apply.html` beyond the endpoint URL. If you skip
this now you'll do it later anyway, with traffic already flowing.

---

## Once the domain is live

1. **Stripe** — change the Payment Link's redirect to
   `https://fastkeyshousing.com/success.html`. The old
   `fastkeyshousing.github.io` URL will still work but will look wrong to a
   customer mid-payment.
2. **Email** — you now own the domain, so `hello@fastkeyshousing.com` is real.
   Namecheap includes free email forwarding under Domain → Redirect Email; point
   it at your existing inbox. Then replace `hello@fastkeys.nl` everywhere in the
   HTML — it appears in all five pages and in the Terms.
3. **Terms** — clause 1 and the footer still say `hello@fastkeys.nl` and
   `KvK 00000000`.
4. **WhatsApp** — still `31600000000` on the live site.
5. **Facebook** — put the domain on the page so the two corroborate each other.
   Applicants will check.
6. **Search Console** — add the property and submit `sitemap.xml`. Free, and it's
   how you find out whether "student housing Maastricht" ever sends you anyone.

## What changed in the files

- `CNAME` — new, holds the domain.
- `og:image` is now absolute (`https://fastkeyshousing.com/og-image.png`).
  WhatsApp and Facebook will not resolve a relative one, so link previews were
  showing no picture.
- `og:url` and absolute `canonical` / `hreflang` on the three indexable pages, so
  Google doesn't treat the github.io and custom-domain versions as duplicates.
- `robots.txt` — allows the site, blocks `apply.html` and `success.html`.
- `sitemap.xml` — the three public pages with language alternates.

## A note on the name

`.com` is the right call for an audience that is mostly not Dutch. But Dutch
landlords and agents read `.nl` as "this is a real local business", and you'll be
emailing a lot of them. `fastkeyshousing.nl` is a few euros a year — worth
registering and redirecting to the `.com`, if only to stop someone else having it.
