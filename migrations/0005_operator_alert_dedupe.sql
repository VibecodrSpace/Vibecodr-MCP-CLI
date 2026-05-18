CREATE TABLE IF NOT EXISTS operator_alert_dedupe (
  alert_key TEXT NOT NULL,
  reset_window TEXT NOT NULL,
  source TEXT NOT NULL,
  code TEXT NOT NULL,
  surface TEXT NOT NULL,
  scope TEXT NOT NULL,
  threshold_percent INTEGER NOT NULL,
  actor_id TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  suppressed_count INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  PRIMARY KEY (alert_key, reset_window)
);

CREATE INDEX IF NOT EXISTS idx_operator_alert_dedupe_last_seen
  ON operator_alert_dedupe(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_operator_alert_dedupe_actor_surface
  ON operator_alert_dedupe(actor_id, surface, last_seen_at DESC);
