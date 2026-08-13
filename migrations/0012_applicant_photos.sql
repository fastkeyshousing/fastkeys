-- 0012 · applicant photos
--
-- A photo is a document, so it goes in the same table rather than a new one:
-- same bucket, same access rules, same deletion path. This only adds the kind
-- so the panel can separate photos from paperwork when it displays them.
--
-- The existing 'kind' column already accepts free text, so nothing structural
-- changes. This migration exists to record the decision and to backfill any
-- image already uploaded as 'other', which is where photos would have landed
-- before the applicant was asked for them.

UPDATE documents
   SET kind = 'photo'
 WHERE kind = 'other'
   AND content_type LIKE 'image/%';
