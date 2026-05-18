ALTER TABLE jobs ADD COLUMN reserved_sandbox_seconds INTEGER NOT NULL DEFAULT 0;

UPDATE jobs
SET reserved_sandbox_seconds = 60
WHERE reserved_sandbox_seconds = 0
  AND capability LIKE 'sandbox.%';

CREATE INDEX IF NOT EXISTS idx_jobs_actor_reserved_sandbox_created_at
  ON jobs(actor_id, created_at DESC, reserved_credits, reserved_browser_seconds, reserved_sandbox_seconds);
