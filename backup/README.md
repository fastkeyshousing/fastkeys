# FastKeys — website

Static site, no build step. English at `/`, Dutch at `/nl/`.

```
index.html        English page
nl/index.html     Dutch page
assets/
  style.css       shared — edit design here once, both pages update
  app.js          shared — animations, ticker, FAQ, floating WhatsApp button
  fastkeys-mark.png    house mark, transparent (nav, hero, footer)
  fastkeys-logo.png    full logo with wordmark, transparent
  favicon.png          512×512
  og-image.png         1200×630 social preview
```

The logo files were extracted from your screenshot with the slate background
removed, so they sit cleanly on any colour. If you have the original vector,
drop an `.svg` into `assets/` and swap the `<img src>` — it will look sharper.

## Fill these in before you publish

Every spot is marked `EDIT` in the HTML. Content changes must be made in **both**
`index.html` and `nl/index.html`; design changes only in `assets/style.css`.

1. **WhatsApp number** — appears 4× per page (nav button, hero button, contact
   card, floating button) plus once in the footer. Currently `31600000000`.
   Format: country code, no `+`, no spaces. The links pre-fill a first message
   ("Hi FastKeys! I'm looking for a room in …") so people don't stall on what to type.
2. **Email** — contact card and footer. Currently `hello@fastkeys.nl`.
3. **Form endpoint** — the form posts to `https://formspree.io/f/YOUR_FORM_ID`.
   Make a free form at formspree.io and paste the endpoint into `action=`.
   GitHub Pages is static and can't process form posts itself.
4. **Testimonials** — the three quotes in `#students` are **placeholders showing the
   right shape**. Replace them with real student words and get permission for each
   name. Only have one? Publish it and delete the other two. Have none? Delete the
   whole `<section id="students">` plus the "Students" links in the nav and footer.
5. **Cities** — trim to the ones you genuinely cover.
6. **Pricing FAQ** — "What does it cost?" is deliberately vague. Put your real model in.
7. **KvK number** — footer, currently `00000000`. Delete the line if not registered yet.

Deliberately left out: placement counts and student numbers. Add them once they're
real — this audience is already primed to expect scams, and an invented figure is
the fastest way to lose them.

## Publishing on GitHub Pages

```bash
git init
git add .
git commit -m "FastKeys site"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save**.
Live at `https://<you>.github.io/<repo>/` within a minute or two, with the Dutch page
at `/nl/`.

**Custom domain (worth it — `fastkeys.nl` reads far better on a flyer):**
add the domain under Settings → Pages, then at your registrar set

- `A` records for the apex `@` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
- `CNAME` for `www` → `<you>.github.io`

Tick "Enforce HTTPS" once the certificate is issued.

## Notes

- Two real pages rather than a JavaScript language toggle, so `/nl/` is a URL you can
  print on Dutch-language material and Google can index each language separately.
  `hreflang` tags are already in both `<head>`s.
- Fonts from Google Fonts: Bricolage Grotesque (headings), Instrument Sans (body),
  Cormorant Garamond (wordmark and pull quote, matching the logo's letterspacing).
- Colours come straight out of the logo: slate `#445162`, gold `#E0A35E`, off-white `#E5E5E5`.
- All motion switches off automatically for anyone with "reduce motion" enabled.
- Keyboard-navigable, no horizontal scroll down to 360px wide.
