# Handoff: T-106 + T-104 Flaky booking-real e2e; T-052 test gaps

From: tester  To: reviewer

## What changed
- Branch: `feature/T-106-booking-real-flake`
- Pull request: see PR "T-106 + T-104: Fix flaky booking-real e2e; T-052 test gaps"
- Files: `e2e/booking-real.spec.ts`, `e2e-mock/t052-panels-mock.spec.ts` (new), this handoff. No application code.

## Root cause (T-106)
The test "demo step 2" (`e2e/booking-real.spec.ts:154`) is a long journey that runs against the Next dev server, which compiles each page on first visit, with 2 Playwright workers on a CI runner. It takes 22.9 to 27.8 s when it passes, and the Playwright default test timeout is 30 s, with a 5 s default for each `expect`. So it fails whenever the runner is a little slow. No wrong state was ever shown; the logs are all timeouts.
Evidence (CI logs, `supabase` job):
- Run 39704313968 (PR #202): attempt 1 `Test timeout of 30000ms exceeded` while waiting `getByTestId('status')` to contain "Cancelled" (received "Waiting for the chef to answer", 7 polls, then the 30 s cap hit). Retry #1: `review-heading` not visible in 5 s (`expect ... Timeout: 5000ms`, line 151, second booking review). Both are timeouts at slow steps.
- Run 39786886882 attempt 1 (PR #206): `✘ booking-real.spec.ts:154 (30.0s)`, retry #1 `✓ (26.0s)`.
- Same pattern (30.0 s fail then 22.9 to 26.6 s pass on retry): runs 39704919914 (30.0 then 26.6) and 39706375109 (30.0 then 22.9). Passing first attempts: 27.8 s (39704428109), 27.6 s (39701127238).
- The other long test (`demo-path-real.spec.ts:259`, 48.6 s) already sets its own larger timeout, so this one is the only long test left on the default.
The log proves slowness is the only cause (no assertion saw a wrong end state), so the fix is a larger budget, not a changed step.

## Fix
- `test.setTimeout(120_000)` for that one test (matches the style of `demo-path-real.spec.ts`).
- `SLOW_STEP_MS = 20_000` for the two expects that wait on an API call plus a possible first compile: `review-heading` (in `fillAndReview`) and the "Cancelled" status. Nothing else was loosened; no assertion was removed.

## T-104 (T-052 Reviewer NITs)
New `e2e-mock/t052-panels-mock.spec.ts`: strict axe (WCAG A/AA + best-practice, nothing disabled) at 375 px, desktop and 375 px dark, with focus checks:
- Pickup "I picked up my meals": opening puts focus on the question heading, axe clean with the panel open, "Not yet" (keyboard) closes it and returns focus to the opener, axe clean after.
- Saved-profile "Delete saved profile": focus on the question (`confirm-delete`), `Confirm delete` group visible, axe clean open, "Keep it" returns focus to the opener, "Yes, delete it" moves focus to the saved-state line, axe clean after.
- Not checked: `aria-atomic="false"` on the refusal alert was NOT tried with a real screen reader (NVDA, VoiceOver, JAWS). The browser tests prove markup and focus order only.
- Note: `t071-pickup-confirm-mock` and `allergy-profile-mock` already covered one axe run and the opener focus at one view; the new file adds the strict tag set at three views and the post-close axe and delete-success focus.

## How to verify
- `npx playwright test -c playwright.mock.config.ts e2e-mock/t052-panels-mock.spec.ts` : 6 passed locally.
- `npx eslint e2e e2e-mock` and `npx prettier --check` pass.
- The real-stack spec needs Docker (not on this Mac), so it runs only in CI `supabase`.

## Known gaps or risks
- If CI gets slower than 120 s for this test something else is wrong; the dev-server compile time itself is not reduced.
- Local `tsc` fails in a fresh worktree on `PageProps`/`LayoutProps` (Next typegen not run); unrelated, CI typecheck is the check.

## What the next agent needs
Test-only change. Look at CI results for the supabase job in the PR (rerun evidence is in the PR comments).

## CI evidence (PR #209, run 39794981686)
- Attempt 1: all green, `supabase` 47 passed with no retry; "demo step 2" passed first try in 32.6 s, which is over the old 30 s cap (it would have failed before).
- Attempts 2 and 3: `supabase` cancelled at the 25 min job limit with no test failure. Attempt 2 sat in `playwright install --with-deps` (slow azure.archive.ubuntu.com downloads, about 10 s per package). Attempt 3 install took 9 min, 40 of 47 tests had passed when the limit hit. This is the same "cancelled at 25m" seen on PR #206; it is runner/mirror slowness, not this test. Possible follow-up for the Planner: raise the `supabase` job `timeout-minutes` or cache browsers (not changed here, outside tests).
- Attempt 4: all green.
