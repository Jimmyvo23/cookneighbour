# Handoff: T-113 Fix flaky admin a11y and link-retry e2e-mock tests

From: tester  To: reviewer

## What changed
- Branch: `feature/T-113-flaky-admin-a11y`
- Pull request: see the PR for this branch
- Files: `e2e-mock/helpers.ts`, `e2e-mock/t052-a11y-mock.spec.ts`, `e2e-mock/admin-t036-tester-mock.spec.ts`, this handoff. No `src/`, scripts, config or workflow changes.

Root cause (CI run 39888495979, attempt 1):
1. `t052-a11y-mock.spec.ts:149` failed twice with `page.addStyleTag: Execution context was destroyed` at `openPage` (helpers.ts:170), called from the spec's admin loop (line 162). `openPage` did `goto` then `addStyleTag`. `/admin` is a client `redirect("/admin/chefs")` (src/app/admin/page.tsx), so the redirect navigation can land between `goto` (resolves on load) and `addStyleTag`. Fix: `openPage` now adds the overlay-hiding rule once per page with `addInitScript` (a constructable stylesheet, so CSP cannot block it); it runs in every document, so nothing is lost on a navigation. The loop also waits for the final URL of each path before axe scans. No axe rule dropped.
2. `admin-t036-tester-mock.spec.ts:279` (flaky): after two fixed `fastForward("00:31")` jumps, `links-stale` was still shown. The test's own comment says the fake clock can run ahead of the mock's real async work; the next retry is only scheduled after the in-flight call ends, so two jumps are not always enough on a slow runner. Fix: `expect.poll` jumps 31 s and re-counts until the notice is gone (bounded 30 s). The assertion is the same (`links-stale` count 0); the later "no more calls" and "renewal exactly once" checks are unchanged.
3. Found while repeating: the chef axe test scanned `/chef/apply` straight after sign-up without waiting for the page (failed once locally with landmark-one-main and page-has-heading-one on a page being left). Added a URL and h1 wait before that scan.

## How to verify
- `npm run test:e2e:mock -- e2e-mock/t052-a11y-mock.spec.ts e2e-mock/admin-t036-tester-mock.spec.ts --repeat-each=10 --retries=0`: 40 admin a11y runs and 10 link-retry runs passed (before fix 3; the only failures were the pre-existing local issue below).
- `-g "chef: apply|admin: queue|link retry" --repeat-each=15 --retries=0`: 105 passed, 0 failed.
- `npx prettier --check e2e-mock/*.ts` clean.

## Known gaps or risks
- Locally only, `t052-a11y-mock.spec.ts:82` "customer: verify-phone..." fails every time (region .sr-only on /bookings, document-title on /address) on this branch, on unchanged main and in the main folder. It passes in CI. Not caused by this task; not investigated.
- Locally the first mock run after a pause can end with "chrome-error" because the dev server prints a Next.js upgrade reminder and stops; running the same command again works. Local only.
- Other specs still call `page.addStyleTag` after `goto` in their own local helpers (booking-flow, search, chef-detail and others). They did not flake; left alone as out of scope.

## What the next agent needs
Check the diff keeps every assertion (only waits were added; the timer test polls instead of two fixed jumps). Wait for the `ci` gate.
