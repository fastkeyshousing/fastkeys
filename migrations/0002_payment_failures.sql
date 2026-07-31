-- 0002 · record asynchronous payment failures
--
-- Delayed payment methods settle after the checkout page is done with. Stripe
-- sends checkout.session.completed straight away with payment_status 'unpaid',
-- then later either async_payment_succeeded or async_payment_failed. This
-- matters here: SEPA Direct Debit and bank transfer both behave this way, and
-- they are ordinary choices for a Dutch applicant.
--
-- Without a 'failed' status the second case is indistinguishable from someone
-- who wandered off mid-checkout. The row sits at 'pending', the applicant is
-- told indefinitely that we are still confirming, and nobody is told the
-- payment bounced.
--
-- SQLite cannot alter a CHECK constraint in place, so the table is rebuilt.
-- Columns are listed explicitly rather than using SELECT *, so the copy cannot
-- silently misalign.

CREATE TABLE applications_v2 (
  id                    TEXT PRIMARY KEY,
  reference             TEXT NOT NULL UNIQUE,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL,
  payload               TEXT NOT NULL,
  letter                TEXT NOT NULL,
  stripe_session_id     TEXT UNIQUE,
  stripe_payment_intent TEXT,
  amount_total          INTEGER,
  currency              TEXT,
  created_at            TEXT NOT NULL,
  paid_at               TEXT,
  failed_at             TEXT,
  failure_reason        TEXT,
  notified_at           TEXT,
  ip_hash               TEXT
);

INSERT INTO applications_v2
  (id, reference, status, name, email, payload, letter, stripe_session_id,
   stripe_payment_intent, amount_total, currency, created_at, paid_at,
   failed_at, failure_reason, notified_at, ip_hash)
SELECT
   id, reference, status, name, email, payload, letter, stripe_session_id,
   stripe_payment_intent, amount_total, currency, created_at, paid_at,
   NULL, NULL, notified_at, ip_hash
FROM applications;

DROP TABLE applications;

ALTER TABLE applications_v2 RENAME TO applications;

-- Indexes belonged to the old table and went with it.
CREATE INDEX IF NOT EXISTS idx_applications_session ON applications (stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_applications_status  ON applications (status, created_at);
CREATE INDEX IF NOT EXISTS idx_applications_paid    ON applications (paid_at);
