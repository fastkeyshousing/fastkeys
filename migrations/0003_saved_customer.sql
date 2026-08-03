-- 0003 · remember where the card was saved
--
-- The EUR 1.00 confirmation is not revenue, it is the moment a card gets saved.
-- Checkout now runs with customer_creation=always and setup_future_usage=
-- off_session, so every confirmed application leaves behind a Stripe Customer
-- holding a reusable payment method.
--
-- Without this column that Customer is only findable by hand, by searching the
-- dashboard for an email or a reference at the moment the service fee falls
-- due. That is weeks or months after the confirmation, across a growing pile of
-- applicants, and precisely when nobody wants to be doing archaeology. Writing
-- it down at webhook time costs nothing and makes the fee billable straight
-- from the application row.
--
-- The PaymentMethod itself is deliberately not duplicated here. It hangs off
-- the Customer, Stripe keeps it current when a card is replaced or updated by
-- the issuer, and a copy taken today would be the stale one by the time it
-- matters.
--
-- Nullable, because every row written before this migration completed checkout
-- as a guest and never had a Customer. Adding a nullable column does not
-- rewrite the table, so unlike 0002 there is no rebuild here.

ALTER TABLE applications ADD COLUMN stripe_customer TEXT;

CREATE INDEX IF NOT EXISTS idx_applications_customer ON applications (stripe_customer);
