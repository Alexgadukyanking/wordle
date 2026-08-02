# Five

A browser-based five-letter word game hosted on Cloudflare Workers.

## Project structure

- `index.html`, `style.css`, `script.js`, and `public/assets/` are the frontend.
- `data/words.json` contains accepted guesses; `data/answers.json` is the smaller,
  curated pool from which the Worker chooses answers.
- `src/worker.mjs` is the server-authoritative Cloudflare Worker API.
- `migrations/` contains the D1 database schema history.
- `src/dev/` contains development-only browser tools.
- `wrangler.jsonc` defines separate development and production Workers and D1 bindings.
- Vite generates isolated `dist/dev/` and `dist/production/` directories.
  Cloudflare publishes the directory matching the selected Worker environment.

## Server-authoritative games

The Worker selects and stores each answer in D1. The browser receives a random
game ID, a separate unguessable game access token, submitted guesses, and their
evaluated tile results. The token is stored only in that browser and sent in the
`X-Game-Token` header; knowing another game's ID is not enough to read or modify
it. Signed-in owners can also access their games. While a game is active, the
normal game API never returns the answer.

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
Login is limited to five failed attempts per username and source address per 15
minutes; registration is limited to ten attempts per source address. Signed-in
players can change their password, log out every device, or permanently delete
their account and game history.

Usernames are case-insensitively unique and must contain 3–24 ASCII letters,
numbers, or underscores. Authentication is optional, and games created while
signed in are linked to that user for future per-user statistics.

Player-facing Games, Wins, and Win rate include every completed game, whether or
not hints were used. Guess distribution remains no-hint only. A game counts in
`gamesNoHints` only after it ends in a win or loss without any recorded hint.
Resetting an active game records that game as a loss once a guess or hint has
been submitted. An untouched game with zero guesses and zero hints is instead
abandoned and excluded from statistics. The browser shows the loss warning only
when the reset will count.
Qualifying wins count in `winsNoHints` and in exactly one 1–6 guess bucket.
Opening the first hint warns that games using hints do not count toward guess
distribution; confirming it permanently excludes that game. Hinted games remain in raw development game
history so they can still be inspected and debugged.

Signed-in players can view both categories at `/stats`. The page reads the
HTTP-only account session through `GET /api/auth/me`; signed-out visitors are
prompted to log in from the game page.

Development builds include a read-only account dashboard at
`http://localhost:8787/dev/accounts.html`. It lists safe account metadata,
session counts, all-game totals, no-hint totals, guess distributions, and recent
game history. Authentication secrets are never returned by its dev-only APIs.
Localhost is trusted for development. A remote development deployment requires a
valid Cloudflare Access JWT whose issuer and audience match `TEAM_DOMAIN` and
`POLICY_AUD`; otherwise the admin APIs reject it. Production returns `404`.

The browser owns presentation, keyboard input, the non-authoritative possible-
word counter, and local visual customization.

## Backend API

- `POST /api/games`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/logout-all`
- `PUT /api/auth/password`
- `DELETE /api/auth/account`
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

Development and production outputs are deliberately separate. Running a
production verification while the local development Worker is open cannot
replace its CSS/JavaScript asset manifest or break the localhost page.

Run the complete local and CI verification with:

```sh
npm run check
```

The test suite covers duplicate-letter scoring, hardcore constraints, answer-
pool integrity, anonymous game authorization, every D1 migration, and regular
versus no-hint statistics. GitHub Actions runs the tests and verifies both build
variants on pushes and pull requests.

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
with Cloudflare Access: its dev-only reveal endpoint intentionally discloses the
answer for debugging. In Cloudflare Zero Trust, create a self-hosted application
for the development hostname, allow only the admin identities, and copy its
Application Audience (`AUD`) tag. Configure these Worker values for the dev
environment:

```text
TEAM_DOMAIN=https://your-team.cloudflareaccess.com
POLICY_AUD=the-access-application-audience-tag
```

The Worker validates the `Cf-Access-Jwt-Assertion` signature, issuer, audience,
expiry, and not-before time. Keep the full-database reset local-only even after
Access is configured.

To use a custom development hostname, add a Worker custom domain such as
`dev.wordle.example.com` to `wordle-dev`, then use that exact hostname for the
Access application. The zone must already exist in the same Cloudflare account.
The provided `workers.dev` hostname is Cloudflare's default Worker address; the
word `dev` there does not mean it is your development build.

Do not point the development binding at the production D1 database. Configure
Cloudflare branch builds so `main` deploys production and the development branch
deploys only `wordle-dev`.
