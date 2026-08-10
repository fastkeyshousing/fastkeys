-- 0006 · the address becomes the required field, not the listing link
--
-- Plenty of properties circulate only in Facebook groups or by message, so
-- requiring a public URL turned away exactly the viewings people most need help
-- with. The address is what we actually navigate to, so it carries the
-- requirement instead.
--
-- SQLite cannot drop a NOT NULL constraint in place, so the table is rebuilt.
-- Existing rows keep their URL and get it copied into the address column, which
-- is wrong-ish but visible: better than a blank address on a row that predates
-- the change, and there are few enough to correct by hand in the admin.

CREATE TABLE viewings_v2 (
  id                    TEXT PRIMARY KEY,
  reference             TEXT NOT NULL UNIQUE,
  service               TEXT NOT NULL CHECK (service IN ('online', 'express')),
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'paid', 'expired', 'failed', 'refunded')),
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone                 TEXT NOT NULL,
  property_address      TEXT NOT NULL,
  property_url          TEXT,
  attendance            TEXT CHECK (attendance IN ('live', 'recorded')),
  payload               TEXT NOT NULL,
  application_reference TEXT,
  stripe_session_id     TEXT UNIQUE,
  stripe_payment_intent TEXT,
  amount_total          INTEGER,
  currency              TEXT,
  receipt_url           TEXT,
  created_at            TEXT NOT NULL,
  paid_at               TEXT,
  failed_at             TEXT,
  scheduled_for         TEXT,
  attended_at           TEXT,
  notified_at           TEXT,
  requester_emailed_at  TEXT,
  ip_hash               TEXT
);

INSERT INTO viewings_v2
  (id, reference, service, status, name, email, phone, property_address, property_url,
   attendance, payload, application_reference, stripe_session_id, stripe_payment_intent,
   amount_total, currency, receipt_url, created_at, paid_at, failed_at, scheduled_for,
   attended_at, notified_at, requester_emailed_at, ip_hash)
SELECT
   id, reference, service, status, name, email, phone,
   COALESCE(json_extract(payload, '$.property_address'), property_url, 'unknown'),
   property_url,
   json_extract(payload, '$.attendance'),
   payload, application_reference, stripe_session_id, stripe_payment_intent,
   amount_total, currency, receipt_url, created_at, paid_at, failed_at, scheduled_for,
   attended_at, notified_at, requester_emailed_at, ip_hash
FROM viewings;

DROP TABLE viewings;
ALTER TABLE viewings_v2 RENAME TO viewings;

CREATE INDEX IF NOT EXISTS idx_viewings_session ON viewings (stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_viewings_status  ON viewings (status, created_at);
CREATE INDEX IF NOT EXISTS idx_viewings_appref  ON viewings (application_reference);
