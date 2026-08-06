-- Assign panel users to specific game servers (scoped visibility for role=user)

CREATE TABLE IF NOT EXISTS user_servers (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, server_id)
);

CREATE INDEX IF NOT EXISTS user_servers_server_idx ON user_servers (server_id);
CREATE INDEX IF NOT EXISTS user_servers_user_idx ON user_servers (user_id);
