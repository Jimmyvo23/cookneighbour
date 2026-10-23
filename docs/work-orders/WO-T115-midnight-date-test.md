# Work Order WO-T115: Midnight-safe bookings API date test

Task: T-115 (tester builds, like T-113), Issue #224. Branch `feature/T-115-midnight-date-test`, worktree `../CookNeighbour-wt-T115`. Jimmy 2026-10-23: "Approve (Recommended)". Parallel with T-116 and T-118.

| Agent | Task | Plan | Effort | Risk |
|---|---|---|---|---|
| tester | T-115 | `tests/api/bookings.test.ts` "a booked date leaves bookableDates and the search date filter; today never shows" got `[10-24, 10-25]` instead of three days on run 39897551788 (04:00 UTC = 00:00 Toronto): the chef's ticked days are computed before midnight and the app's "today" after. Make the test boundary-safe (recompute expectations from the API's own window, or detect a crossed day and retry/skip) without weakening what it proves. Grep for the same pattern in sibling API tests and fix it in the same file set only if identical. Tests only. | S | API tests run only in CI (no Docker) |
| reviewer | T-115 review | Same assertions still proven; no new flake. | S | Low |
