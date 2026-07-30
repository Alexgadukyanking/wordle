# Wordle

A browser-based Wordle game hosted on Cloudflare Workers.

## Project structure

- `index.html`, `style.css`, `script.js`, `words.js`, and `assets/` are the frontend.
- `src/worker.mjs` is the backend Worker.
- `wrangler.jsonc` connects the Worker backend and static frontend.
- `.assetsignore` prevents backend source and configuration files from being published as frontend assets.

## Backend API

The initial API intentionally provides only diagnostic endpoints:

- `GET /api`
- `GET /api/health`

Future account, daily puzzle, and database endpoints can be added under `/api/`.

## Deployment

Cloudflare deploys the repository with:

```sh
npx wrangler deploy
```

Pushing to the `main` branch triggers the connected Cloudflare build.
