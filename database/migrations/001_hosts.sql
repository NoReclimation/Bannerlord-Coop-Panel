-- Host / node registry (Management Agents)
CREATE TABLE IF NOT EXISTS hosts (
  id              UUID PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  endpoint        TEXT NOT NULL DEFAULT '',
  data_root       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'offline'
                    CHECK (status IN ('online', 'offline', 'disabled')),
  agent_token_hash TEXT NOT NULL,
  capabilities    JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hosts_status_idx ON hosts (status);
