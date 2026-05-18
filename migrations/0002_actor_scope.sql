ALTER TABLE jobs ADD COLUMN actor_id TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE jobs ADD COLUMN plan_name TEXT NOT NULL DEFAULT 'Creator';
CREATE INDEX IF NOT EXISTS idx_jobs_actor_created_at ON jobs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_actor_capability_created_at ON jobs(actor_id, capability, created_at DESC);

ALTER TABLE artifacts ADD COLUMN actor_id TEXT NOT NULL DEFAULT 'legacy';
CREATE INDEX IF NOT EXISTS idx_artifacts_actor_created_at ON artifacts(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_actor_job_id ON artifacts(actor_id, job_id);

ALTER TABLE audit_events ADD COLUMN actor_id TEXT NOT NULL DEFAULT 'legacy';
CREATE INDEX IF NOT EXISTS idx_audit_events_actor_at ON audit_events(actor_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor_job_id ON audit_events(actor_id, job_id);

ALTER TABLE usage_events ADD COLUMN actor_id TEXT NOT NULL DEFAULT 'legacy';
CREATE INDEX IF NOT EXISTS idx_usage_events_actor_meter_at ON usage_events(actor_id, meter, at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_actor_job_id ON usage_events(actor_id, job_id);
