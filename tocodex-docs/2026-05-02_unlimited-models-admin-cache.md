# Unlimited models, admin UX, and cache improvements

## Summary
- Added a persisted `rpdExempt` model flag for Admin-controlled unlimited models.
- Enforced unlimited-model behavior server-side only after trusted route resolution, so request-body flags, tags, aliases, and duplicate provider-model aliases cannot make normal models bypass RPD.
- Updated Admin UI with multi-tag selection, markdown/color description support, a dedicated Unlimited section, redesigned request log cards, and improved incident card containment.
- Lazy-loads model-card videos with `IntersectionObserver` while preserving quality.
- Improved Redis exact-match caching by canonicalizing cache keys and removing double-counted cache misses.
- Updated README and changelog notes for the new behavior.

## Changed files
- `server/index.js` — secure route lookup, RPD exemption enforcement, request log markers, canonical cache keys, cache metric fix.
- `src/types.ts` — added `Model.rpdExempt`.
- `src/data/models.ts` — defaulted seed/new models to `rpdExempt: false`.
- `src/api.ts` — added `cacheHit` and `rpdExempt` to request log typing.
- `src/App.tsx` — added Admin Unlimited section, tag dropdown/chips, markdown/color model descriptions, lazy video wrapper, request log cards.
- `src/styles.css` — added styles for glass descriptions, lazy video states, tags, unlimited routes, request log cards, and responsive improvements.
- `README.md` — documented unlimited-model security behavior.
- `src/data/changelog.ts` — added changelog entries for unlimited models and request-log UI.

## Validation
- `node --check server/index.js`
- `npm run build`
- `git diff --check`
