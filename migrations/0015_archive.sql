-- 0015 · archive instead of delete
--
-- Deleting a client used to be one confirmed click and the row was gone. There
-- is no undo for that, and no way afterwards to tell whether a missing client
-- was deleted, filtered out of view, or never existed.
--
-- Archiving is now the default: the row stays, drops out of the client list, and
-- can be restored. A real delete still exists for a genuine erasure request, but
-- it is a second, separate step on an already-archived record, so it cannot
-- happen by accident.

ALTER TABLE applications ADD COLUMN archived_at TEXT;
ALTER TABLE applications ADD COLUMN archived_by TEXT;
ALTER TABLE applications ADD COLUMN archive_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_applications_archived ON applications (archived_at);

-- The same for viewings and noticeboard listings, for the same reason.
ALTER TABLE viewings ADD COLUMN archived_at TEXT;
ALTER TABLE viewings ADD COLUMN archived_by TEXT;

ALTER TABLE listings ADD COLUMN archived_at TEXT;
ALTER TABLE listings ADD COLUMN archived_by TEXT;

-- A record of anything that really was destroyed, kept after the row is gone.
-- Without it there is no answer to "was this deleted, or did it never exist",
-- which is the question being asked right now.
CREATE TABLE IF NOT EXISTS deletion_log (
  id          TEXT PRIMARY KEY,
  entity      TEXT NOT NULL,          -- application | viewing | listing
  reference   TEXT NOT NULL,
  name        TEXT,
  email       TEXT,
  snapshot    TEXT,                   -- the whole row as JSON, before deletion
  deleted_by  TEXT NOT NULL,
  deleted_at  TEXT NOT NULL,
  reason      TEXT
);

CREATE INDEX IF NOT EXISTS idx_deletion_log_at ON deletion_log (deleted_at);
