-- 0008 · index of uploaded documents
--
-- The files themselves go to R2, not here. D1 is a SQL database: putting a
-- passport scan in it means base64 in a row, no streaming, no range requests,
-- and a database you can no longer export or back up casually. R2 is object
-- storage and is the right shape for this.
--
-- What lives here is the index: which file belongs to whom, who uploaded it,
-- when, and what it is. That makes listing and deletion a database operation and
-- keeps the bucket a dumb store.

CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  reference     TEXT NOT NULL,            -- FK- or FV-
  r2_key        TEXT NOT NULL UNIQUE,     -- documents/<reference>/<id>-<name>
  filename      TEXT NOT NULL,            -- as shown, already sanitised
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT,                     -- so a re-upload can be spotted
  kind          TEXT,                     -- passport, payslip, enrolment, other
  uploaded_by   TEXT NOT NULL,            -- admin email, for the audit trail
  uploaded_at   TEXT NOT NULL,
  deleted_at    TEXT                      -- soft delete; the object is removed too
);

CREATE INDEX IF NOT EXISTS idx_documents_reference ON documents (reference, uploaded_at);
