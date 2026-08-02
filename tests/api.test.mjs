import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/worker.mjs";

class TestStatement {
  constructor(database, sql, parameters = []) {
    this.database = database;
    this.sql = sql;
    this.parameters = parameters;
  }

  bind(...parameters) {
    return new TestStatement(this.database, this.sql, parameters);
  }

  first() {
    return this.database.prepare(this.sql).get(...this.parameters) || null;
  }

  all() {
    return { results: this.database.prepare(this.sql).all(...this.parameters) };
  }

  run() {
    const result = this.database.prepare(this.sql).run(...this.parameters);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid || 0)
      }
    };
  }
}

class TestD1Database {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    const migrationDirectory = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(migrationDirectory).sort()) {
      if (file.endsWith(".sql")) {
        this.database.exec(readFileSync(new URL(file, migrationDirectory), "utf8"));
      }
    }
  }

  prepare(sql) {
    return new TestStatement(this.database, sql);
  }

  batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}

function testEnvironment(environment = "dev") {
  const DB = new TestD1Database();
  return {
    DB,
    ENVIRONMENT: environment,
    ASSETS: { fetch: () => new Response("Not found", { status: 404 }) }
  };
}

async function api(env, pathname, { body, cookie, headers = {}, method = "GET" } = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set("content-type", "application/json");
  if (cookie) requestHeaders.set("cookie", cookie);
  const response = await worker.fetch(new Request(`http://localhost${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
  const payload = await response.json();
  return { response, payload };
}

function sessionCookie(response) {
  return response.headers.get("set-cookie").split(";", 1)[0];
}

test("anonymous games use POST hints and make guess retries idempotent", async (context) => {
  const env = testEnvironment();
  context.after(() => env.DB.close());

  const created = await api(env, "/api/games", {
    method: "POST",
    body: { hardcoreMode: false }
  });
  assert.equal(created.response.status, 201);
  const { id } = created.payload.game;
  const access = { "x-game-token": created.payload.gameAccessToken };

  const oldHintMethod = await api(env, `/api/games/${id}/hints/part-of-speech`, {
    headers: access
  });
  assert.equal(oldHintMethod.response.status, 404);

  const hint = await api(env, `/api/games/${id}/hints/part-of-speech`, {
    method: "POST",
    headers: access,
    body: {}
  });
  assert.equal(hint.response.status, 200);
  assert.match(hint.payload.value, /^[A-Za-z]+(?: \/ [A-Za-z]+)*$/);
  assert.equal(hint.payload.statisticsEligible, false);

  const revealed = await api(env, `/api/dev/games/${id}`, { headers: access });
  const answer = revealed.payload.game.answer;
  const firstGuess = answer === "APPLE" ? "CRANE" : "APPLE";
  const guessRequest = {
    method: "POST",
    headers: access,
    body: { guess: firstGuess, attempt: 1 }
  };
  const first = await api(env, `/api/games/${id}/guesses`, guessRequest);
  assert.equal(first.response.status, 200);
  assert.equal(first.payload.game.guesses.length, 1);

  const retry = await api(env, `/api/games/${id}/guesses`, guessRequest);
  assert.equal(retry.response.status, 200);
  assert.equal(retry.payload.duplicate, true);
  assert.equal(retry.payload.game.guesses.length, 1);

  const conflict = await api(env, `/api/games/${id}/guesses`, {
    method: "POST",
    headers: access,
    body: { guess: answer, attempt: 1 }
  });
  assert.equal(conflict.response.status, 409);

  const win = await api(env, `/api/games/${id}/guesses`, {
    method: "POST",
    headers: access,
    body: { guess: answer, attempt: 2 }
  });
  assert.equal(win.response.status, 200);
  assert.equal(win.payload.game.status, "won");
  assert.equal(win.payload.game.guesses.length, 2);
});

test("simultaneous guesses cannot occupy the same attempt", async (context) => {
  const env = testEnvironment();
  context.after(() => env.DB.close());
  const created = await api(env, "/api/games", {
    method: "POST",
    body: { hardcoreMode: false }
  });
  const { id } = created.payload.game;
  const headers = { "x-game-token": created.payload.gameAccessToken };
  const responses = await Promise.all([
    api(env, `/api/games/${id}/guesses`, {
      method: "POST",
      headers,
      body: { guess: "APPLE", attempt: 1 }
    }),
    api(env, `/api/games/${id}/guesses`, {
      method: "POST",
      headers,
      body: { guess: "CRANE", attempt: 1 }
    })
  ]);
  assert.deepEqual(responses.map(({ response }) => response.status).sort(), [200, 409]);
  const game = await api(env, `/api/games/${id}`, { headers });
  assert.equal(game.payload.game.guesses.length, 1);
  assert.equal(game.payload.game.guesses[0].attempt, 1);
});

test("account games count resets as losses while hints only exclude distribution", async (context) => {
  const env = testEnvironment();
  context.after(() => env.DB.close());
  const registered = await api(env, "/api/auth/register", {
    method: "POST",
    body: {
      username: "TestPlayer",
      password: "plain-password",
      passwordConfirmation: "plain-password"
    }
  });
  assert.equal(registered.response.status, 201);
  const cookie = sessionCookie(registered.response);

  const first = await api(env, "/api/games", {
    method: "POST",
    cookie,
    body: { hardcoreMode: false }
  });
  const firstId = first.payload.game.id;
  const answer = (await api(env, `/api/dev/games/${firstId}`, { cookie })).payload.game.answer;
  const nonAnswer = answer === "APPLE" ? "CRANE" : "APPLE";
  await api(env, `/api/games/${firstId}/guesses`, {
    method: "POST",
    cookie,
    body: { guess: nonAnswer, attempt: 1 }
  });

  const second = await api(env, "/api/games", {
    method: "POST",
    cookie,
    body: { hardcoreMode: false, previousGameId: firstId }
  });
  const secondId = second.payload.game.id;
  await api(env, `/api/games/${secondId}/hints/first-letter`, {
    method: "POST",
    cookie,
    body: {}
  });
  const secondAnswer = (await api(env, `/api/dev/games/${secondId}`, { cookie }))
    .payload.game.answer;
  await api(env, `/api/games/${secondId}/guesses`, {
    method: "POST",
    cookie,
    body: { guess: secondAnswer, attempt: 1 }
  });

  const current = await api(env, "/api/auth/me", { cookie });
  assert.deepEqual(current.payload.statistics, {
    games: 2,
    wins: 1,
    winRate: 50,
    gamesNoHints: 1,
    winsNoHints: 0,
    winRateNoHints: 0,
    guessDistribution: [0, 0, 0, 0, 0, 0]
  });
});

test("auth traffic cleans expired sessions and rate-limit rows", async (context) => {
  const env = testEnvironment();
  context.after(() => env.DB.close());
  env.DB.database.prepare(
    `INSERT INTO users
      (id, username, username_normalized, password_hash, password_salt, password_iterations)
     VALUES ('cleanup-user', 'Cleanup', 'cleanup', 'hash', 'salt', 1)`
  ).run();
  env.DB.database.prepare(
    "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ('expired', 'cleanup-user', datetime('now', '-1 day'))"
  ).run();
  env.DB.database.prepare(
    "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ('current', 'cleanup-user', datetime('now', '+1 day'))"
  ).run();
  env.DB.database.prepare(
    "INSERT INTO auth_rate_limits (action, identity_hash, attempts, window_started_at) VALUES ('login', 'expired', 2, datetime('now', '-1 day'))"
  ).run();
  env.DB.database.prepare(
    "INSERT INTO auth_rate_limits (action, identity_hash, attempts, window_started_at) VALUES ('login', 'current', 2, CURRENT_TIMESTAMP)"
  ).run();

  const response = await api(env, "/api/auth/me");
  assert.equal(response.response.status, 200);
  assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get().count, 1);
  assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS count FROM auth_rate_limits").get().count, 1);
});

test("development-only data endpoints stay unavailable in production", async (context) => {
  const env = testEnvironment("production");
  context.after(() => env.DB.close());
  const users = await api(env, "/api/dev/users");
  assert.equal(users.response.status, 404);
  const reset = await api(env, "/api/dev/database/reset", {
    method: "POST",
    headers: { "x-wordle-dev-reset": "reset-entire-database" },
    body: {}
  });
  assert.equal(reset.response.status, 404);
});
