-- Additive: legacy users, credentials and all training records are retained.
ALTER TABLE credentials ADD username text;
CREATE UNIQUE INDEX credentials_username_unique ON credentials(username COLLATE NOCASE);

CREATE TABLE "team_registration" (
  club_id text PRIMARY KEY NOT NULL REFERENCES clubs(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  enabled integer NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  expires_at integer,
  created_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE "password_resets" (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  expires_at integer NOT NULL,
  consumed_at integer,
  claim text,
  created_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at integer NOT NULL
);
CREATE INDEX password_resets_user_idx ON password_resets(user_id,expires_at);

-- Atomic fixed-window limits, independent of legacy auth throttles.
CREATE TABLE "auth_limits" (
  bucket text PRIMARY KEY NOT NULL,
  window_start integer NOT NULL,
  attempts integer NOT NULL
);
