# Battlefield Blitz: notes for agents

- This is the game code only. Its landing page (`/blitz/`) and game page (`/blitz/play/`) live on
  the DOM Battlefield site (repo `dom-battlefield`, `site/src/pages/blitz/`) so they inherit the
  Battlefield brand and styling. dombattlefield.com will host both the original and Blitz.
- Built on Fizlet (`vendor/fizlet`) and Sherman sprites (`shared/`): snapshots with ORIGIN.json.
  Never edit them by hand: change the owning repo, then `node scripts/sync.mjs`.
- No runtime dependencies. Dev tools only: typescript, esbuild, playwright.
- `dist/` is committed (what dom-battlefield ships). Rebuild with `npm run build`; CI fails if it
  differs. Budgets: `npm run size`. Tests: `CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:browser`.
- Release: bump `package.json` (+ lockfile), rebuild, CHANGELOG, push `main`; CI tags. Then in
  dom-battlefield: `node scripts/sync-blitz.mjs` and release the site.
