# Model ranking and dashboard usage

Date: 2026-05-03

## Summary

Added the Model Ranking feature, request-backed usage counters, dashboard RPD/token widgets, admin ranking boosts, and the v0.5.0 admin visibility toggle. The ranking board is off by default; admins can publish it from the Admin Ranking panel while stored scores, boosts, and usage counters remain preserved.

## Changed files

- `server/index.js` — added ranking storage normalization, default-off ranking visibility, request usage counters, rankings API, vote endpoint, dashboard stats endpoint, and admin boost endpoint.
- `src/api.ts` — added ranking/dashboard usage types, ranking visibility, and client API helpers.
- `src/App.tsx` — added toggleable Ranking navigation/view, dashboard usage widgets, compact token formatting, and admin ranking boost/visibility controls.
- `src/styles.css` — added ranking board, usage widget, admin toggle, and admin boost styling.
- `README.md` — documented v0.5.0 ranking visibility, dashboard usage, API endpoints, and server-side enforcement notes.
- `src/data/changelog.ts` — added the v0.5.0 changelog entry for the ranking and usage dashboard work.
- `package.json` — bumped the package version to 0.5.0.
- `package-lock.json` — synced the lockfile package version to 0.5.0.

## Validation

- `npm run build` passed successfully.
- `git diff --check` passed for the changed feature files.
