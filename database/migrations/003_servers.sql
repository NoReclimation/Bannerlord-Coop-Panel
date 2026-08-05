-- Shared game installations (per host, versioned paths on disk)
CREATE TABLE IF NOT EXISTS installations (
  id              TEXT PRIMARY KEY,
  host_id         UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  game_type       TEXT NOT NULL DEFAULT 'bannerlord-coop',
  game_version    TEXT NOT NULL,
  coop_commit     TEXT NOT NULL DEFAULT '',
  layout          TEXT NOT NULL DEFAULT 'layered-v1',
  path            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (host_id, path)
);

CREATE INDEX IF NOT EXISTS installations_host_idx ON installations (host_id);

-- Game server instances
CREATE TABLE IF NOT EXISTS servers (
  id                UUID PRIMARY KEY,
  name              TEXT NOT NULL,
  host_id           UUID NOT NULL REFERENCES hosts(id) ON DELETE RESTRICT,
  installation_id   TEXT NOT NULL REFERENCES installations(id) ON DELETE RESTRICT,
  game_type         TEXT NOT NULL DEFAULT 'bannerlord-coop',
  status            TEXT NOT NULL DEFAULT 'created'
                      CHECK (status IN (
                        'created', 'starting', 'running', 'stopping',
                        'stopped', 'crashed', 'unknown', 'error'
                      )),
  game_port         INTEGER NOT NULL,
  engine_port       INTEGER NOT NULL,
  container_id      TEXT,
  container_name    TEXT,
  save_name         TEXT NOT NULL DEFAULT 'saveauto1',
  password          TEXT NOT NULL DEFAULT '',
  autosave_minutes  INTEGER NOT NULL DEFAULT 5,
  log_file          BOOLEAN NOT NULL DEFAULT TRUE,
  last_restart_at   TIMESTAMPTZ,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (host_id, name),
  UNIQUE (host_id, game_port),
  UNIQUE (host_id, engine_port)
);

CREATE INDEX IF NOT EXISTS servers_host_idx ON servers (host_id);
CREATE INDEX IF NOT EXISTS servers_status_idx ON servers (status);
