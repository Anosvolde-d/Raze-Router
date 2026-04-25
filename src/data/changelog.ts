import type { ChangelogEntry } from '../types'

export const changelog: ChangelogEntry[] = [
  {
    version: 'v0.4.0',
    label: 'Production router',
    date: '2026-04-25',
    status: 'Live',
    notes: [
      'Full SSE streaming for all providers',
      'Anthropic → OpenAI response normalization on /v1/chat/completions',
      'Redis exact-match request cache with per-model TTL',
      'Tokens-per-minute (TPM) rate limiting per API key',
      'Asynchronous DB writes — responses returned immediately',
      'Structured JSON logs to stdout + Prometheus /metrics endpoint',
      'Google OAuth2 — only verified Google accounts can create sessions',
      'Avatar file-drop with base64 storage in database',
      'Session-gated API key generation (Google auth required)',
      'Hashed key storage — only fingerprints shown in admin',
      'Request logging with token estimates and incident codes',
      'Context-length validation before provider calls',
      'RPM + TPM rate limiting per key',
      'PostgreSQL and Redis with local JSON fallback',
      'Dark chat playground with safe debug preview',
      'Admin panels for users, keys, request logs, and incidents',
      'Provider secret isolation — keys never in model config',
      'Railway deployment ready (Dockerfile + Nixpacks)',
    ],
  },
  {
    version: 'v0.2.0',
    label: 'Admin shell',
    date: '2026-04-24',
    status: 'Live',
    notes: [
      'View-based navigation',
      'Admin gate and provider endpoint setup',
      'Cache controls and model card editor',
    ],
  },
]
