import type { ChangelogEntry } from '../types'

export const changelog: ChangelogEntry[] = [
  {
    version: 'v0.2.0-test',
    label: 'Production-grade test shell',
    date: '2026-04-24',
    status: 'Live',
    notes: ['View-based navigation', 'Ctrl+M admin gate', 'provider endpoint setup', 'cache controls'],
  },
  {
    version: 'v0.3.0-test',
    label: 'Backend router integration',
    date: 'Planned',
    status: 'Planned',
    notes: ['Persist models', 'secure secrets', 'real Google auth', 'Discord role mapping'],
  },
]
