-- 0007 · accounts for the hosted admin panel
--
-- Passwords are stored as PBKDF2-HMAC-SHA256 with a per-user random salt. Never
-- the password, never anything reversible.
--
-- Sessions live here rather than in a signed cookie so that logging someone out
-- actually logs them out. A stateless token cannot be revoked before it expires,
-- which is the wrong property for a panel holding applicants' financial details
-- when somebody leaves.

CREATE TABLE IF NOT EXISTS admin_users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,       -- stored lowercase
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  password_hash  TEXT NOT NULL,              -- hex
  salt           TEXT NOT NULL,              -- hex
  iterations     INTEGER NOT NULL,
  disabled       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  last_login_at  TEXT,
  must_change    INTEGER NOT NULL DEFAULT 0  -- set on a password issued by someone else
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id          TEXT PRIMARY KEY,              -- sha256 of the cookie value, never the value
  user_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  last_seen_at TEXT,
  ip_hash     TEXT,
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user    ON admin_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions (expires_at);
