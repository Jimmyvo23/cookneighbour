# Handoff: T-120 Tester

From: tester  To: reviewer
Head tested: f7ba72f

## Verdict: PASS

## Results
- `npx vitest run`: 150 files, 3244 passed, 3 expected fail. `npm run lint` clean. `npx tsc --noEmit` clean.
- Real `next build` (mock, NODE_ENV, ALLOW_MOCK_BUILD):
  - mock=1 with NODE_ENV unset, development or production, no allow: refused (T-118 message).
  - mock=1 with ALLOW_MOCK_BUILD=0: refused.
  - mock=1 with ALLOW_MOCK_BUILD=1: build OK.
  - mock off: OK.
  - mock=1, NODE_ENV=development, ALLOW=1: passes the guard; fails later in prerender of /_global-error ("useContext of null"). Same failure with no mock flag, so it is Next's known NODE_ENV=development build problem, not this change.
- Simulated Vercel: VERCEL=1 with mock=0 and ALLOW=1: refused. VERCEL=1 with mock=1 and ALLOW=1: refused. VERCEL=1 with no flag: build OK.
- `next start` (production-server phase), after a normal build:
  - mock=1, no allow: refused (also with NODE_ENV=development).
  - mock=1, ALLOW=1: serves 200.
  - VERCEL=1, mock=0, ALLOW=1: refused.
  - no mock: 200.
- `next dev`: mock=1 starts and serves 200, even with NODE_ENV=production (phase wins). VERCEL=1 mock=1: refused.
- Bite tests (t118 + t105 files, each restored afterwards, git status clean):
  - phase check always true: 1 fail. Always false: 3 fail. Server phase dropped: 3 fail. NODE_ENV used again: 3 fail.
  - flag rule removed: 4 fail.
  - Vercel rule removed: 3 fail. Vercel rule skipping "0": 2 fail. Vercel rule only in production phases: 1 fail.
  - ALLOW rule loosened to "any non-empty value": 0 fail (see LOW-1).
- Builder choices: Vercel rule in all phases is covered by a test and bites. phase-export is treated as non-production (acceptable; Jimmy's list had only build and server). The T-105 CSP test loads the dev phase (`t105-next-config-csp.test.ts:15`), correct since CSP is phase independent.

## Findings
- LOW-1 (test gap, not a regression): `src/lib/mock-guard.ts` requires `ALLOW_MOCK_BUILD === "1"`, but no unit test proves "0", "true" or "yes" are refused (`src/lib/t118-mock-guard.test.ts`, no case near line 84). Changing the check to `!env.ALLOW_MOCK_BUILD` passes the suite. Real build with ALLOW=0 is refused today. Suggest one extra case.
- LOW-2: `next dev` rewrites `tsconfig.json` in the worktree (Next auto change); I reverted it. Not part of the PR.

## Not run
- e2e-mock (port 3101) left to CI per lessons-learned.
