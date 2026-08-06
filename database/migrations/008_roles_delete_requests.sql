-- Rename viewer → user; delete-approval queue; playtime identity columns

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE t.relname = 'users'
      AND n.nspname = 'public'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

UPDATE users SET role = 'user' WHERE role = 'viewer';

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'moderator', 'user'));

CREATE TABLE IF NOT EXISTS server_delete_requests (
  id            UUID PRIMARY KEY,
  server_id     UUID REFERENCES servers(id) ON DELETE SET NULL,
  server_name   TEXT,
  requested_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS server_delete_requests_pending_server_uidx
  ON server_delete_requests (server_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS server_delete_requests_status_idx
  ON server_delete_requests (status, created_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'playtime_sessions'
  ) THEN
    ALTER TABLE playtime_sessions ADD COLUMN IF NOT EXISTS hero_id TEXT;
    ALTER TABLE playtime_sessions ADD COLUMN IF NOT EXISTS controller_id TEXT;
  END IF;
END $$;
