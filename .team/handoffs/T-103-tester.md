# Handoff: T-103 Log a free-trial block when the estimate refuses the trial

From: tester  To: reviewer

## What changed
- Branch: `feature/T-103-log-estimate-block` (PR #203). Test files only.
- Added `src/lib/server/free-trial-t103-tester.test.ts` (8 unit tests, pass locally) and `tests/api/estimate-block-log-tester.test.ts` (5 API tests, CI only, no Docker here).
- Verdict: PASS with findings (no blocker). Full local suite, lint, prettier, tsc green.

## How to verify
`npx vitest run` (all pass). API: `npx vitest run -c vitest.api.config.mts tests/api/estimate-block-log-tester.test.ts` in CI.

## Findings
1. MEDIUM, admin list ignores the counter. `listAdminFreeTrialBlocks` (`src/lib/server/admin-engagement.ts` ~line 308) does not select the `attempts` column; it computes `attempts` as the number of rows for customer+reason. The builder handoff says "the admin list reads `attempts`": it does not. With the 60-minute dedupe, 3 refreshes in one hour show `attempts: 1` in the admin list while the column says 3. Pinned by an API test ("admin list `attempts` counts ROWS"). Fix choice for Planner/Jimmy: select the column in the list, or accept row count. The README says "repeats counted": true in the column, not on screen.
2. LOW, a thrown (not returned) rpc error is not swallowed: `recordTrialBlock` only handles `r.error`. A rejected promise would go through `advisoryTrial`'s catch, be rethrown and fail the estimate with 500, against "log failure never fails the estimate". supabase-js normally returns errors, so unlikely. Pinned as KNOWN GAP in a unit test.
3. INFO / product question, own held claim: a customer whose first free booking is still pending, who ticks the box on a second estimate, logs reason `customer` (also for a consumed claim). Same as POST /api/bookings would. A released claim (declined, cancelled) logs nothing. It is a legitimate refusal but not abuse, so the admin list can show honest customers who simply re-estimate. Jimmy may prefer to log only phone and address matches. Unconfirmed builder choice stays unconfirmed.
4. INFO, attempts inflation confirmed as the builder said: each refresh is one attempt (10 parallel estimates give one row, counter 10, no duplicate rows: advisory lock works). Because of finding 1 the admin never sees this inflation.
5. INFO, `docs/api-contract.md` conflicts with origin/main: both PRs claim "Status: v1.22" (T-097 also). `git merge origin/main` failed on that single line; I aborted and did not resolve (doc text). Planner/builder must renumber (this one would be v1.23) at merge time. README did not conflict.
6. INFO, mock mode: the mock adapter's estimate does not add a block row, so README step 5 "open the list right after the estimate" is accurate only on the seeded real stack (which the demo section uses), not in mock mode.

## Checked and fine
- Reasons: customer, phone, address each map to the right reason; customer wins when all three match (same order as POST /api/bookings); released claim and eligible customer log nothing; box off logs nothing; missing phone or address logs nothing.
- Privacy: rows have only customer id, reason, counts, times; admin list items have only id, customer, reason, createdAt, attempts; customer response carries no rule name, phone, address or hash (API test asserts it).
- Response shape unchanged (`freeTrial: { eligible: false, blocker: "USED" }`, labour charged).

## Known gaps or risks
API tests were not run locally; CI is the check.

## What the next agent needs
Decide finding 1 (and 3) before merge; renumber the contract version (finding 5).
