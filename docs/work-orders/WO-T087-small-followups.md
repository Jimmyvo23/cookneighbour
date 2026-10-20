# Work Order WO-T087: Small review follow-ups

Tasks: T-087. Branch `feature/T-087-small-followups`, worktree `../CookNeighbour-wt-T087`. Runs beside WO-5c (backend, separate files).

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| frontend | T-087 | Three small changes. (1) `.github/workflows/*.yml`: add `timeout-minutes` to the `ci` gate job (T-084 LOW). (2) `src/components/refusal.tsx`: `trimEnd()` the last text before the `[.!?]$` punctuation check, so "Done. " doesn't get an extra full stop (T-083 NIT-1), with a unit test. (3) `src/lib/mocks/mock-booking-changes.test.ts`: a comment explaining that the T-085 duplicate-date test groups by date because the mock seed has one chef (T-083 NIT-2). The whole task goes to Frontend, including the CI line, so Backend stays free for T-048. | S | Low |
| tester | T-087 checks | The refusal punctuation unit test (trailing spaces, existing punctuation, none), the full unit suite, and the `ci` gate job showing the timeout. | S | Low |
| reviewer | T-087 review | The diff matches the three items and nothing else; the timeout value is sensible against the slowest job. | S | Low |

## Left out
Anything else in the CI workflow.

## Decision
Decide ids `WO-T087-frontend`, `WO-T087-tester`, `WO-T087-reviewer`.
