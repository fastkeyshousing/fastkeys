-- 0010 · case status and a log of every email sent
--
-- Two additions.
--
-- 1. case_closed. A toggle rather than a status, deliberately: the payment
--    status says what happened with money and must keep saying it. Whether we
--    found somebody a house is a different question, and overloading 'status'
--    would mean losing the answer to the first one.
--
-- 2. email_log. Until now each kind of email had its own column, which worked
--    while there were two kinds. There are now four and the next one is always
--    coming, so this is a table: one row per send, with what was sent, to whom,
--    by whom and whether it worked.

ALTER TABLE applications ADD COLUMN case_closed_at TEXT;
ALTER TABLE applications ADD COLUMN case_closed_by TEXT;
ALTER TABLE applications ADD COLUMN case_note TEXT;

CREATE TABLE IF NOT EXISTS email_log (
  id           TEXT PRIMARY KEY,
  reference    TEXT NOT NULL,          -- FK- or FV-
  kind         TEXT NOT NULL,          -- confirmation | receipt | reminder | property | custom
  subject      TEXT NOT NULL,
  recipient    TEXT NOT NULL,
  sent_by      TEXT NOT NULL,          -- panel account, or 'system' for the webhook
  sent_at      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error        TEXT,
  provider_id  TEXT,                   -- Resend's id, for tracing a bounce
  meta         TEXT                    -- kind-specific detail, as JSON
);

CREATE INDEX IF NOT EXISTS idx_email_log_ref  ON email_log (reference, sent_at);
CREATE INDEX IF NOT EXISTS idx_email_log_kind ON email_log (kind, sent_at);
