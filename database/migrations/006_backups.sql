-- Backup metadata (archives live under {dataRoot}/backups/<serverId>/)
CREATE TABLE IF NOT EXISTS backups (
  id           UUID PRIMARY KEY,
  server_id    UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  size_bytes   BIGINT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS backups_server_idx
  ON backups (server_id, created_at DESC);

-- Allow scheduled backup actions
ALTER TABLE scheduled_tasks DROP CONSTRAINT IF EXISTS scheduled_tasks_action_check;
ALTER TABLE scheduled_tasks
  ADD CONSTRAINT scheduled_tasks_action_check
  CHECK (action IN ('restart', 'start', 'stop', 'command', 'backup'));

-- Retention setting (keep last N per server)
INSERT INTO settings (key, value)
VALUES ('backups', '{"retentionCount": 10}'::jsonb)
ON CONFLICT (key) DO NOTHING;
