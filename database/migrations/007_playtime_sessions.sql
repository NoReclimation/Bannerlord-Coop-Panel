-- Per-player play sessions parsed from DedicatedServer / Coop console lines
CREATE TABLE IF NOT EXISTS playtime_sessions (
  id            UUID PRIMARY KEY,
  server_id     UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  peer_id       INTEGER,
  player_name   TEXT NOT NULL,
  party_name    TEXT,
  address       TEXT,
  joined_at     TIMESTAMPTZ NOT NULL,
  left_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS playtime_sessions_server_joined_idx
  ON playtime_sessions (server_id, joined_at DESC);

CREATE INDEX IF NOT EXISTS playtime_sessions_server_open_idx
  ON playtime_sessions (server_id)
  WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS playtime_sessions_server_name_idx
  ON playtime_sessions (server_id, player_name, joined_at DESC);
