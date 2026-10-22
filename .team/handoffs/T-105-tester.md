# Handoff: T-105 T-100 and T-098 Reviewer follow-ups

From: tester  To: reviewer

## What changed
- Branch: `feature/T-105-review-lows` (PR #208). Tester commit adds tests only.
- Files: `src/lib/t105-next-config-csp.test.ts` (new), `e2e-mock/t100-tester-csp-mock.spec.ts` (framing test fixed), this handoff.

## How to verify
- `npx vitest run src/lib/t105-next-config-csp.test.ts src/lib/security-headers.test.ts` -> 7 + 9 pass. Full `npx vitest run`: 3085 pass, 3 expected fail.
- `npx playwright test -c playwright.mock.config.ts t100-tester-csp-mock` -> 3 pass (works locally after `npm ci` in the worktree).

## Results
1. CSP fails closed: PASS. Only NODE_ENV "development" gets 'unsafe-eval' and 127.0.0.1; "production", "test", "", unset, "Development" get the production policy. Verified at the cspOptionsFromEnv level (builder) and through the real `next.config.ts` headers() (new test). No code in CI/tests/scripts reads NODE_ENV other than this file; e2e servers are `npm run dev` (development), so unchanged.
2. Framing test: the builder's version was VACUOUS (HIGH, fixed here). With both X-Frame-Options and frame-ancestors removed it still passed, because current Chromium blocks a public page (evil.test) framing a loopback URL with net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS whatever the headers say. The control iframe pointed at evil.test, so it could not detect this. Fix: launch flag `--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessForNavigations` (test.use at file top) so only our headers decide, plus a console assertion that Chromium reported the block because of frame-ancestors / X-Frame-Options. Bite test: both headers removed -> test FAILS (form visible in frame); restored -> passes. Removing only one header still passes (the other still blocks; defence in depth).
3. Removed `API_URL` check in `e2e/home.spec.ts`: covered by `cspOptionsFromEnv` unit test "uses NEXT_PUBLIC_SUPABASE_URL" (https + wss in connect-src, absent when unset) and by my next.config wiring test. PASS.
4. Docs: data-model.md matches the migration (trigger `reviews_a_guard_insert`, `reports_guard_insert`, 42501, service-role writes). api-contract 7D line 616 matches. LOW leftovers: `docs/api-contract.md:603` still says "the policy falls back to the booking's `updated_at`" (should be "the trigger"; Reviewer T-098 note 1) and calls `reviews_guard_insert` a trigger (it is the function; trigger is `reviews_a_guard_insert`); line 616 ends with ".)." (double full stop). Not blocking.

## Known gaps or risks
- The launch flag disables a Chromium protection in the mock e2e browser only (test-only, loopback app).
- Playwright's real-stack suite not run locally (needs Supabase stack; not touched).

## What the next agent needs
Nothing else; CI result is in the PR checks.
