# Ranking redesign and model groups

## Summary
- Redesigned the Ranking page with system typography, rounded cards, animated tabs, animated card entry, and animated progress fills.
- Added Lucide icons across ranking tabs, status wrappers, vote buttons, avatars, and admin group controls.
- Added Admin Ranking groups so admins can map model families to HTTPS logo URLs and show those logos as ranking avatars.
- Extended backend ranking payload/config normalization to persist groups and expose group logo metadata safely.

## Changed files
- `package.json`
- `package-lock.json`
- `server/index.js`
- `src/api.ts`
- `src/App.tsx`
- `src/styles.css`
- `tocodex-docs/2026-05-03_ranking-redesign-groups.md`

## Validation
- `npm run build`
- `git diff --check`
