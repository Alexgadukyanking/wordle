ALTER TABLE game_sessions
  ADD COLUMN access_token_hash TEXT;

CREATE INDEX IF NOT EXISTS game_sessions_access_token_hash_idx
  ON game_sessions(access_token_hash);
