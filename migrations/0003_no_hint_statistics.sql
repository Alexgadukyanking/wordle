CREATE VIEW IF NOT EXISTS user_no_hint_statistics AS
WITH eligible_games AS (
  SELECT
    game_sessions.id,
    game_sessions.user_id,
    game_sessions.status,
    COUNT(game_guesses.id) AS guess_count
  FROM game_sessions
  LEFT JOIN game_guesses ON game_guesses.game_id = game_sessions.id
  WHERE game_sessions.user_id IS NOT NULL
    AND game_sessions.status IN ('won', 'lost')
    AND NOT EXISTS (
      SELECT 1
      FROM game_hints
      WHERE game_hints.game_id = game_sessions.id
    )
  GROUP BY game_sessions.id, game_sessions.user_id, game_sessions.status
)
SELECT
  users.id AS user_id,
  COUNT(eligible_games.id) AS games_no_hints,
  COALESCE(SUM(CASE WHEN eligible_games.status = 'won' THEN 1 ELSE 0 END), 0)
    AS wins_no_hints,
  COALESCE(SUM(CASE WHEN eligible_games.status = 'won' AND eligible_games.guess_count = 1 THEN 1 ELSE 0 END), 0)
    AS wins_in_1,
  COALESCE(SUM(CASE WHEN eligible_games.status = 'won' AND eligible_games.guess_count = 2 THEN 1 ELSE 0 END), 0)
    AS wins_in_2,
  COALESCE(SUM(CASE WHEN eligible_games.status = 'won' AND eligible_games.guess_count = 3 THEN 1 ELSE 0 END), 0)
    AS wins_in_3,
  COALESCE(SUM(CASE WHEN eligible_games.status = 'won' AND eligible_games.guess_count = 4 THEN 1 ELSE 0 END), 0)
    AS wins_in_4,
  COALESCE(SUM(CASE WHEN eligible_games.status = 'won' AND eligible_games.guess_count = 5 THEN 1 ELSE 0 END), 0)
    AS wins_in_5,
  COALESCE(SUM(CASE WHEN eligible_games.status = 'won' AND eligible_games.guess_count = 6 THEN 1 ELSE 0 END), 0)
    AS wins_in_6
FROM users
LEFT JOIN eligible_games ON eligible_games.user_id = users.id
GROUP BY users.id;
