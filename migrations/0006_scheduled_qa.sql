CREATE TABLE IF NOT EXISTS scheduled_qa_configs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  label TEXT,
  capability TEXT NOT NULL,
  input_json TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  last_job_id TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (last_job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_qa_configs_actor_created_at ON scheduled_qa_configs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_qa_configs_due ON scheduled_qa_configs(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS scheduled_qa_runs (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  job_id TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (config_id) REFERENCES scheduled_qa_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_qa_runs_actor_created_at ON scheduled_qa_runs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_qa_runs_config_created_at ON scheduled_qa_runs(config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_qa_runs_job_id ON scheduled_qa_runs(job_id);
