# Handoff: T-120 Mock guard decides production by Next phase

From: backend  To: tester

## What changed
- Branch: `feature/T-120-mock-guard-phase`
- Pull request: see PR titled "T-120: Mock guard decides production by Next phase" (Closes #234)
- `next.config.ts:35`: default export is now `config(phase)`. `production` is true only for `PHASE_PRODUCTION_BUILD` or `PHASE_PRODUCTION_SERVER` (from `next/constants`). NODE_ENV is no longer read. The old config object is `buildConfig()` (line 11), unchanged.
- `src/lib/t118-mock-guard.test.ts` (wiring block): loads the real config and calls it per phase. New cases: NODE_ENV=development/test/production with build and server phases refused without ALLOW_MOCK_BUILD; allowed with ALLOW_MOCK_BUILD=1; dev, test and export phases untouched even with NODE_ENV=production; Vercel refused in every phase, including "0" with ALLOW_MOCK_BUILD=1.
- `src/lib/t105-next-config-csp.test.ts`: loader calls the config function with the dev phase (CSP does not depend on phase).
- No README or security-review text mentions NODE_ENV for this guard, so no doc change.
- `src/lib/mock-guard.ts` unchanged; all T-118 protections kept.

## How to verify
- `npx vitest run` : 150 files, 3244 passed. With the old next.config.ts, 5 new wiring tests fail (test-first confirmed).
- `npm run lint` clean; `npx tsc --noEmit` clean (after `npx next typegen`).
- `NEXT_PUBLIC_API_MOCK=1 npx next build` and with `NODE_ENV=development`: both fail with the T-118 guard message. With `ALLOW_MOCK_BUILD=1` the build succeeds. `next dev` starts and serves 200.

## Known gaps or risks
- `next start` after a build runs `PHASE_PRODUCTION_SERVER`, so it is guarded as before. Not run locally (e2e-mock port 3101 not touched).

## What the next agent needs
- Builder choice: Vercel/mock-flag check still runs in every phase (as before), only the ALLOW_MOCK_BUILD rule depends on the phase.
- Builder choice: `phase-export` is treated as non-production (not in Jimmy's list).

## Fix round 1
- Tester LOW-1: added `it.each` in `src/lib/t118-mock-guard.test.ts` (line 89, in `mockBuildProblem`) for ALLOW_MOCK_BUILD = "true", "yes", "0", " 1", "1 ", "", "2", "on": each must still be refused in a production build with mock=1.
- Bite check: temporarily changed the check to `!env.ALLOW_MOCK_BUILD`; 7 of 8 new cases failed (the "" case is falsy so it passes either way). Restored `src/lib/mock-guard.ts` (no diff). Behaviour unchanged.
