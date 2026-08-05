-- Global panel settings (key/value JSON)
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default port settings (idempotent)
INSERT INTO settings (key, value)
VALUES (
  'ports',
  '{"gamePortBase": 4200, "enginePortBase": 7210}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
