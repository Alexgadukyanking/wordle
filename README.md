# Five

A browser-based five-letter word game hosted on Cloudflare Workers.

## Project structure

- `index.html`, `style.css`, `script.js`, and `public/assets/` are the frontend.
- `data/words.json` is the canonical word list bundled into the frontend and Worker.
- `src/worker.mjs` is the server-authoritative Cloudflare Worker API.
- `migrations/` contains the D1 database schema history.
- `src/dev/` contains development-only browser tools.
- `wrangler.jsonc` defines separate development and production Workers and D1 bindings.
- Vite generates `dist/`; Cloudflare publishes only that generated directory.

## Server-authoritative games

The Worker selects and stores each answer in D1. The browser receives a random
game ID, submitted guesses, and their evaluated tile results. While a game is
active, the normal game API never returns the answer.

The Worker also owns:

- guess validation and scoring;
- hardcore-mode enforcement;
- game status and attempt counts;
- hint computation and hint-use records;
- final answer disclosure after a win or loss.

## Player accounts

Accounts use a unique username and password only; no Google login is present.
Registration requires entering the same password twice. There is deliberately no
password-strength rule, but passwords are never stored as plaintext: the Worker
uses PBKDF2-HMAC-SHA256 with a unique salt and an HTTP-only session cookie.

Usernames are case-insensitively unique and must contain 3–24 ASCII letters,
numbers, or underscores. Authentication is optional, and games created while
signed in are linked to that user for future per-user statistics.

Regular statistics count every completed signed-in game, including games that
used hints. No-hint statistics are derived separately server-side from D1. A game counts in
`gamesNoHints` only after it ends in a win or loss without any recorded hint.
Resetting an active game records that game as a loss once a guess or hint has
been submitted. An untouched game with zero guesses and zero hints is instead
abandoned and excluded from statistics. The browser shows the loss warning only
when the reset will count.
Qualifying wins count in `winsNoHints` and in exactly one 1–6 guess bucket.
Opening the first hint displays a warning; confirming it permanently excludes
that game from these statistics. Hinted games remain in raw development game
history so they can still be inspected and debugged.

Signed-in players can view both categories at `/stats`. The page reads the
HTTP-only account session through `GET /api/auth/me`; signed-out visitors are
prompted to log in from the game page.

Development builds include a read-only local account dashboard at
`http://localhost:8787/dev/accounts.html`. It lists safe account metadata,
session counts, all-game totals, no-hint totals, guess distributions, and recent
game history. Authentication secrets
are never returned by its dev-only APIs. The account-data APIs also reject
non-loopback requests, so they cannot be used through a remotely deployed URL.

The browser owns presentation, keyboard input, the non-authoritative possible-
word counter, and local visual customization.

## Backend API

- `POST /api/games`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/games/:id`
- `PUT /api/games/:id/mode`
- `POST /api/games/:id/guesses`
- `GET /api/games/:id/hints/:type`
- `GET /api/health`

Development builds additionally expose `GET /api/dev/games/:id` for the debug
panel's explicit answer reveal. Production returns `404` for this route.

## Local development

Install dependencies and start the complete local Worker, D1 database, and
development frontend:

```sh
npm install
npm run dev
```

`npm run dev` verifies the development bundle, applies pending local D1
migrations, and starts the `wordle-dev` Worker. The debug panel supports answer
reveal, client-state inspection, arbitrary five-letter guesses, and a confirmed
full local-database reset. The reset deletes all local accounts, authentication
sessions, games, guesses, hints, and derived statistics. Its API is restricted
to loopback requests in the development environment.

The Vite-only frontend command is available as `npm run dev:frontend`, but the
game APIs require the complete Worker command above.

## Build verification

```sh
npm run verify:dev
npm run verify:prod
```

Production verification fails if a debug filename, selector, or UI marker is
found in the generated artifact.

## Deployment prerequisites

Development and production use separate Workers and D1 databases:

- development: `wordle-dev`
- production: `wordle` and `wordle-production`

Before the first remote deployment, provision the matching D1 resource and
apply every migration in `migrations/` in order. Local migrations use:

```sh
npm run db:migrate:dev
```

After the remote `wordle-dev` D1 binding is provisioned, apply its migrations
with `npm run db:migrate:dev:remote`.

Remote production migration is deliberately separate from normal builds:

```sh
npm run db:migrate:prod
```

Deploy the isolated development Worker with `npm run deploy:dev` and production
with `npm run deploy:prod`. Protect any remotely deployed development Worker
with Cloudflare Access: its dev-only reveal endpoint intentionally discloses
the answer for debugging.

Do not point the development binding at the production D1 database. Configure
Cloudflare branch builds so `main` deploys production and the development branch
deploys only `wordle-dev`.
