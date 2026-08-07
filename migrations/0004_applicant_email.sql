-- 0004 · record the confirmation email sent to the applicant
--
-- Separate from notified_at, which tracks whether the application reached the
-- operator. These two fail independently: Telegram can be up while the email
-- provider is down, and treating them as one flag would hide that.
--
-- Nullable and additive, so no table rebuild.

ALTER TABLE applications ADD COLUMN applicant_emailed_at TEXT;
ALTER TABLE applications ADD COLUMN receipt_url TEXT;
