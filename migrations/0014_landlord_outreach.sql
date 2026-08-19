-- 0014 · landlord outreach
--
-- email_log's kind is a CHECK constraint, and SQLite cannot alter one in place,
-- so the table is rebuilt to admit 'landlord'. It is a log, so a rebuild is
-- cheap and loses nothing.
--
-- Also a record of who we approached about what, for whom. Without it, "have we
-- already written to this agency about this flat for Marta" is a question only
-- somebody's memory answers, and writing twice looks careless to the one person
-- whose goodwill the whole thing depends on.

CREATE TABLE email_log_v2 (
  id           TEXT PRIMARY KEY,
  reference    TEXT NOT NULL,
  kind         TEXT NOT NULL,          -- no CHECK: new kinds should not need a migration
  subject      TEXT NOT NULL,
  recipient    TEXT NOT NULL,
  sent_by      TEXT NOT NULL,
  sent_at      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error        TEXT,
  provider_id  TEXT,
  meta         TEXT
);

INSERT INTO email_log_v2
  SELECT id, reference, kind, subject, recipient, sent_by, sent_at, status, error, provider_id, meta
    FROM email_log;

DROP TABLE email_log;
ALTER TABLE email_log_v2 RENAME TO email_log;

CREATE INDEX IF NOT EXISTS idx_email_log_ref  ON email_log (reference, sent_at);
CREATE INDEX IF NOT EXISTS idx_email_log_kind ON email_log (kind, sent_at);

-- Who we approached, about which property, for which client.
CREATE TABLE IF NOT EXISTS landlord_outreach (
  id              TEXT PRIMARY KEY,
  reference        TEXT NOT NULL,          -- the FK- client this was for
  recipient        TEXT NOT NULL,          -- landlord or agency email
  recipient_name   TEXT,
  address          TEXT NOT NULL,
  listing_id       TEXT,                   -- optional link to a noticeboard listing
  incentive        TEXT,                   -- exactly what was offered, in words
  meeting_proposed TEXT,                   -- the slots we put forward
  status           TEXT NOT NULL DEFAULT 'sent'
                     CHECK (status IN ('sent','replied','meeting_booked','declined','no_response')),
  reply_note       TEXT,
  sent_by          TEXT NOT NULL,
  sent_at          TEXT NOT NULL,
  updated_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_outreach_ref    ON landlord_outreach (reference, sent_at);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON landlord_outreach (status, sent_at);
