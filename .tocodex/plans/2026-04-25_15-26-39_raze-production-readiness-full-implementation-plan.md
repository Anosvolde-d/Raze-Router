---
created: 2026-04-25T15:26:40.000Z
status: active
---
# RAZE Production-Readiness — Full Implementation Plan

## Gap Analysis Summary

After reading every file, here are the **concrete missing pieces** vs the requirements:

### Backend (`server/index.js`) — 8 gaps
1. **No streaming (SSE)** — `proxyCompletion` buffers the entire response with `upstream.text()`, then dumps it. Needs to pipe the upstream readable stream to the client when `stream: true`.
2. **No Anthropic→OpenAI normalization** — Anthropic `/v1/messages` responses are forwarded raw (different schema). Must translate to OpenAI format (`choices[0].message.content`, `usage`, etc.) for `/v1/chat/completions` calls targeting Anthropic.
3. **No Redis exact-match caching** — Redis is only used as a config store, not as a request cache. Need SHA-256 hash of `(modelId, messages)` → cached response with TTL.
4. **No TPM (tokens-per-minute) tracking** — only RPM (requests-per-minute) per key. Need a second bucket tracking token spend per key per minute.
5. **Synchronous DB writes block request path** — `touchUserKey` and `writeRequestLog` are awaited before returning the response. Need to `setImmediate`/detach these writes so the user gets their answer immediately.
6. **No observability** — no structured logging of latency, status, model, tokens. Need clean JSON log lines to stdout (Railway native log viewer), with optional Prometheus `/metrics` endpoint.
7. **CORS wildcard fallback** — when `RAZE_CORS_ORIGIN` is empty, it falls back to `*`. In production, this should be a hard deny or at least log a warning.
8. **No `GOOGLE_*` env vars in `.env.example`** — the three Google OAuth vars are missing from the example file.

### Frontend (`src/App.tsx` + `src/api.ts`) — 5 gaps
1. **Local profile creation still present** — `Dashboard` has email/username/avatarUrl fields + `saveProfile()` calling the old `createUserSession`. This must be removed; replace with "Sign in with Google" button and avatar file-drop.
2. **Ctrl+M admin gate still present** — `useEffect` on line 68 of `App.tsx` adds a keyboard shortcut to open admin. This is a test harness artifact; remove it.
3. **`LoginModal` still has "Skip for now"** — must be replaced with real Google OAuth redirect button.
4. **`StatsBar` shows hardcoded test values** — ("AUTH MODE: TEST", "ADMIN: LOCKED"). Should pull from live state.
5. **Landing hero copy** — "fully built on vibe coding, cuz im too lazy" is in the hero h1. Needs production copy.

### Content (`src/data/changelog.ts`) — 1 gap
- Has `v0.3.0-test` entry with `status: 'Planned'` and test-era language.

### Config files — 2 gaps
- `.env.example` missing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
- `nixpacks.toml` missing `npm ci` in install phase explicitly (Railway usually handles it but being explicit is safer).

---

## Files to Change (7 files)

| File | Changes |
|---|---|
| `server/index.js` | Streaming SSE pipe, Anthropic→OpenAI normalization, Redis request cache, TPM bucket, async DB writes, structured JSON logging + `/metrics` endpoint, CORS warning |
| `src/api.ts` | Add `startGoogleAuth()`, `logout()`, `uploadAvatar()`, remove `createUserSession` usage |
| `src/App.tsx` | Remove Ctrl+M gate, remove local profile creation from Dashboard, replace LoginModal with Google button, fix StatsBar, fix hero copy |
| `src/styles.css` | Add Google button + avatar drop zone styles (small additions) |
| `src/data/changelog.ts` | Remove test entries, update to production-only release history |
| `.env.example` | Add Google OAuth vars, add observability vars |
| `nixpacks.toml` | Add explicit install phase |

---

## Implementation Steps (in order, single-dependency chain)

1. **`server/index.js`** — all backend fixes (streaming, normalization, cache, TPM, async writes, logging, metrics, CORS)
2. **`src/api.ts`** — Google auth helpers, avatar upload, remove old local session creation
3. **`src/App.tsx`** — UI/UX production cleanup (remove test artifacts, Google-only auth flow, avatar drop)
4. **`src/data/changelog.ts`** — clean release history
5. **`.env.example`** + **`nixpacks.toml`** — config cleanup
6. Run `npm run build` to validate, then git push

---

## Railway Environment Variables (final list after changes)

| Variable | Required | Notes |
|---|---|---|
| `RAZE_ADMIN_KEY` | ✅ Yes | Strong random string, admin panel access |
| `GOOGLE_CLIENT_ID` | ✅ Yes | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | ✅ Yes | From Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | ✅ Yes | `https://yourdomain.railway.app/auth` |
| `DATABASE_URL` | ✅ Yes | Auto-injected by Railway PostgreSQL |
| `REDIS_URL` | ✅ Yes | Auto-injected by Railway Redis |
| `RAZE_CORS_ORIGIN` | ✅ Yes | Your frontend origin, e.g. `https://yourdomain.railway.app` |
| `RAZE_PROVIDER_KEY` | Conditional | Default fallback key if not using per-model secrets |
| `PORT` | Auto | Railway injects this automatically |
| `RAZE_RATE_LIMIT_PER_MINUTE` | Optional | Default 60 |
| `RAZE_MAX_BODY_BYTES` | Optional | Default 1000000 |
| `RAZE_DATA_DIR` | Optional | Default `.data` (local JSON fallback) |
| `LOG_LEVEL` | Optional | `info` or `debug` |

Shall I proceed with full implementation of all 7 files?