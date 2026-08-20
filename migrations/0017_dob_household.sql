-- 0017 · date of birth and household as real columns
--
-- Both already live inside the JSON payload, which is where every other answer
-- lives. They are promoted to columns because they are the two things a
-- landlord asks about before anything else, so being able to filter and sort on
-- them without unpacking JSON is worth the two fields.
--
-- Nothing is forced on existing applicants. household backfills from the
-- payload because every application has always collected it; date_of_birth
-- stays NULL for everyone who applied before today, and NULL is the honest
-- answer to "what is their date of birth" when nobody ever asked.

ALTER TABLE applications ADD COLUMN date_of_birth TEXT;   -- YYYY-MM-DD, or NULL
ALTER TABLE applications ADD COLUMN household TEXT;       -- single | partner

UPDATE applications
   SET household = json_extract(payload, '$.household')
 WHERE household IS NULL
   AND json_valid(payload)
   AND json_extract(payload, '$.household') IS NOT NULL;

-- For the handful that may already carry one in the payload.
UPDATE applications
   SET date_of_birth = json_extract(payload, '$.date_of_birth')
 WHERE date_of_birth IS NULL
   AND json_valid(payload)
   AND json_extract(payload, '$.date_of_birth') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_applications_household ON applications (household);
