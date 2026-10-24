Reviewer: APPROVE

T-120 "Mock guard decides production by Next phase", PR #235, head d1fb266, base main 9af7d4b. I read the full diff (`git diff 9af7d4b...HEAD`), the handoffs `.team/handoffs/T-120-backend.md` and `.team/handoffs/T-120-tester.md` (PASS), CLAUDE.md and docs/lessons-learned.md.

## Verification I ran myself
- `npx vitest run`: 150 files, 3252 passed, 3 expected fail. The two touched files (t118, t105) give 43 passed.
- `npm run lint`: clean. `npx tsc --noEmit`: clean. Worktree is clean after the runs.
- `gh pr checks 235`: checks, e2e-mock, supabase and the `ci` gate all pass on d1fb266.
- No secrets in the diff. No `.env` files touched.

## Scope
The PR stays inside WO-T120: `next.config.ts`, two test files and two handoffs. `src/lib/mock-guard.ts` is unchanged, so every T-118 protection and D-178 rule is still there.

## Phase logic (next.config.ts:35-41), checked against Next 16.4.2 `next/constants`
- `phase-production-build` (`next build`, and also `next typegen` and `next post-build`): production, so the ALLOW_MOCK_BUILD rule applies. Correct.
- `phase-production-server` (`next start`): production. Correct.
- `phase-development-server` (`next dev`): not production. Correct, and the README already says dev is not protected.
- `phase-test` (next/jest): not production. Correct.
- `phase-export`: not production. Sound in practice: `next build` with `output: "export"` passes the config it already loaded in the build phase into `exportApp` (node_modules/next/dist/build/index.js:428-430). The guard has already run by then. This project does not use `output: "export"`.
- `phase-info` (`next info`, `next upgrade`) and `phase-analyze`: not production. Neither one produces a deployable output.
- NODE_ENV is no longer read by the guard. A host that builds with NODE_ENV=development now hits the ALLOW_MOCK_BUILD rule. This closes T-118 INFO-1.
- The Vercel rule does not depend on the phase, so on Vercel any non-blank flag is refused in every phase, including "0" with ALLOW_MOCK_BUILD=1. D-178 holds.

## Readers of NEXT_PUBLIC_API_MOCK
None were missed. The only runtime reader is `src/lib/api/client.ts:10` (`isMockEnabled`), which goes through `mockAllowed`. `page-guard.ts`, the chat and the uploader all call that function. The Playwright configs set the flag on purpose. T-120 does not change runtime gating, and it did not need to.

## Test quality
The tests would catch a regression. The wiring tests load the real `next.config.ts` and call it for each phase:
- build and server refused without the opt-in under NODE_ENV production, development and test (t118-mock-guard.test.ts:146-158);
- the opt-in allowed;
- dev, test and export left alone even with NODE_ENV=production (:173);
- Vercel refused in every phase, including "0" (:137).
The Tester's bite runs (phase always true or false, server phase dropped, NODE_ENV used again, Vercel rule moved into the production phases) all fail the suite. The fix-round case for LOW-1 (:89-99) proves that only an exact "1" opts in.

## Docs
README (lines 84, 123, 177), `.env.example:23` and `docs/security-review.md` item 5 are still accurate. None of them says NODE_ENV drives this guard, so no doc change was needed.

## Findings (none blocking)
- INFO-1 (next.config.ts:38-39): production is decided by a list of production phases, so any phase not on the list counts as non-production. That includes a phase a future Next version might add. Strictly, that is "fail open for unknown phases". It cannot be exploited today, because the only deployable outputs come from the build and start phases. A stricter option for later is `production = phase !== PHASE_DEVELOPMENT_SERVER && phase !== PHASE_TEST`. Jimmy decides whether to bother.
- INFO-2 (package.json `typecheck`): `next typegen` loads the config in `phase-production-build` (node_modules/next/dist/cli/next-typegen.js:83) and reads `.env.local`. So with `NEXT_PUBLIC_API_MOCK=1` in `.env.local`, `npm run typecheck` stops with the guard message unless `ALLOW_MOCK_BUILD=1` is set. This already happened under T-118 (typegen defaulted NODE_ENV to production). It now also happens with NODE_ENV=development. It fails closed, and CI is unaffected (the flag is blank there). One README sentence would save a confused developer.
- INFO-3 (out of scope, src/lib/security-headers.ts:53): the T-105 CSP still picks its development relaxations from `NODE_ENV === "development"`, not from the phase. A host that builds with NODE_ENV=development would get the looser dev CSP. In practice Next's own build already fails in that mode (Tester saw the /_global-error prerender failure). Possible follow-up task. Not part of this Work Order.
- NIT (t118-mock-guard.test.ts:132): the `as unknown as ... Promise<NextConfig>` cast is no longer needed, because the default export is typed `(phase: string) => NextConfig`. It does no harm.

## Builder choices for Jimmy
1. The Vercel rule applies in all phases: sound. It matches D-178 ("refused on Vercel, even 0"). It costs nothing, because nobody runs `next dev` on Vercel, and a test covers it.
2. `phase-export` counts as non-production: sound. That phase only runs with a config the build phase has already checked (see above). Treating it as production would change nothing in practice. INFO-1 is the broader version of this choice.
3. The T-105 CSP test loads the dev phase (t105-next-config-csp.test.ts:15): sound. `buildConfig()` does not use the phase, and loading a non-production phase keeps the CSP test separate from the mock-guard rules it is not testing.

Verdict: APPROVE. Ready to merge under D-42 (green `ci` plus this comment).
