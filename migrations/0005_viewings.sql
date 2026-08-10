-- 0005 · paid viewing requests
--
-- Kept in its own table rather than bolted onto applications. A viewing is a
-- different thing with a different life: it is bought per property, it can be
-- bought by somebody who never applied, and one person may buy several. Forcing
-- it into the applications table would mean a row that is half application and
-- half errand, and every query would have to know which half it was looking at.

CREATE TABLE IF NOT EXISTS viewings (
  id                    TEXT PRIMARY KEY,
  reference             TEXT NOT NULL UNIQUE,      -- FV-XXXXX-XXX, distinct from FK-
  service               TEXT NOT NULL CHECK (service IN ('online', 'express')),
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'paid', 'expired', 'failed', 'refunded')),

  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone                 TEXT NOT NULL,
  property_url          TEXT NOT NULL,             -- the listing; the whole point of the request
  payload               TEXT NOT NULL,             -- validated request as JSON

  application_reference TEXT,                      -- optional link to an FK- application

  stripe_session_id     TEXT UNIQUE,
  stripe_payment_intent TEXT,
  amount_total          INTEGER,
  currency              TEXT,
  receipt_url           TEXT,

  created_at            TEXT NOT NULL,
  paid_at               TEXT,
  failed_at             TEXT,
  scheduled_for         TEXT,                      -- when we agreed to attend
  attended_at           TEXT,                      -- filled in once we have been
  notified_at           TEXT,
  requester_emailed_at  TEXT,
  ip_hash               TEXT
);

CREATE INDEX IF NOT EXISTS idx_viewings_session ON viewings (stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_viewings_status  ON viewings (status, created_at);
CREATE INDEX IF NOT EXISTS idx_viewings_appref  ON viewings (application_reference);
