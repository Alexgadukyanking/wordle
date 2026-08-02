import WORDS from "../data/words.json" with { type: "json" };
import ANSWERS from "../data/answers.json" with { type: "json" };

const SECURITY_HEADERS = {
  "content-security-policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "script-src 'self' https://widgets.tradingview-widget.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://i.imgflip.com https://*.tradingview.com",
    "connect-src 'self' https://api.imgflip.com https://*.tradingview.com wss://*.tradingview.com",
    "frame-src https://*.tradingview.com",
    "font-src 'self' data: https://*.tradingview.com",
    "media-src 'self' blob:",
    "worker-src 'self' blob:"
  ].join("; "),
  "permissions-policy": "camera=(self), microphone=(), geolocation=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-permitted-cross-domain-policies": "none",
  "x-frame-options": "DENY"
};
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  ...SECURITY_HEADERS
};
const WORD_SET = new Set(WORDS);
const ANSWER_SET = new Set(ANSWERS);
const MAX_ATTEMPTS = 6;
const PASSWORD_ITERATIONS = 600000;
const MAX_PASSWORD_BYTES = 1024;
const SESSION_COOKIE = "five_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const LOGIN_ATTEMPT_LIMIT = 5;
const REGISTER_ATTEMPT_LIMIT = 10;
const AUTH_RATE_WINDOW_MINUTES = 15;
const ACCESS_JWKS_CACHE_MS = 5 * 60 * 1000;
const textEncoder = new TextEncoder();
let accessJwksCache = { url: "", expiresAt: 0, keys: [] };
const HINT_TYPES = new Set([
  "first-letter",
  "last-letter",
  "double-letters",
  "vowel-count",
  "part-of-speech"
]);
const ADJECTIVE_WORDS = new Set(
  "ACUTE AWARE BASIC BLACK BLIND BROAD BROWN CIVIL CLEAN CLEAR EAGER EARLY ELITE EMPTY EQUAL EXACT FALSE FINAL FIXED FRESH FUNNY GRAND GREAT GREEN GROSS HAPPY HEAVY IDEAL INNER LARGE LEGAL LOCAL LOOSE LUCKY MAJOR MINOR MORAL OTHER PLAIN PRIME PROUD QUICK QUIET RAPID READY RIGHT ROUGH ROYAL RURAL SHARP SHORT SMALL SMART SOLID SORRY SWEET THICK TIGHT TIRED TOUGH UPPER URBAN USUAL VALID VITAL WHITE WHOLE WRONG YOUNG".split(" ")
);
const VERB_WORDS = new Set(
  "ADMIT ADOPT AGREE ALLOW APPLY ARGUE ARISE AVOID BEGIN BREAK BRING BUILD CARRY CATCH CHASE CHECK CLAIM CLICK COVER CRASH DRINK DRIVE ENJOY ENTER EXIST FIGHT FOCUS FORCE GUARD GUESS GUIDE LEARN LEAVE MATCH MOUNT OCCUR OFFER PAINT PROVE RAISE REACH REFER SERVE SHARE SHINE SHOOT SLEEP SOLVE SPEAK SPEND SPLIT STAND START STICK STUDY TEACH THINK THROW TOUCH TRAIN TREAT TRUST VISIT WATCH WRITE YIELD".split(" ")
);

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(JSON_HEADERS);
  Object.entries(extraHeaders).forEach(([name, value]) => headers.set(name, value));
  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => headers.set(name, value));
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON");
  }
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));
}

function requestAddress(request) {
  return request.headers.get("cf-connecting-ip") || "local-development";
}

async function rateLimitIdentity(request, value = "") {
  const digest = await sha256(`${requestAddress(request)}\0${value}`);
  return bytesToBase64Url(digest);
}

async function enforceAuthRateLimit(db, action, identityHash, limit) {
  const current = await db.prepare(
    `SELECT attempts
     FROM auth_rate_limits
     WHERE action = ? AND identity_hash = ?
       AND window_started_at > datetime('now', ?)`
  ).bind(action, identityHash, `-${AUTH_RATE_WINDOW_MINUTES} minutes`).first();
  if (Number(current?.attempts || 0) >= limit) {
    throw new ApiError(429, "Too many attempts. Try again later");
  }
}

async function recordAuthAttempt(db, action, identityHash) {
  await db.prepare(
    `INSERT INTO auth_rate_limits
      (action, identity_hash, attempts, window_started_at)
     VALUES (?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(action, identity_hash) DO UPDATE SET
       attempts = CASE
         WHEN window_started_at <= datetime('now', ?)
         THEN 1 ELSE attempts + 1
       END,
       window_started_at = CASE
         WHEN window_started_at <= datetime('now', ?)
         THEN CURRENT_TIMESTAMP ELSE window_started_at
       END`
  ).bind(
    action,
    identityHash,
    `-${AUTH_RATE_WINDOW_MINUTES} minutes`,
    `-${AUTH_RATE_WINDOW_MINUTES} minutes`
  ).run();
}

async function clearAuthAttempts(db, action, identityHash) {
  await db.prepare(
    "DELETE FROM auth_rate_limits WHERE action = ? AND identity_hash = ?"
  ).bind(action, identityHash).run();
}

async function derivePassword(password, salt, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  ));
}

function timingSafeEqual(first, second) {
  if (first.byteLength !== second.byteLength) return false;
  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(first, second);
  }
  let difference = 0;
  for (let index = 0; index < first.byteLength; index += 1) {
    difference |= first[index] ^ second[index];
  }
  return difference === 0;
}

function parseCookies(request) {
  const cookies = new Map();
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return cookies;
}

function sessionCookie(request, token, maxAge = SESSION_SECONDS) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

function isLocalRequest(request) {
  return new Set(["localhost", "127.0.0.1", "::1"])
    .has(new URL(request.url).hostname);
}

function normalizedTeamDomain(value) {
  const domain = String(value || "").trim().replace(/\/$/, "");
  if (!domain) return "";
  return domain.startsWith("https://") ? domain : `https://${domain}`;
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

async function accessJwks(teamDomain) {
  const url = `${teamDomain}/cdn-cgi/access/certs`;
  if (accessJwksCache.url === url && accessJwksCache.expiresAt > Date.now()) {
    return accessJwksCache.keys;
  }
  const response = await fetch(url);
  if (!response.ok) throw new ApiError(503, "Admin authentication is unavailable");
  const body = await response.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  accessJwksCache = { url, keys, expiresAt: Date.now() + ACCESS_JWKS_CACHE_MS };
  return keys;
}

async function verifyAccessJwt(token, teamDomain, policyAudience) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  let header;
  let payload;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch {
    return false;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
  const jwk = (await accessJwks(teamDomain)).find((key) => key.kid === header.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(parts[2]),
    textEncoder.encode(`${parts[0]}.${parts[1]}`)
  );
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  return validSignature
    && payload.iss === teamDomain
    && audiences.includes(policyAudience)
    && Number(payload.exp || 0) > now
    && Number(payload.nbf || 0) <= now;
}

async function requireDevAdmin(request, env) {
  if (env.ENVIRONMENT !== "dev") throw new ApiError(404, "Not found");
  if (isLocalRequest(request)) return;
  const teamDomain = normalizedTeamDomain(env.TEAM_DOMAIN);
  const policyAudience = String(env.POLICY_AUD || "").trim();
  if (!teamDomain || !policyAudience) {
    throw new ApiError(503, "Remote admin access is not configured");
  }
  const token = request.headers.get("cf-access-jwt-assertion") || "";
  let authorized = false;
  try {
    authorized = Boolean(token) && await verifyAccessJwt(token, teamDomain, policyAudience);
  } catch (error) {
    if (error instanceof ApiError) throw error;
  }
  if (!authorized) {
    throw new ApiError(403, "Admin access denied");
  }
}

function validateUsername(username) {
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
    throw new ApiError(400, "Username must be 3–24 letters, numbers, or underscores");
  }
}

function validatePassword(password, confirmation) {
  if (typeof password !== "string" || password.length === 0) {
    throw new ApiError(400, "Password cannot be empty");
  }
  if (textEncoder.encode(password).byteLength > MAX_PASSWORD_BYTES) {
    throw new ApiError(400, "Password is too long");
  }
  if (confirmation !== undefined && password !== confirmation) {
    throw new ApiError(400, "Passwords do not match");
  }
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.created_at
  };
}

function publicStatistics(statistics = {}) {
  const games = Number(statistics.games ?? statistics.completed_games ?? 0);
  const wins = Number(statistics.wins ?? statistics.completed_wins ?? 0);
  const gamesNoHints = Number(statistics.games_no_hints || 0);
  const winsNoHints = Number(statistics.wins_no_hints || 0);
  return {
    games,
    wins,
    winRate: games > 0
      ? Math.round((wins / games) * 1000) / 10
      : 0,
    gamesNoHints,
    winsNoHints,
    winRateNoHints: gamesNoHints > 0
      ? Math.round((winsNoHints / gamesNoHints) * 1000) / 10
      : 0,
    guessDistribution: [1, 2, 3, 4, 5, 6].map((attempt) =>
      Number(statistics[`wins_in_${attempt}`] || 0)
    )
  };
}

async function findUserStatistics(db, userId) {
  return db.prepare(
    `SELECT games, wins, games_no_hints, wins_no_hints,
            wins_in_1, wins_in_2, wins_in_3,
            wins_in_4, wins_in_5, wins_in_6
     FROM user_statistics
     WHERE user_id = ?`
  ).bind(userId).first();
}

async function createAuthSession(db, userId) {
  const token = randomToken();
  const tokenHash = bytesToBase64Url(await sha256(token));
  await db.prepare(
    "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+7 days'))"
  ).bind(tokenHash, userId).run();
  return token;
}

async function authenticatedUser(request, env) {
  const token = parseCookies(request).get(SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = bytesToBase64Url(await sha256(token));
  return env.DB.prepare(
    `SELECT users.id, users.username, users.created_at
     FROM auth_sessions
     JOIN users ON users.id = auth_sessions.user_id
     WHERE auth_sessions.token_hash = ?
       AND auth_sessions.expires_at > CURRENT_TIMESTAMP`
  ).bind(tokenHash).first();
}

async function requireUser(request, env) {
  const user = await authenticatedUser(request, env);
  if (!user) throw new ApiError(401, "Log in to continue");
  return user;
}

async function verifyUserPassword(db, userId, password) {
  validatePassword(password);
  const credentials = await db.prepare(
    `SELECT password_hash, password_salt, password_iterations
     FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!credentials) return false;
  const candidate = await derivePassword(
    password,
    base64UrlToBytes(credentials.password_salt),
    credentials.password_iterations
  );
  return timingSafeEqual(candidate, base64UrlToBytes(credentials.password_hash));
}

async function register(request, env) {
  const body = await readJson(request);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = body?.password;
  validateUsername(username);
  if (typeof body?.passwordConfirmation !== "string") {
    throw new ApiError(400, "Write the password twice");
  }
  validatePassword(password, body?.passwordConfirmation);
  const normalized = normalizeUsername(username);
  const registrationIdentity = await rateLimitIdentity(request);
  await enforceAuthRateLimit(
    env.DB,
    "register",
    registrationIdentity,
    REGISTER_ATTEMPT_LIMIT
  );
  await recordAuthAttempt(env.DB, "register", registrationIdentity);
  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE username_normalized = ?"
  ).bind(normalized).first();
  if (existing) throw new ApiError(409, "Username is already taken");

  const userId = crypto.randomUUID();
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const passwordHash = await derivePassword(password, salt);
  const token = randomToken();
  const tokenHash = bytesToBase64Url(await sha256(token));
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users
          (id, username, username_normalized, password_hash, password_salt, password_iterations)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        userId,
        username,
        normalized,
        bytesToBase64Url(passwordHash),
        bytesToBase64Url(salt),
        PASSWORD_ITERATIONS
      ),
      env.DB.prepare(
        "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+7 days'))"
      ).bind(tokenHash, userId)
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new ApiError(409, "Username is already taken");
    throw error;
  }

  return json(
    {
      user: { id: userId, username, createdAt: new Date().toISOString() },
      statistics: publicStatistics()
    },
    201,
    { "set-cookie": sessionCookie(request, token) }
  );
}

async function login(request, env) {
  const body = await readJson(request);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = body?.password;
  if (!username || typeof password !== "string") {
    throw new ApiError(400, "Username and password are required");
  }
  validatePassword(password);
  const normalized = normalizeUsername(username);
  const loginIdentity = await rateLimitIdentity(request, normalized);
  await enforceAuthRateLimit(env.DB, "login", loginIdentity, LOGIN_ATTEMPT_LIMIT);
  const user = await env.DB.prepare(
    `SELECT id, username, username_normalized, password_hash, password_salt,
            password_iterations, created_at
     FROM users WHERE username_normalized = ?`
  ).bind(normalized).first();

  const salt = user
    ? base64UrlToBytes(user.password_salt)
    : new Uint8Array(16);
  const iterations = user?.password_iterations || PASSWORD_ITERATIONS;
  const candidate = await derivePassword(password, salt, iterations);
  const expected = user
    ? base64UrlToBytes(user.password_hash)
    : new Uint8Array(candidate.byteLength);
  if (!user || !timingSafeEqual(candidate, expected)) {
    await recordAuthAttempt(env.DB, "login", loginIdentity);
    throw new ApiError(401, "Invalid username or password");
  }

  await clearAuthAttempts(env.DB, "login", loginIdentity);
  const token = await createAuthSession(env.DB, user.id);
  return json(
    {
      user: publicUser(user),
      statistics: publicStatistics(await findUserStatistics(env.DB, user.id))
    },
    200,
    { "set-cookie": sessionCookie(request, token) }
  );
}

async function logout(request, env) {
  const token = parseCookies(request).get(SESSION_COOKIE);
  if (token) {
    const tokenHash = bytesToBase64Url(await sha256(token));
    await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
      .bind(tokenHash).run();
  }
  return json(
    { ok: true },
    200,
    { "set-cookie": sessionCookie(request, "", 0) }
  );
}

async function logoutAll(request, env) {
  const user = await requireUser(request, env);
  await env.DB.prepare("DELETE FROM auth_sessions WHERE user_id = ?")
    .bind(user.id).run();
  return json(
    { ok: true },
    200,
    { "set-cookie": sessionCookie(request, "", 0) }
  );
}

async function changePassword(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  if (!await verifyUserPassword(env.DB, user.id, body?.currentPassword)) {
    throw new ApiError(401, "Current password is incorrect");
  }
  if (typeof body?.newPasswordConfirmation !== "string") {
    throw new ApiError(400, "Write the new password twice");
  }
  validatePassword(body?.newPassword, body.newPasswordConfirmation);
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const passwordHash = await derivePassword(body.newPassword, salt);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users
       SET password_hash = ?, password_salt = ?, password_iterations = ?
       WHERE id = ?`
    ).bind(
      bytesToBase64Url(passwordHash),
      bytesToBase64Url(salt),
      PASSWORD_ITERATIONS,
      user.id
    ),
    env.DB.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(user.id)
  ]);
  const token = await createAuthSession(env.DB, user.id);
  return json(
    { ok: true },
    200,
    { "set-cookie": sessionCookie(request, token) }
  );
}

async function deleteAccount(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  if (!await verifyUserPassword(env.DB, user.id, body?.password)) {
    throw new ApiError(401, "Password is incorrect");
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM game_sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)
  ]);
  return json(
    { ok: true },
    200,
    { "set-cookie": sessionCookie(request, "", 0) }
  );
}

async function getCurrentUser(request, env) {
  const user = await authenticatedUser(request, env);
  return json({
    user: user ? publicUser(user) : null,
    statistics: user
      ? publicStatistics(await findUserStatistics(env.DB, user.id))
      : null
  });
}

function chooseAnswer() {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return ANSWERS[random[0] % ANSWERS.length];
}

function scoreAgainst(guess, target) {
  const result = Array(5).fill("absent");
  const remaining = target.split("");

  [...guess].forEach((letter, index) => {
    if (letter === target[index]) {
      result[index] = "correct";
      remaining[index] = null;
    }
  });

  [...guess].forEach((letter, index) => {
    if (result[index] === "correct") return;
    const match = remaining.indexOf(letter);
    if (match !== -1) {
      result[index] = "present";
      remaining[match] = null;
    }
  });

  return result;
}

function getHardcoreConstraints(guesses) {
  const fixed = Array(5).fill(null);
  const blocked = Array.from({ length: 5 }, () => new Set());
  const minimums = new Map();
  const maximums = new Map();

  guesses.forEach(({ guess, result }) => {
    const guessCounts = new Map();
    const matchedCounts = new Map();

    [...guess].forEach((letter, index) => {
      guessCounts.set(letter, (guessCounts.get(letter) || 0) + 1);
      if (result[index] === "correct") fixed[index] = letter;
      if (result[index] === "present") blocked[index].add(letter);
      if (result[index] !== "absent") {
        matchedCounts.set(letter, (matchedCounts.get(letter) || 0) + 1);
      }
    });

    guessCounts.forEach((count, letter) => {
      const matched = matchedCounts.get(letter) || 0;
      minimums.set(letter, Math.max(minimums.get(letter) || 0, matched));
      if (matched < count) {
        maximums.set(letter, Math.min(maximums.get(letter) ?? Infinity, matched));
      }
    });
  });

  return { fixed, blocked, minimums, maximums };
}

function validateHardcoreGuess(guess, guesses) {
  const { fixed, blocked, minimums, maximums } = getHardcoreConstraints(guesses);
  const counts = new Map();
  [...guess].forEach((letter) => counts.set(letter, (counts.get(letter) || 0) + 1));

  for (let index = 0; index < fixed.length; index += 1) {
    if (fixed[index] && guess[index] !== fixed[index]) {
      return `Position ${index + 1} must be ${fixed[index]}`;
    }
    if (blocked[index].has(guess[index])) {
      return `${guess[index]} can't be in position ${index + 1}`;
    }
  }
  for (const [letter, minimum] of minimums) {
    if ((counts.get(letter) || 0) < minimum) {
      return minimum === 1
        ? `Guess must contain ${letter}`
        : `Guess must contain ${minimum} ${letter}s`;
    }
  }
  for (const [letter, maximum] of maximums) {
    if ((counts.get(letter) || 0) > maximum) {
      return maximum === 0
        ? `${letter} is not in the word`
        : `Use no more than ${maximum} ${letter}`;
    }
  }
  return "";
}

async function findGame(db, gameId) {
  return db.prepare(
    `SELECT id, answer, hardcore_mode, status, user_id, access_token_hash,
            created_at, completed_at,
            (SELECT COUNT(*) FROM game_hints
             WHERE game_hints.game_id = game_sessions.id) AS hints_used
     FROM game_sessions WHERE id = ?`
  ).bind(gameId).first();
}

async function requireGameAccess(request, env, game) {
  const user = await authenticatedUser(request, env);
  if (game.user_id && user?.id === game.user_id) return;

  const token = request.headers.get("x-game-token") || "";
  if (token && game.access_token_hash) {
    const candidateHash = await sha256(token);
    const expectedHash = base64UrlToBytes(game.access_token_hash);
    if (timingSafeEqual(candidateHash, expectedHash)) return;
  }

  throw new ApiError(403, "Game access denied");
}

async function findAuthorizedGame(request, env, gameId) {
  const game = await findGame(env.DB, gameId);
  if (!game) throw new ApiError(404, "Game not found");
  await requireGameAccess(request, env, game);
  return game;
}

async function findGuesses(db, gameId) {
  const { results = [] } = await db.prepare(
    "SELECT attempt, guess, result, created_at FROM game_guesses WHERE game_id = ? ORDER BY attempt"
  ).bind(gameId).all();
  return results.map((row) => ({
    attempt: row.attempt,
    guess: row.guess,
    result: JSON.parse(row.result),
    createdAt: row.created_at
  }));
}

function publicGame(game, guesses) {
  const response = {
    id: game.id,
    status: game.status,
    hardcoreMode: Boolean(game.hardcore_mode),
    hintsUsed: Number(game.hints_used || 0),
    statisticsEligible: Number(game.hints_used || 0) === 0,
    guesses,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - guesses.length),
    createdAt: game.created_at,
    completedAt: game.completed_at
  };
  if (game.status === "won" || game.status === "lost") response.answer = game.answer;
  return response;
}

async function createGame(request, env) {
  const body = await readJson(request);
  const user = await authenticatedUser(request, env);
  const gameId = crypto.randomUUID();
  const accessToken = randomToken();
  const accessTokenHash = bytesToBase64Url(await sha256(accessToken));
  const hardcoreMode = Boolean(body?.hardcoreMode);
  const previousGameId = typeof body?.previousGameId === "string"
    ? body.previousGameId
    : "";

  const statements = [];
  if (previousGameId) {
    const previousGame = await findGame(env.DB, previousGameId);
    if (previousGame) await requireGameAccess(request, env, previousGame);
    statements.push(env.DB.prepare(
      `UPDATE game_sessions
       SET status = CASE
         WHEN EXISTS (SELECT 1 FROM game_guesses WHERE game_id = game_sessions.id)
           OR EXISTS (SELECT 1 FROM game_hints WHERE game_id = game_sessions.id)
         THEN 'lost'
         ELSE 'abandoned'
       END,
       completed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'active'`
    ).bind(previousGameId));
  }
  statements.push(env.DB.prepare(
    `INSERT INTO game_sessions
      (id, answer, hardcore_mode, user_id, access_token_hash)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    gameId,
    chooseAnswer(),
    Number(hardcoreMode),
    user?.id || null,
    accessTokenHash
  ));
  await env.DB.batch(statements);

  const game = await findGame(env.DB, gameId);
  return json({ game: publicGame(game, []), gameAccessToken: accessToken }, 201);
}

async function getGame(request, env, gameId) {
  const game = await findAuthorizedGame(request, env, gameId);
  return json({ game: publicGame(game, await findGuesses(env.DB, gameId)) });
}

async function updateMode(request, env, gameId) {
  const body = await readJson(request);
  if (typeof body?.hardcoreMode !== "boolean") {
    throw new ApiError(400, "hardcoreMode must be a boolean");
  }
  const game = await findAuthorizedGame(request, env, gameId);
  if (game.status !== "active") throw new ApiError(409, "Game has already ended");
  const guesses = await findGuesses(env.DB, gameId);
  if (guesses.length > 0) throw new ApiError(409, "Mode is locked after the first guess");

  await env.DB.prepare(
    "UPDATE game_sessions SET hardcore_mode = ? WHERE id = ?"
  ).bind(Number(body.hardcoreMode), gameId).run();
  game.hardcore_mode = Number(body.hardcoreMode);
  return json({ game: publicGame(game, guesses) });
}

async function submitGuess(request, env, gameId, allowAnyWord = false) {
  const body = await readJson(request);
  const guess = typeof body?.guess === "string" ? body.guess.trim().toUpperCase() : "";
  if (!/^[A-Z]{5}$/.test(guess)) throw new ApiError(400, "Guess must be five letters");
  if (!allowAnyWord && !WORD_SET.has(guess)) throw new ApiError(422, "Not in word list");

  const game = await findAuthorizedGame(request, env, gameId);
  if (game.status !== "active") throw new ApiError(409, "Game has already ended");
  const guesses = await findGuesses(env.DB, gameId);
  if (guesses.length >= MAX_ATTEMPTS) throw new ApiError(409, "No attempts remaining");
  if (game.hardcore_mode) {
    const hardcoreError = validateHardcoreGuess(guess, guesses);
    if (hardcoreError) throw new ApiError(422, hardcoreError);
  }

  const result = scoreAgainst(guess, game.answer);
  const attempt = guesses.length + 1;
  const status = guess === game.answer ? "won" : attempt === MAX_ATTEMPTS ? "lost" : "active";
  const statements = [
    env.DB.prepare(
      "INSERT INTO game_guesses (game_id, attempt, guess, result) VALUES (?, ?, ?, ?)"
    ).bind(gameId, attempt, guess, JSON.stringify(result))
  ];
  if (status !== "active") {
    statements.push(env.DB.prepare(
      "UPDATE game_sessions SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'"
    ).bind(status, gameId));
  }
  await env.DB.batch(statements);
  game.status = status;
  if (status !== "active") game.completed_at = new Date().toISOString();
  guesses.push({ attempt, guess, result, createdAt: new Date().toISOString() });
  return json({ game: publicGame(game, guesses), result });
}

function localPartOfSpeech(word) {
  if (ADJECTIVE_WORDS.has(word)) return "Adjective";
  if (VERB_WORDS.has(word)) return "Verb";
  return "Noun";
}

async function partOfSpeech(word) {
  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`
    );
    if (!response.ok) return localPartOfSpeech(word);
    const entries = await response.json();
    const accepted = new Set(["adjective", "noun", "verb"]);
    const parts = [...new Set(
      entries.flatMap((entry) => entry.meanings || [])
        .map((meaning) => meaning.partOfSpeech)
        .filter((part) => accepted.has(part))
    )];
    return parts.length
      ? parts.map((part) => part[0].toUpperCase() + part.slice(1)).join(" / ")
      : localPartOfSpeech(word);
  } catch {
    return localPartOfSpeech(word);
  }
}

async function computeHint(type, answer) {
  if (type === "first-letter") return answer[0];
  if (type === "last-letter") return answer.at(-1);
  if (type === "double-letters") return new Set(answer).size < answer.length ? "Yes" : "No";
  if (type === "vowel-count") return String([...answer].filter((letter) => "AEIOU".includes(letter)).length);
  return partOfSpeech(answer);
}

async function getHint(request, env, gameId, hintType) {
  if (!HINT_TYPES.has(hintType)) throw new ApiError(404, "Hint type not found");
  const game = await findAuthorizedGame(request, env, gameId);
  if (game.status !== "active") throw new ApiError(409, "Game has already ended");

  const stored = await env.DB.prepare(
    "SELECT hint_value, revealed_at FROM game_hints WHERE game_id = ? AND hint_type = ?"
  ).bind(gameId, hintType).first();
  if (stored) {
    return json({
      type: hintType,
      value: stored.hint_value,
      revealedAt: stored.revealed_at,
      hintsUsed: Number(game.hints_used || 0),
      statisticsEligible: false
    });
  }

  const value = await computeHint(hintType, game.answer);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO game_hints (game_id, hint_type, hint_value) VALUES (?, ?, ?)"
  ).bind(gameId, hintType, value).run();
  return json({
    type: hintType,
    value,
    hintsUsed: Number(game.hints_used || 0) + 1,
    statisticsEligible: false
  });
}

async function getDevGame(request, env, gameId) {
  await requireDevAdmin(request, env);
  const game = await findGame(env.DB, gameId);
  if (!game) throw new ApiError(404, "Game not found");
  return json({
    game: {
      ...publicGame(game, await findGuesses(env.DB, gameId)),
      answer: game.answer
    }
  });
}

async function resetDevDatabase(request, env) {
  if (env.ENVIRONMENT !== "dev" || !isLocalRequest(request)) {
    throw new ApiError(404, "Not found");
  }
  if (request.headers.get("x-wordle-dev-reset") !== "reset-entire-database") {
    throw new ApiError(403, "Reset confirmation is missing");
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_rate_limits"),
    env.DB.prepare("DELETE FROM auth_sessions"),
    env.DB.prepare("DELETE FROM game_hints"),
    env.DB.prepare("DELETE FROM game_guesses"),
    env.DB.prepare("DELETE FROM game_sessions"),
    env.DB.prepare("DELETE FROM users")
  ]);

  return json({ ok: true });
}

async function getDevUsers(request, env) {
  await requireDevAdmin(request, env);
  const { results = [] } = await env.DB.prepare(
    `SELECT
       users.id,
       users.username,
       users.created_at,
       COUNT(game_sessions.id) AS total_games,
       SUM(CASE WHEN game_sessions.status = 'won' THEN 1 ELSE 0 END) AS wins,
       SUM(CASE WHEN game_sessions.status = 'lost' THEN 1 ELSE 0 END) AS losses,
       SUM(CASE WHEN game_sessions.status = 'active' THEN 1 ELSE 0 END) AS active_games,
       MAX(COALESCE(game_sessions.completed_at, game_sessions.created_at)) AS last_game_at,
       account_stats.games AS completed_games,
       account_stats.wins AS completed_wins,
       account_stats.games_no_hints,
       account_stats.wins_no_hints,
       account_stats.wins_in_1,
       account_stats.wins_in_2,
       account_stats.wins_in_3,
       account_stats.wins_in_4,
       account_stats.wins_in_5,
       account_stats.wins_in_6,
       (SELECT COUNT(*) FROM auth_sessions
        WHERE auth_sessions.user_id = users.id
          AND auth_sessions.expires_at > CURRENT_TIMESTAMP) AS active_sessions
     FROM users
     LEFT JOIN game_sessions ON game_sessions.user_id = users.id
     LEFT JOIN user_statistics AS account_stats
       ON account_stats.user_id = users.id
     GROUP BY users.id, users.username, users.created_at
     ORDER BY users.created_at DESC
     LIMIT 500`
  ).all();

  return json({
    users: results.map((user) => ({
      id: user.id,
      username: user.username,
      createdAt: user.created_at,
      totalGames: Number(user.total_games || 0),
      wins: Number(user.wins || 0),
      losses: Number(user.losses || 0),
      activeGames: Number(user.active_games || 0),
      activeSessions: Number(user.active_sessions || 0),
      lastGameAt: user.last_game_at,
      statistics: publicStatistics(user)
    }))
  });
}

async function getDevUser(request, env, userId) {
  await requireDevAdmin(request, env);
  const user = await env.DB.prepare(
    `SELECT users.id, users.username, users.created_at,
       account_stats.games AS completed_games,
       account_stats.wins AS completed_wins,
       account_stats.games_no_hints,
       account_stats.wins_no_hints,
       account_stats.wins_in_1,
       account_stats.wins_in_2,
       account_stats.wins_in_3,
       account_stats.wins_in_4,
       account_stats.wins_in_5,
       account_stats.wins_in_6,
       (SELECT COUNT(*) FROM auth_sessions
        WHERE auth_sessions.user_id = users.id
          AND auth_sessions.expires_at > CURRENT_TIMESTAMP) AS active_sessions
     FROM users
     LEFT JOIN user_statistics AS account_stats
       ON account_stats.user_id = users.id
     WHERE users.id = ?`
  ).bind(userId).first();
  if (!user) throw new ApiError(404, "Account not found");

  const { results = [] } = await env.DB.prepare(
    `SELECT
       game_sessions.id,
       game_sessions.status,
       game_sessions.hardcore_mode,
       game_sessions.created_at,
       game_sessions.completed_at,
       COUNT(DISTINCT game_guesses.id) AS guesses,
       COUNT(DISTINCT game_hints.hint_type) AS hints_used
     FROM game_sessions
     LEFT JOIN game_guesses ON game_guesses.game_id = game_sessions.id
     LEFT JOIN game_hints ON game_hints.game_id = game_sessions.id
     WHERE game_sessions.user_id = ?
     GROUP BY game_sessions.id
     ORDER BY game_sessions.created_at DESC
     LIMIT 100`
  ).bind(userId).all();

  return json({
    user: {
      id: user.id,
      username: user.username,
      createdAt: user.created_at,
      activeSessions: Number(user.active_sessions || 0),
      statistics: publicStatistics(user)
    },
    games: results.map((game) => ({
      id: game.id,
      status: game.status,
      hardcoreMode: Boolean(game.hardcore_mode),
      guesses: Number(game.guesses || 0),
      hintsUsed: Number(game.hints_used || 0),
      countsTowardStatistics:
        new Set(["won", "lost"]).has(game.status) && Number(game.hints_used || 0) === 0,
      createdAt: game.created_at,
      completedAt: game.completed_at
    }))
  });
}

async function routeApi(request, env, pathname) {
  if (!env.DB) throw new ApiError(503, "Database binding is unavailable");
  if (request.method === "POST" && pathname === "/api/auth/register") {
    return register(request, env);
  }
  if (request.method === "POST" && pathname === "/api/auth/login") {
    return login(request, env);
  }
  if (request.method === "POST" && pathname === "/api/auth/logout") {
    return logout(request, env);
  }
  if (request.method === "POST" && pathname === "/api/auth/logout-all") {
    return logoutAll(request, env);
  }
  if (request.method === "PUT" && pathname === "/api/auth/password") {
    return changePassword(request, env);
  }
  if (request.method === "DELETE" && pathname === "/api/auth/account") {
    return deleteAccount(request, env);
  }
  if (request.method === "GET" && pathname === "/api/auth/me") {
    return getCurrentUser(request, env);
  }
  if (request.method === "POST" && pathname === "/api/games") {
    return createGame(request, env);
  }

  let match = pathname.match(/^\/api\/games\/([^/]+)$/);
  if (match && request.method === "GET") return getGame(request, env, match[1]);

  match = pathname.match(/^\/api\/games\/([^/]+)\/mode$/);
  if (match && request.method === "PUT") return updateMode(request, env, match[1]);

  match = pathname.match(/^\/api\/games\/([^/]+)\/guesses$/);
  if (match && request.method === "POST") return submitGuess(request, env, match[1]);

  match = pathname.match(/^\/api\/games\/([^/]+)\/hints\/([^/]+)$/);
  if (match && request.method === "GET") return getHint(request, env, match[1], match[2]);

  match = pathname.match(/^\/api\/dev\/games\/([^/]+)$/);
  if (match && request.method === "GET") return getDevGame(request, env, match[1]);

  match = pathname.match(/^\/api\/dev\/games\/([^/]+)\/guesses$/);
  if (match && request.method === "POST") {
    await requireDevAdmin(request, env);
    return submitGuess(request, env, match[1], true);
  }

  if (request.method === "GET" && pathname === "/api/dev/users") {
    return getDevUsers(request, env);
  }

  if (request.method === "POST" && pathname === "/api/dev/database/reset") {
    return resetDevDatabase(request, env);
  }

  match = pathname.match(/^\/api\/dev\/users\/([^/]+)$/);
  if (match && request.method === "GET") return getDevUser(request, env, match[1]);

  throw new ApiError(404, "Not found");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api") {
      return json({
        name: "Wordle API",
        version: 5,
        status: "ready",
        environment: env.ENVIRONMENT,
        endpoints: [
          "POST /api/auth/register",
          "POST /api/auth/login",
          "POST /api/auth/logout",
          "POST /api/auth/logout-all",
          "PUT /api/auth/password",
          "DELETE /api/auth/account",
          "GET /api/auth/me",
          "POST /api/games",
          "GET /api/games/:id",
          "PUT /api/games/:id/mode",
          "POST /api/games/:id/guesses",
          "GET /api/games/:id/hints/:type"
        ]
      });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "wordle-api",
        version: 5,
        environment: env.ENVIRONMENT,
        database: Boolean(env.DB),
        timestamp: new Date().toISOString()
      });
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      try {
        return await routeApi(request, env, url.pathname);
      } catch (error) {
        if (error instanceof ApiError) return json({ error: error.message }, error.status);
        console.error(error);
        return json({ error: "Internal server error" }, 500);
      }
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  }
};

export {
  ANSWER_SET,
  WORD_SET,
  chooseAnswer,
  publicStatistics,
  requireGameAccess,
  scoreAgainst,
  validateHardcoreGuess
};
