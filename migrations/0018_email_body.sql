-- 0018 · keep what was sent, not just that it was sent
--
-- email_log recorded the subject, the recipient and the outcome, which answers
-- "did we email them" but not "what did we say". The plain-text body is now
-- stored with every send, so the panel's Sent view can show the actual email.
--
-- Plain text rather than HTML: it is the same words without the branding
-- wrapper, it is a fraction of the size, and it reads fine in a <pre>.

ALTER TABLE email_log ADD COLUMN body TEXT;
