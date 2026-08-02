PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  answer TEXT NOT NULL CHECK (length(answer) = 5),
  hardcore_mode INTEGER NOT NULL DEFAULT 0 CHECK (hardcore_mode IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'won', 'lost', 'abandoned')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS game_guesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 6),
  guess TEXT NOT NULL CHECK (length(guess) = 5),
  result TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (game_id, attempt)
);

CREATE TABLE IF NOT EXISTS game_hints (
  game_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  hint_type TEXT NOT NULL,
  hint_value TEXT NOT NULL,
  revealed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, hint_type)
);

CREATE INDEX IF NOT EXISTS game_guesses_game_id_idx
  ON game_guesses(game_id);

CREATE INDEX IF NOT EXISTS game_sessions_status_idx
  ON game_sessions(status);
