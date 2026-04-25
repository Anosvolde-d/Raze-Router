# RAZE Router

RAZE is a free AI router and live model registry for Discord communities. It provides model discovery, route testing, provider configuration, caching policy, session-gated API key generation, request logging, incident tracking, and admin-controlled model cards.

RAZE is completely free for everyone. No subscriptions, billing, paid plans, upgrade prompts, credits, invoices, or access tiers.

## Current version

`0.4.0`

## Architecture

- **Frontend**: Vite + React + TypeScript
- **Backend**: Node.js HTTP server (`server/index.js`)
- **Storage**: PostgreSQL (primary), Redis (cache), local JSON (fallback)
- **Deployment**: Railway (Dockerfile or Nixpacks)

## Features

- Session-gated API key generation (keys require a valid user profile)
- Hashed key storage with fingerprint-only display in admin
- Request logging with input/output/total token estimates and incident codes
- Context-length validation before provider calls
- Rate limiting and request size limits
- Provider secret isolation (keys never stored in model config)
- Dark chat playground with safe debug preview (no provider brand names)
- Admin panels for users, keys, request logs, and incidents
- CORS origin configuration, admin key authentication
- PostgreSQL and Redis support with local JSON fallback
- Graceful shutdown for Railway redeployments

## API endpoints

| Method | Path                  | Auth         | Description                          |
|--------|-----------------------|--------------|--------------------------------------|
| GET    | /health               | None         | Health check                         |
| GET    | /api/config           | None         | Public model list                    |
| GET    | /v1/models            | None         | OpenAI-compatible model list         |
| GET    | /api/session          | Session      | Get current user                     |
| POST   | /api/session          | None         | Create or resume session             |
| POST   | /api/keys             | Session      | Generate API key                     |
| POST   | /v1/chat/completions  | Bearer rz_*  | Chat completion proxy                |
| POST   | /v1/messages           | Bearer rz_*  | Anthropic messages proxy             |
| GET    | /api/admin/config     | Admin        | Full store (redacted secrets)        |
| PUT    | /api/admin/config     | Admin        | Save store                           |
| POST   | /api/admin/secrets    | Admin        | Save provider secret                 |
| POST   | /api/admin/keys       | Admin        | Create admin API key                 |
| POST   | /api/admin/test-route | Admin        | Test route connectivity              |
| POST   | /api/admin/users/:id  | Admin        | Ban/unban user                       |
| POST   | /api/admin/keys/:id   | Admin        | Activate/revoke key                  |
| GET    | /api/admin/incidents/:code | Admin   | View incident details                |
| POST   | /api/admin/maintenance | Admin       | Clear models/incidents/keys          |

## Run locally

```bash
cp .env.example .env
# Edit .env with your admin key and optional provider key
npm install
npm run dev          # frontend dev server
npm run dev:server   # backend in separate terminal
```

Build and run:

```bash
npm run build
npm start
```

## Deploy to Railway

1. Connect your repo to Railway
2. Add a PostgreSQL service and a Redis service in the same project
3. Set environment variables:
   - `RAZE_ADMIN_KEY` - your secure admin key
   - `RAZE_PROVIDER_KEY` - your provider API key (or use per-model secret names)
   - `RAZE_CORS_ORIGIN` - your frontend origin (optional, defaults to `*`)
4. Railway auto-detects the Dockerfile or Nixpacks config
5. The `start` command runs `node server/index.js`
6. Railway injects `DATABASE_URL`, `REDIS_URL`, and `PORT` automatically

## Environment variables

| Variable                     | Default              | Description                         |
|------------------------------|----------------------|-------------------------------------|
| `PORT`                     | 3000                 | Server port (Railway injects this)  |
| `RAZE_ADMIN_KEY`           | (empty, admin disabled) | Admin authentication key        |
| `RAZE_DATA_DIR`            | .data                | Local JSON storage directory        |
| `RAZE_PROVIDER_KEY`        | (none)               | Default provider API key            |
| `RAZE_CORS_ORIGIN`         | *                    | Allowed CORS origin                 |
| `RAZE_RATE_LIMIT_PER_MINUTE`| 60                  | Requests per minute per bucket      |
| `RAZE_MAX_BODY_BYTES`      | 1000000              | Max request body size               |
| `DATABASE_URL`             | (none)               | PostgreSQL connection string        |
| `REDIS_URL`                | (none)               | Redis connection string             |

## Security notes

- Provider API keys are never stored in model config; they are stored in environment variables or the dedicated `raze_secrets` PostgreSQL table
- User API keys are hashed with SHA-256; only fingerprints are shown in admin
- Raw provider keys are detected and automatically migrated to safe secret names on startup
- The `/health` endpoint returns no internal paths or configuration
- Internal errors return a generic `internal_server_error` with no stack traces
- Admin routes require the `RAZE_ADMIN_KEY` via `X-Admin-Key` header or `Authorization: Bearer` header
- All admin-saved models and provider configs are validated and sanitized

## License

Apache-2.0
