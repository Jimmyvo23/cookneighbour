# Handoff: T-057 Connect auth UI to real routes

From: tester  To: reviewer

## Verdict: PASS (no blockers; 3 non-blocking recommendations)

## What changed
- Branch: `feature/T-057-auth-integration` (commit cd00f54), PR #64, Issue #62. Tester changed no files (verification only).

## Evidence
1. CI: `ci` pass on #64 (run 37715304156). Log: real-route e2e "Running 7 tests ... 7 passed" (smoke + 6 real-route, including "real routes: no MOCK API badge"); mock e2e is a separate step "6 passed". No retries or flakes in the log.
2. Fresh clone of the branch: npm ci, lint, typecheck, prettier, test (89 passed), build all pass. `npm run test:e2e` without Docker: 1 smoke test passed (real-route spec correctly skipped). `npm run test:e2e:mock`: 6 passed. (Real-route run proven in CI only; no Docker here.)
3. Mock off by default: production build with the var unset: no "MOCK API" badge, page load sent real `GET /api/me`, the mock chunk was never requested. Build with `NEXT_PUBLIC_API_MOCK=1`: badge shown, mock chunk loaded on demand. `confirm@example.com` marker string lives only in a separate dynamic chunk, not the shared/main chunks. `isMockEnabled()` is true only for exactly "1".
4. Real e2e: `playwright.config.ts` forces `NEXT_PUBLIC_API_MOCK=""`, takes URL/keys only from `supabase status -o env` env vars (empty when absent), pepper is the literal `e2e-test-pepper-not-a-secret`. Grep of .github, e2e, e2e-mock and the configs found no `secrets.*`, no `supabase.co`, no JWT-like keys. CI runs on a throwaway local stack; the hosted project is never referenced. `reuseExistingServer:false` avoids silently hitting a stale server.
5. Guards (route-guard.ts + AccountBar on every pathname change): signed-out on /verify-phone or /address -> /login; signed-in on /login or /signup -> /; post-login order phone -> address -> / (nextOnboardingStep). Covered by unit tests, the real "route guards" test and the mock "route guards" test. Observations (not blockers, guards are client-side by design): a signed-in user with an unverified phone can open /address directly (no redirect back to /verify-phone); /verify-phone stays reachable when already verified (stated as intended); a /api/me network failure counts as signed out.
7. Accessibility: axe-core (wcag2a/aa, 2.1) on mock-mode production build: /signup, /login, login after submit, post-signup landing, /address: 0 violations. Keyboard flow unchanged (focus-on-error test passes in e2e).

## Flakiness (item 6): real risk, not yet a failure
- The limiter (10/hour/IP, in memory) counts every sign-up request, including ones that later fail validation or 409. All e2e traffic shares the key "unknown" (no x-forwarded-for), across both workers, in one dev-server process. A run uses exactly 7 attempts (account test 1, guard 1, duplicate email 2, wrong password 1, phone refused 2). Margin is 3.
- CI `retries: 1` re-runs a failed test's sign-ups. One retried test is fine. Retrying the duplicate-email and phone tests (2 each) or any 3 tests gives 11+ and the retry fails with 429, hiding the real cause. The dev server restarts each run, so counters reset between runs (re-runs are not a problem).
- Minor: phones are random `416555xxxx` (10,000 values); on a persistent local DB a collision with an earlier verified number gives a 409 in the verify step (about 1 in 10,000 per leftover number, grows over many local runs).

## Recommendations (non-blocking)
1. Preferred, no app change: give each test its own client IP, e.g. in `auth-real.spec.ts` use `test.use({ extraHTTPHeaders: { "x-forwarded-for": <random per test> } })` (clientIp trusts the first x-forwarded-for entry), so each test gets its own bucket.
2. Alternative: an env override for the limit that is ignored when `NODE_ENV === "production"`, set in `playwright.config.ts` webServer env. This changes app code, so it needs the backend.
3. Make the phone generator use a wider range or `Date.now()` suffix to cut collisions.

## How to verify
- `npm ci && npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run build && npm run test:e2e && npm run test:e2e:mock`
- With Docker: `set -a; eval "$(supabase status -o env)"; set +a; npm run test:e2e` (expect 7 passed).

## Known gaps or risks
- Real-route e2e not run locally (no Docker); relied on CI log.
- Rate-limit flake risk above. Client-side guards flash the page before redirecting (known, accepted).

## What the next agent needs
- Throwaway scratch artifacts (axe and probe scripts) are outside the repo; nothing to merge from the tester.
