-- FastKeys application store.
-- Create the database with --location=weur so the data stays in the EEA, as the
-- Terms promise. Jurisdiction is fixed at creation and cannot be changed later.

CREATE TABLE IF NOT EXISTS applications (
  id                    TEXT PRIMARY KEY,          -- uuid, also Stripe metadata.application_id
  reference             TEXT NOT NULL UNIQUE,      -- FK-XXXXX-XXX, shown to the applicant
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'paid', 'expired')),
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL,
  payload               TEXT NOT NULL,             -- validated application as JSON
  letter                TEXT NOT NULL,             -- letter rebuilt server-side
  stripe_session_id     TEXT UNIQUE,
  stripe_payment_intent TEXT,
  amount_total          INTEGER,                   -- cents, as charged
  currency              TEXT,
  created_at            TEXT NOT NULL,
  paid_at               TEXT,
  notified_at           TEXT,                      -- null means delivery still owed
  ip_hash               TEXT                       -- salted hash, not an address
);

CREATE INDEX IF NOT EXISTS idx_applications_session ON applications (stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_applications_status  ON applications (status, created_at);
CREATE INDEX IF NOT EXISTS idx_applications_paid    ON applications (paid_at);

-- Replay guard. A Stripe signature stays valid for its whole tolerance window,
-- so the event id is what stops the same event being applied twice inside it.
CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);
