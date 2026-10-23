# Handoff: T-116 Fix e2e-mock addStyleTag navigation race

From: tester  To: reviewer

## What changed
- Branch: `feature/T-116-e2e-style-race`
- Pull request: see the PR for branch `feature/T-116-e2e-style-race` ("Closes #225")
- Files: `e2e-mock/helpers.ts` (new exported `hideDevOverlay`, an init script; `openPage` uses it), and the specs `booking-flow-mock`, `booking-flow-tester`, `chef-detail-mock`, `chef-detail-tester`, `search-mock`, `search-t040-tester-mock`, `allergy-profile-mock`, `allergy-profile-tester-mock`, `t077-tester-mock` (no more `addStyleTag` after `goto`; the specs call `hideDevOverlay` in `beforeEach`, `t077` uses `openPage`), `e2e-mock/t052-a11y-mock.spec.ts` (two waits in `axeClean`), `docs/work-orders/WO-T116-e2e-style-race.md`.
- No application code changed. No assertion or axe rule removed. `grep addStyleTag e2e-mock` now only matches a doc comment.

## How to verify
- `npx playwright test --config playwright.mock.config.ts --retries=0` : 376 passed.
- Touched specs, `--repeat-each=5 --retries=0`: 490 of 490 passed.
- `t052-a11y-mock` `--repeat-each=5 --workers=6 --retries=0`: 205 of 205 passed.
- `npx eslint e2e-mock` and `npx prettier --check e2e-mock` clean.

## Known gaps or risks
- t052:82 cause is timing, not an axe-rule problem. Before the fix it failed 2 of 18 under 5 workers (`/verify-phone | document-title`): Next streams the route `<title>` after the body, so axe can run before it exists. `axeClean` now waits `toHaveTitle(/\S/)`. The `region` failure on `/bookings` was not reproduced after the title fix; the likely cause is the Suspense fallback in `src/app/bookings/page.tsx` (a bare `<p role="status">Loading...</p>` outside any `<main>`) being scanned while a stale visible h1 satisfied the test wait. `axeClean` now also waits for no visible "Loading..." text. This second cause is inferred, not reproduced.
- App nit, not changed: the Suspense fallbacks on guarded pages sit outside a landmark, so a real screen-reader user can hit a `region` finding for a moment. Planner decides whether to fix.

## What the next agent needs
- Check that `hideDevOverlay` runs in `beforeEach` before the first `goto` in each spec (an init script only affects documents loaded after it).
- Builder choices (not confirmed by Jimmy): one exported idempotent helper instead of per-spec copies; waits in the t052 helper instead of changing the app.
