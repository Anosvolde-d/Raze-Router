# RAZE Router

RAZE is a free AI router test web app for a Discord server community. It presents a live-feeling model registry, cinematic model cards, a user command dashboard, an admin-controlled registry panel, and visible release history.

RAZE is completely free for everyone. There are no subscriptions, billing screens, paid plans, upgrade prompts, or access tiers.

## Test build

Current version: `v0.1.0-test`

This build is a frontend prototype with local seeded data. Real routing, real Google authentication, Discord role mapping, and backend persistence are placeholders for later implementation.

Test access behavior:

- `Continue with Google` is a non-functional test placeholder.
- `Skip for now` enters preview mode.
- Temporary test password: `1234`.

Replace all test-only access behavior before production use.

## Features

- Brutalist/premium landing page
- Autonomous terminal boot hero
- Animated system stats
- Model explorer with filtering and sorting
- Copyable model IDs
- Capability icons with hover tooltips
- Dynamic model cards with optional linked video backgrounds
- User dashboard without billing or credit concepts
- Local admin panel prototype
- Admin-editable video background URL preview
- Changelog and version roadmap

## Run locally

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Release roadmap

- `v0.1.0-test` — landing page, hero, stats, model showcase
- `v0.2.0-test` — model explorer and user dashboard
- `v0.3.0-test` — admin panel and routing control prototype
- `v0.4.0-test` — Discord integration and release history placeholders

## License

Apache-2.0 intended for this repository.
