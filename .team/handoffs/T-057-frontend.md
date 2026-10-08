# Handoff: T-057 Connect auth UI to real routes

From: frontend  To: tester

## What changed
- Branch: `feature/T-057-auth-integration`
- Pull request: see PR for branch (Closes #62)
- Mock is off by default: `.env.example` has `NEXT_PUBLIC_API_MOCK=` blank; `isMockEnabled()` is true only for exactly `1`. The mock adapter is loaded by dynamic `import()` in the mock branch of `apiFetch` only.
- Route guards (`src/lib/auth/route-guard.ts`, used in `src/components/AccountBar.tsx` on every route change, from GET /api/me): signed-out on /verify-phone or /address goes to /login; signed-in on /login or /signup goes to /. After log-in (`LoginForm`) the next step comes from `nextOnboardingStep(me)`: /verify-phone if `private.phoneVerified` is false, else /address if `private.address` is null, else /.
- `signedIn:false` sign-up shows the "Check your email" screen. The mock returns it for `confirm@example.com`.
- Logout error clears after the next successful /api/me check. Playwright uses `reuseExistingServer: false`. Login e2e alert locators are scoped to `main` (Next's route announcer also has role=alert).
- E2E: `e2e/auth-real.spec.ts` (real routes, local Supabase), `e2e-mock/auth-mock.spec.ts` (mock, `playwright.mock.config.ts`, port 3101), `e2e/home.spec.ts` (smoke).
- CI (`.github/workflows/ci.yml`, job still `ci`): the e2e step now evals `supabase status -o env`; two steps: `npm run test:e2e` then `npm run test:e2e:mock`.
- Other files: `src/lib/api/client.ts`, `client.test.ts`, `src/components/AuthForms.tsx`, `src/lib/mocks/mock-adapter.ts`, `package.json`, `.gitignore`, `.prettierignore`.

## How to verify
- `npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run build` pass.
- `npm run test:e2e:mock` (no Docker): 6 tests pass.
- `npm run test:e2e` without a stack runs only the smoke test. With a stack: `set -a; eval "$(supabase status -o env)"; set +a; npm run test:e2e` runs 7 tests (smoke + 6 real-route tests). Real-route run was proven in CI only (no Docker locally).

## Known gaps or risks
- Guards are client-side (AccountBar), so a brief render of the page happens before redirect. Server-side guards were not requested.
- A network failure on GET /api/me is treated as signed out (redirects private pages to /login).
- The sign-up rate limit (10/hour/IP, in-memory) is shared by the e2e run (about 7 sign-ups per run).
- `signedIn:false` is tested in mock mode only: local Supabase has email confirmation off.

## What the next agent needs
- Real e2e uses unique emails/phones per run (`e2e-<tag>-<random>@example.com`, 416555xxxx). Test pepper `e2e-test-pepper-not-a-secret` is in `playwright.config.ts`.
- Try breaking: reload on /verify-phone while signed in with verified phone (stays allowed), visit /address in a second tab after logout.
