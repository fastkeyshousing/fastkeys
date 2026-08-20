-- 0016 · where a listing came from
--
-- Provenance, recorded at the moment of import rather than remembered later.
--
-- If a listing is on the site because somebody gave permission, that permission
-- is the only thing standing between "we were asked to share this" and "we
-- copied it". A note naming who agreed and when costs one field and is the
-- difference between an easy conversation and an awkward one.

ALTER TABLE listings ADD COLUMN source TEXT;            -- facebook | renthunter | manual | other
ALTER TABLE listings ADD COLUMN source_url TEXT;
ALTER TABLE listings ADD COLUMN source_note TEXT;       -- who gave permission, when
ALTER TABLE listings ADD COLUMN imported_at TEXT;

CREATE INDEX IF NOT EXISTS idx_listings_source ON listings (source, imported_at);
