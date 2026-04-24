import type { ChangelogEntry } from '../types'

export const changelog: ChangelogEntry[] = [
  {
    version: 'v0.1.0-test',
    label: 'Landing + model showcase',
    date: '2026-04-24',
    status: 'Live',
    notes: ['Boot hero', 'system stats', 'video model cards', 'brutalist footer'],
  },
  {
    version: 'v0.2.0-test',
    label: 'Model explorer + dashboard',
    date: '2026-04-24',
    status: 'Live',
    notes: ['Filters', 'sorting', 'copyable IDs', 'operator dashboard modules'],
  },
  {
    version: 'v0.3.0-test',
    label: 'Admin panel + routing control',
    date: '2026-04-24',
    status: 'Live',
    notes: ['Local model editing', 'video URL previews', 'routing controls', 'test access'],
  },
  {
    version: 'v0.4.0-test',
    label: 'Discord integration + release history',
    date: 'Planned',
    status: 'Planned',
    notes: ['Role mapping', 'server identity', 'public release history'],
  },
]
