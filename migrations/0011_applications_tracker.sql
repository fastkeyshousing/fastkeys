-- 0011 · a record of the properties we applied to, on whose behalf
--
-- This is the operational core of the business and until now it lived nowhere:
-- which flat, for which client, what happened. Without it, "have we already
-- applied to this one for Marta" is a question only somebody's memory can
-- answer, and two people working the same list will duplicate each other.
--
-- Kept separate from the applicant record because it is many-to-many in
-- practice: one client gets applied to many properties, and one property may be
-- offered to several clients before somebody takes it.

CREATE TABLE IF NOT EXISTS property_applications (
  id              TEXT PRIMARY KEY,
  reference       TEXT NOT NULL,          -- FK- of the client we applied for
  address         TEXT NOT NULL,
  listing_url     TEXT,
  rent            TEXT,
  deposit         TEXT,
  available_from  TEXT,
  landlord        TEXT,                   -- agency or private landlord
  landlord_email  TEXT,
  landlord_phone  TEXT,

  -- The pipeline, in the order it actually happens.
  status          TEXT NOT NULL DEFAULT 'applied'
                    CHECK (status IN ('shortlisted','applied','viewing_booked','viewed',
                                      'offered','accepted','rejected','withdrawn','gone')),
  applied_at      TEXT,
  viewing_at      TEXT,
  decision_at     TEXT,
  outcome_note    TEXT,                   -- why it was rejected, what the landlord said

  notes           TEXT,
  created_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  updated_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_propapp_ref    ON property_applications (reference, created_at);
CREATE INDEX IF NOT EXISTS idx_propapp_status ON property_applications (status, created_at);
