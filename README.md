# Five

A browser-based five-letter word game hosted on Cloudflare Workers.

## Project structure

- `index.html`, `style.css`, `script.js`, `public/words.js`, and `public/assets/` are the frontend.
- `src/worker.mjs` is the backend Worker.
- `src/dev/` contains development-only browser tools.
- `wrangler.jsonc` connects the Worker backend and static frontend.
- Vite generates a clean `dist/` directory; Cloudflare publishes only that directory.

## Backend API

The initial API intentionally provides only diagnostic endpoints:

- `GET /api`
- `GET /api/health`

Future account, daily puzzle, and database endpoints can be added under `/api/`.

## Development builds

Install dependencies and start the local development frontend:

```sh
npm install
npm run dev
```

The development build contains a clearly marked debug panel with current-word,
game-state, and reset controls. Build it without deploying:

```sh
npm run build:dev
```

Run the complete Worker and frontend in the isolated Cloudflare `dev` environment:

```sh
npm run dev:worker
```

## Production builds

Production builds exclude the development panel and its source chunk:

```sh
npm run verify:prod
```

The verification command fails if any debug filename, selector, or UI marker is
found in the generated production artifact.

## Deployment

Cloudflare deploys the repository with:

```sh
npm run deploy:prod
```

Pushing to the `main` branch triggers the connected Cloudflare build.

The isolated development Worker can be deployed separately with:

```sh
npm run deploy:dev
```

Configure Cloudflare branch builds so that `main` runs `npm run deploy:prod`
and non-production branches run `npm run deploy:dev`. Do not merge this build
configuration until those Cloudflare commands are ready, because Wrangler now
publishes the generated `dist/` directory rather than the repository root.
