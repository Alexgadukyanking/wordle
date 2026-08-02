import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  ANSWER_SET,
  WORD_SET,
  chooseAnswer,
  publicStatistics,
  requireGameAccess,
  scoreAgainst,
  validateHardcoreGuess
} from "../src/worker.mjs";

test("the curated answer pool is non-empty, unique, and accepted as guesses", () => {
  assert.ok(ANSWER_SET.size >= 1500 && ANSWER_SET.size <= 1600);
  for (const answer of ANSWER_SET) {
    assert.match(answer, /^[A-Z]{5}$/);
    assert.ok(WORD_SET.has(answer), `${answer} is missing from the accepted word list`);
  }
  assert.ok(ANSWER_SET.has(chooseAnswer()));
});

test("duplicate letters are scored only as often as they appear in the answer", () => {
  assert.deepEqual(scoreAgainst("SPEED", "ERASE"), [
    "present", "absent", "present", "present", "absent"
  ]);
  assert.deepEqual(scoreAgainst("APPLE", "AMPLE"), [
    "correct", "absent", "correct", "correct", "correct"
  ]);
});

test("hardcore mode enforces revealed positions and letter counts", () => {
  const guesses = [{
    guess: "SPEED",
    result: scoreAgainst("SPEED", "ERASE")
  }];
  assert.match(validateHardcoreGuess("SHEAR", guesses), /can't be in position 1/);
  assert.equal(validateHardcoreGuess("ERASE", guesses), "");
});

test("statistics expose regular and no-hint categories separately", () => {
  assert.deepEqual(publicStatistics({
    games: 4,
    wins: 3,
    games_no_hints: 2,
    wins_no_hints: 1,
    wins_in_1: 0,
    wins_in_2: 1
  }), {
    games: 4,
    wins: 3,
    winRate: 75,
    gamesNoHints: 2,
    winsNoHints: 1,
    winRateNoHints: 50,
    guessDistribution: [0, 1, 0, 0, 0, 0]
  });
});

test("anonymous games require their unguessable access token", async () => {
  const token = "private-game-token";
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  ));
  const game = {
    user_id: null,
    access_token_hash: Buffer.from(digest).toString("base64url")
  };
  await requireGameAccess(
    new Request("http://localhost/api/game", { headers: { "x-game-token": token } }),
    {},
    game
  );
  await assert.rejects(
    requireGameAccess(new Request("http://localhost/api/game"), {}, game),
    /Game access denied/
  );
});

test("all database migrations apply and statistics preserve hint eligibility", () => {
  const db = new DatabaseSync(":memory:");
  const migrationDirectory = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrationDirectory).sort()) {
    if (file.endsWith(".sql")) {
      db.exec(readFileSync(new URL(file, migrationDirectory), "utf8"));
    }
  }

  const gameColumns = db.prepare("PRAGMA table_info(game_sessions)").all();
  assert.ok(gameColumns.some((column) => column.name === "access_token_hash"));
  assert.ok(db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_rate_limits'"
  ).get());

  db.prepare(
    `INSERT INTO users
      (id, username, username_normalized, password_hash, password_salt, password_iterations)
     VALUES ('user-1', 'Player', 'player', 'hash', 'salt', 1)`
  ).run();
  for (const [id, status] of [["clean-win", "won"], ["loss", "lost"], ["hint-win", "won"]]) {
    db.prepare(
      "INSERT INTO game_sessions (id, answer, status, user_id) VALUES (?, 'APPLE', ?, 'user-1')"
    ).run(id, status);
  }
  db.prepare(
    "INSERT INTO game_guesses (game_id, attempt, guess, result) VALUES ('clean-win', 1, 'AMPLE', '[]')"
  ).run();
  db.prepare(
    "INSERT INTO game_guesses (game_id, attempt, guess, result) VALUES ('clean-win', 2, 'APPLE', '[]')"
  ).run();
  db.prepare(
    "INSERT INTO game_guesses (game_id, attempt, guess, result) VALUES ('loss', 1, 'CRANE', '[]')"
  ).run();
  db.prepare(
    "INSERT INTO game_guesses (game_id, attempt, guess, result) VALUES ('hint-win', 1, 'APPLE', '[]')"
  ).run();
  db.prepare(
    "INSERT INTO game_hints (game_id, hint_type, hint_value) VALUES ('hint-win', 'first-letter', 'A')"
  ).run();

  const statistics = db.prepare("SELECT * FROM user_statistics WHERE user_id = 'user-1'").get();
  assert.equal(statistics.games, 3);
  assert.equal(statistics.wins, 2);
  assert.equal(statistics.games_no_hints, 2);
  assert.equal(statistics.wins_no_hints, 1);
  assert.equal(statistics.wins_in_2, 1);
  db.close();
});
