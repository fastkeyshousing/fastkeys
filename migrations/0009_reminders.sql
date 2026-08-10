-- 0009 · track payment reminders
--
-- Separate from applicant_emailed_at, which records the confirmation somebody
-- gets after paying. A reminder is the opposite message to the opposite person,
-- and collapsing the two would make "have we chased them" unanswerable.
--
-- The count matters as much as the timestamp. One nudge is a service; three is
-- harassment, and without a counter nothing stops a second person pressing the
-- button an hour after the first.

ALTER TABLE applications ADD COLUMN reminder_sent_at TEXT;
ALTER TABLE applications ADD COLUMN reminder_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE applications ADD COLUMN reminder_sent_by TEXT;

ALTER TABLE viewings ADD COLUMN reminder_sent_at TEXT;
ALTER TABLE viewings ADD COLUMN reminder_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE viewings ADD COLUMN reminder_sent_by TEXT;
