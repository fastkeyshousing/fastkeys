#!/usr/bin/env node
/* Turns content/blog/posts.json into pages, an index, a sitemap and a feed.
 *
 *   npm run blog            build everything that is due
 *   npm run blog -- --all   include posts dated in the future, for previewing
 *
 * Scheduling works by date rather than by generation: a post with a future date
 * is written but left out of the index, the sitemap and the feed until its day
 * arrives. So you write a batch when you have something to say, and they appear
 * one at a time.
 *
 * That is deliberately not the same thing as generating a post a day. Google's
 * spam policies since March 2024 treat mass-produced content whose main purpose
 * is ranking as spam, whoever or whatever wrote it. Seven pages that answer a
 * question a student actually typed will outperform two hundred that do not,
 * and will not put the domain at risk.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SITE = 'https://fastkeyshousing.com';
const ALL = process.argv.includes('--all');
const today = new Date().toISOString().slice(0, 10);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* Body text may contain deliberate <strong> and <em>, so it is escaped and then
 * those two are put back, rather than trusting the input wholesale. */
const rich = (s) => esc(s)
  .replace(/&lt;(\/?)(strong|em)&gt;/g, '<$1$2>');

const posts = JSON.parse(readFileSync(new URL('../content/blog/posts.json', import.meta.url), 'utf8')).posts
  .sort((a, b) => b.date.localeCompare(a.date));

const live = posts.filter((p) => ALL || p.date <= today);
const scheduled = posts.filter((p) => p.date > today);

/* The shell is lifted from an existing page so the blog cannot drift away from
 * the rest of the site when the design changes. */
const shellSource = readFileSync(new URL('../public/terms.html', import.meta.url), 'utf8');
const HEAD = shellSource.slice(0, shellSource.indexOf('<main'));
const TAIL = shellSource.slice(shellSource.indexOf('</main>'));

const CSS = `
.bl-hero{padding-block:clamp(44px,6vw,74px) 0}
.bl-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:18px;
  margin-top:clamp(30px,4vw,46px)}
.bl-card{display:block; text-decoration:none; background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.1); border-radius:18px; padding:24px 26px;
  transition:border-color .2s, transform .2s}
.bl-card:hover{border-color:rgba(224,163,94,.45); transform:translateY(-2px)}
.bl-date{font-size:12px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--key)}
.bl-card h2{font-family:var(--display); font-size:21px; font-weight:500; letter-spacing:-.015em;
  line-height:1.3; color:#fff; margin:10px 0 9px}
.bl-card p{font-size:14.6px; line-height:1.6; color:rgba(237,239,242,.66)}
.bl-read{margin-top:14px; font-size:13px; color:rgba(237,239,242,.42)}
.bl-post{max-width:720px; padding-block:clamp(40px,5vw,66px) clamp(60px,8vw,100px)}
.bl-post h1{font-family:var(--display); font-size:clamp(30px,4.4vw,46px); font-weight:500;
  letter-spacing:-.025em; line-height:1.12; margin:14px 0 18px}
.bl-meta{font-size:13.5px; color:rgba(237,239,242,.45)}
.bl-post h2{font-family:var(--display); font-size:clamp(21px,2.6vw,27px); font-weight:500;
  letter-spacing:-.02em; margin:38px 0 14px; color:#fff}
.bl-post p{font-size:16.5px; line-height:1.72; color:rgba(237,239,242,.78); margin-bottom:17px}
.bl-post ul,.bl-post ol{margin:0 0 20px 0; padding-left:22px}
.bl-post li{font-size:16.5px; line-height:1.68; color:rgba(237,239,242,.78); margin-bottom:10px}
.bl-post strong{color:#fff; font-weight:650}
.bl-call{background:rgba(224,163,94,.1); border:1px solid rgba(224,163,94,.3);
  border-left:3px solid var(--key); border-radius:12px; padding:18px 22px; margin:24px 0}
.bl-call p{margin:0; font-size:15.5px; color:rgba(237,239,242,.85)}
.bl-cta{margin-top:44px; padding:26px 28px; border-radius:18px;
  background:linear-gradient(158deg,rgba(224,163,94,.15),rgba(224,163,94,.04));
  border:1px solid rgba(224,163,94,.4)}
.bl-cta h3{font-family:var(--display); font-size:23px; font-weight:500; color:#fff; margin-bottom:9px}
.bl-cta p{font-size:15.3px; margin-bottom:18px}
.bl-back{display:inline-block; margin-top:34px; font-size:14.5px; color:var(--key); text-decoration:none}
.bl-back:hover{text-decoration:underline}
.bl-next{margin-top:44px; padding-top:26px; border-top:1px solid rgba(255,255,255,.1)}
.bl-next h3{font-size:12px; font-weight:700; letter-spacing:.11em; text-transform:uppercase;
  color:var(--key); margin-bottom:12px}
.bl-next a{display:block; color:rgba(237,239,242,.8); text-decoration:none; padding:7px 0; font-size:15.3px}
.bl-next a:hover{color:var(--key)}
`;

function page({ title, description, canonical, body, jsonld }) {
  let out = HEAD + body + TAIL;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description" content="[^"]*"/,
    `<meta name="description" content="${esc(description)}"`);
  out = out.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${canonical}">`);
  out = out.replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${esc(title)}"`);
  out = out.replace(/<meta property="og:description" content="[^"]*"/,
    `<meta property="og:description" content="${esc(description)}"`);
  out = out.replace(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${canonical}"`);
  if (!/<link rel="canonical"/.test(out)) {
    out = out.replace('</head>', `<link rel="canonical" href="${canonical}">\n</head>`);
  }
  if (jsonld) {
    out = out.replace('</head>',
      `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n</head>`);
  }
  out = out.replace('</style>', CSS + '</style>');
  return out;
}

function readable(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB',
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function renderBody(blocks) {
  return blocks.map(([kind, value]) => {
    if (kind === 'p') return `      <p>${rich(value)}</p>`;
    if (kind === 'h2') return `      <h2>${esc(value)}</h2>`;
    if (kind === 'callout') return `      <div class="bl-call"><p>${rich(value)}</p></div>`;
    if (kind === 'ul') return `      <ul>\n${value.map((i) => `        <li>${rich(i)}</li>`).join('\n')}\n      </ul>`;
    if (kind === 'ol') return `      <ol>\n${value.map((i) => `        <li>${rich(i)}</li>`).join('\n')}\n      </ol>`;
    return '';
  }).join('\n');
}

/* ------------------------------------------------------------------ posts -- */
let written = 0;
for (const post of posts) {
  const canonical = `${SITE}/blog/${post.slug}`;
  const others = live.filter((p) => p.slug !== post.slug).slice(0, 3);

  const body = `<main class="wrap bl-post">
      <p class="bl-meta"><a href="/blog" style="color:var(--key);text-decoration:none">&larr; All articles</a></p>
      <h1>${esc(post.title)}</h1>
      <p class="bl-meta">${readable(post.date)} &middot; ${post.readMins} minute read</p>

${renderBody(post.body)}

      <div class="bl-cta">
        <h3>Looking for a place in Maastricht?</h3>
        <p>We search, apply and negotiate on your behalf, and read the contract before you sign.
        You pay nothing until you have signed a lease we found you.</p>
        <a class="btn btn-key" href="/apply">Start your application <span class="arw">&rarr;</span></a>
      </div>

      ${others.length ? `<div class="bl-next"><h3>More for new arrivals</h3>
      ${others.map((o) => `<a href="/blog/${o.slug}">${esc(o.title)}</a>`).join('\n      ')}
      </div>` : ''}
    </main>
`;

  writeFileSync(new URL(`../public/blog/${post.slug}.html`, import.meta.url), page({
    title: `${post.title} | FastKeys`,
    description: post.description,
    canonical,
    body,
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.date,
      author: { '@type': 'Organization', name: 'FastKeys', url: SITE },
      publisher: { '@type': 'Organization', name: 'FastKeys', url: SITE },
      mainEntityOfPage: canonical,
      inLanguage: 'en',
    },
  }));
  written++;
}

/* ------------------------------------------------------------------ index -- */
const indexBody = `<main id="main">
    <div class="wrap page-head bl-hero">
      <p class="eyebrow" data-rev><span></span>Guides</p>
      <h1 data-rev>Getting started in Maastricht.</h1>
      <p class="vw-lead" data-rev style="max-width:640px">
        Short, practical guides for international students arriving in the Netherlands.
        Written by people who do this every week, and kept current because the rules change.
      </p>
    </div>
    <section class="wrap" style="padding-bottom:clamp(60px,8vw,110px)">
      <div class="bl-grid">
${live.map((p) => `        <a class="bl-card" href="/blog/${p.slug}" data-rev>
          <span class="bl-date">${readable(p.date)}</span>
          <h2>${esc(p.title)}</h2>
          <p>${esc(p.description)}</p>
          <p class="bl-read">${p.readMins} minute read &rarr;</p>
        </a>`).join('\n')}
      </div>
    </section>
  </main>
`;

writeFileSync(new URL('../public/blog.html', import.meta.url), page({
  title: 'Guides for international students in Maastricht | FastKeys',
  description: 'Practical guides for international students arriving in Maastricht: registering for a BSN, huurtoeslag, bikes, furniture, food and surviving your first Dutch winter.',
  canonical: `${SITE}/blog`,
  body: indexBody,
  jsonld: {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'FastKeys guides',
    url: `${SITE}/blog`,
    description: 'Practical guides for international students in Maastricht.',
  },
}));

/* --------------------------------------------------------- sitemap and feed */
const staticPages = ['/', '/nl', '/apply', '/viewings', '/bezichtigingen', '/book-viewing', '/blog', '/terms'];
writeFileSync(new URL('../public/sitemap.xml', import.meta.url),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">
${staticPages.map((u) => `  <url><loc>${SITE}${u}</loc><changefreq>weekly</changefreq></url>`).join('\n')}
${live.map((p) => `  <url><loc>${SITE}/blog/${p.slug}</loc><lastmod>${p.date}</lastmod><changefreq>monthly</changefreq></url>`).join('\n')}
</urlset>
`.replace('www.sitemap.org', 'www.sitemaps.org'));

writeFileSync(new URL('../public/feed.xml', import.meta.url),
`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>FastKeys guides</title>
  <link>${SITE}/blog</link>
  <description>Practical guides for international students in Maastricht.</description>
  <language>en</language>
${live.map((p) => `  <item>
    <title>${esc(p.title)}</title>
    <link>${SITE}/blog/${p.slug}</link>
    <guid>${SITE}/blog/${p.slug}</guid>
    <pubDate>${new Date(`${p.date}T09:00:00Z`).toUTCString()}</pubDate>
    <description>${esc(p.description)}</description>
  </item>`).join('\n')}
</channel></rss>
`);

writeFileSync(new URL('../public/robots.txt', import.meta.url),
`User-agent: *
Allow: /
Disallow: /panel
Disallow: /api/

Sitemap: ${SITE}/sitemap.xml
`);

console.log(`\n  ${written} post page(s) written`);
console.log(`  ${live.length} live in the index, sitemap and feed`);
if (scheduled.length) {
  console.log(`  ${scheduled.length} scheduled and held back:`);
  for (const p of scheduled) console.log(`    ${p.date}  ${p.slug}`);
}
console.log();
