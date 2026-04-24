# RAZE Router

RAZE is a free AI router test web app for a Discord server community. It is a production-minded frontend shell for model discovery, route testing, provider configuration, caching policy, and admin-controlled model cards.

RAZE is completely free for everyone. There are no subscriptions, billing screens, paid plans, upgrade prompts, credits, invoices, or access tiers.

## Test build

Current version: `v0.2.0-test`

This build is frontend-only. Real routing, real Google authentication, Discord role mapping, backend persistence, and secret storage must be added before production deployment.

Test access behavior:

- `Continue with Google` is a non-functional test placeholder.
- `Skip for now` enters preview mode.
- Admin is hidden: press `Ctrl + M`, then enter `1234`.
- Do not ship the test code gate in production.

## What changed

- View-based navigation instead of one long scroll page.
- Hidden admin dashboard opened with `Ctrl + M` and the test code.
- Rebuilt playground as a route request preview workspace.
- Stripped fake usage/session content and replaced it with real empty states.
- Added admin model setup for:
  - OpenAI-compatible base URLs
  - Anthropic custom endpoints
  - Provider model IDs
  - Secret labels instead of raw key storage
  - Cache modes for Anthropic, OpenAI-compatible providers, hybrid, or off
  - Cache TTL and stable-prefix toggles
- Improved model card video handling with visible fallback/error state when a video URL cannot play.

## Run locally

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Production notes

Before using RAZE with real users:

- Move provider calls behind a backend proxy.
- Store provider secrets server-side only.
- Replace the test admin code with real auth and authorization.
- Connect Google login and Discord role mapping.
- Persist models, route configuration, cache policy, and changelog data in a database.
- Validate direct video URLs server-side if admins can submit media links.

## License

Apache-2.0 intended for this repository.
