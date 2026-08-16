-- 0013 · the public noticeboard
--
-- Deliberately shaped so the site can be shown to function as an "elektronisch
-- prikbord" rather than an agency window, which is the exception the Hoge Raad
-- left open in Duinzigt (ECLI:NL:HR:2015:3099). Three columns carry that:
--
--   1. submitted_by records who put it here. Listings come FROM landlords and
--      students; they are not gathered BY us.
--   2. contact_* is the lister's own detail, shown publicly, so a reader deals
--      with them directly rather than through us.
--   3. There is no price, commission or payment column, and there must never be
--      one. The moment a lister pays to appear, the noticeboard becomes an
--      agency relationship and the tenant-paid fee becomes unlawful and
--      reclaimable for five years.

CREATE TABLE IF NOT EXISTS listings (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  address        TEXT NOT NULL,
  city           TEXT NOT NULL DEFAULT 'Maastricht',
  rent           TEXT,
  deposit        TEXT,
  available_from TEXT,
  size           TEXT,
  rooms          TEXT,
  furnished      TEXT,
  registration   TEXT,
  description    TEXT,
  images         TEXT,                   -- JSON array of URLs

  submitted_by   TEXT NOT NULL DEFAULT 'landlord'
                   CHECK (submitted_by IN ('landlord', 'student', 'agency')),
  contact_name   TEXT,
  contact_email  TEXT,
  contact_phone  TEXT,
  external_url   TEXT,

  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'published', 'taken', 'expired')),
  published_at   TEXT,
  expires_at     TEXT,
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  updated_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings (status, published_at);
CREATE INDEX IF NOT EXISTS idx_listings_slug   ON listings (slug);
