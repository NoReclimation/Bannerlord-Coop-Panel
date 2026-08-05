-- Per-server scheduled tasks (API runner; agent executes actions)
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id                   UUID PRIMARY KEY,
  server_id            UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  schedule_kind        TEXT NOT NULL
                         CHECK (schedule_kind IN ('cron', 'interval', 'once')),
  cron_expr            TEXT,
  interval_minutes     INTEGER
                         CHECK (interval_minutes IS NULL OR interval_minutes >= 1),
  run_at               TIMESTAMPTZ,
  action               TEXT NOT NULL
                         CHECK (action IN ('restart', 'start', 'stop', 'command')),
  payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
  countdown_minutes    INTEGER[] NOT NULL DEFAULT '{}',
  countdown_message    TEXT NOT NULL DEFAULT 'say Server restarting in {minutes} minute(s)',
  countdown_fired      INTEGER[] NOT NULL DEFAULT '{}',
  last_run_at          TIMESTAMPTZ,
  next_run_at          TIMESTAMPTZ,
  last_error           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scheduled_tasks_server_idx
  ON scheduled_tasks (server_id);

CREATE INDEX IF NOT EXISTS scheduled_tasks_due_idx
  ON scheduled_tasks (enabled, next_run_at)
  WHERE enabled = TRUE;
