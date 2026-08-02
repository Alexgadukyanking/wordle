CREATE TABLE IF NOT EXISTS auth_rate_limits (
  action TEXT NOT NULL,
  identity_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (action, identity_hash)
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_window_idx
  ON auth_rate_limits(window_started_at);
