CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL,
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  provider_mode TEXT NOT NULL DEFAULT 'live',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  canceled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_capability_created_at ON jobs(capability, created_at DESC);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  kind TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_created_at ON artifacts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_job_id ON artifacts(job_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  subject TEXT NOT NULL,
  path TEXT NOT NULL,
  job_id TEXT,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_at ON audit_events(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_job_id ON audit_events(job_id);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  meter TEXT NOT NULL,
  quantity REAL NOT NULL,
  job_id TEXT,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_events_meter_at ON usage_events(meter, at DESC);

CREATE TABLE IF NOT EXISTS retention_policies (
  scope TEXT PRIMARY KEY,
  logs_days INTEGER NOT NULL,
  artifacts_days INTEGER NOT NULL,
  recordings TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO retention_policies (scope, logs_days, artifacts_days, recordings, updated_at)
VALUES ('default', 30, 30, 'off', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(scope) DO NOTHING;
