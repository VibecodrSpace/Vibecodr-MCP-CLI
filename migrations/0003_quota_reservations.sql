ALTER TABLE jobs ADD COLUMN reserved_credits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN reserved_browser_seconds INTEGER NOT NULL DEFAULT 0;

UPDATE jobs
SET reserved_credits = 1
WHERE reserved_credits = 0
  AND (capability LIKE 'browser.%' OR capability LIKE 'sandbox.%');

UPDATE jobs
SET reserved_browser_seconds = 60
WHERE reserved_browser_seconds = 0
  AND capability LIKE 'browser.%';

CREATE INDEX IF NOT EXISTS idx_jobs_actor_reserved_created_at
  ON jobs(actor_id, created_at DESC, reserved_credits, reserved_browser_seconds);
