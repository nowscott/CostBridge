-- Create once in the Neon database referenced by CALLLOG_DATABASE_URL.
CREATE TABLE IF NOT EXISTS call_logs (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  record jsonb NOT NULL
);

-- Cleanup deletes by created_at; keep it indexed.
CREATE INDEX IF NOT EXISTS call_logs_created_at_idx ON call_logs (created_at);
