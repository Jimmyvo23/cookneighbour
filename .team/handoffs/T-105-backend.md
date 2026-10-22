# Handoff: T-105 T-100 and T-098 Reviewer follow-ups

From: backend  To: tester

## What changed
- Branch: `feature/T-105-review-lows`
- Pull request: see PR "T-105: T-100 and T-098 Reviewer follow-ups"
- Files: `src/lib/security-headers.ts` (new `cspOptionsFromEnv`, dev only when `NODE_ENV === "development"`), `next.config.ts` (uses it), `src/lib/security-headers.test.ts` (+3 tests), `e2e-mock/t100-tester-csp-mock.spec.ts` (framing test with positive controls), `e2e/home.spec.ts` (vacuous host check removed, comment points to unit test), `docs/api-contract.md` (7D wording: trigger, service-role write, INFO note on 42501), `docs/data-model.md` (review/report insert text). No migration, `Status:` line untouched.

## How to verify
- `npx vitest run src/lib/security-headers.test.ts` -> 9 pass.
- Mock e2e `t100-tester-csp-mock.spec.ts` "hostile page": top-level /login shows Email, the control iframe (evil.test/control) shows "control-ok", 2 iframes exist, the app frame never shows the form. Not run locally (worktree cannot run Turbopack with a symlinked node_modules); CI runs it.

## Known gaps or risks
- Builder choice: item 3 resolved by moving the assertion to a unit test (the e2e dev server adds the local host anyway), not by keeping a weaker e2e check.
- Builder choice: the first CI run failed because a blocked frame never leaves about:blank in Playwright, so the wait is the control frame plus load plus a 1.5 s settle (the old settle), not a poll on the frame URL.
- e2e dev servers run NODE_ENV=development, so e2e behaviour is unchanged; Vitest (`test`) gets the production policy.

## What the next agent needs
Check the framing test fails if the `X-Frame-Options`/`frame-ancestors` headers are removed (temporarily) to confirm it is not vacuous.

## Round 1
Docs only, `docs/api-contract.md`: line 603 now "trigger `reviews_a_guard_insert` (function `reviews_guard_insert`)" and "the trigger falls back to the booking's `updated_at`"; line 616 double full stop fixed. The only remaining "policy" in 7D is "replaces the policy `reviews_insert_party`", which is correct history.
