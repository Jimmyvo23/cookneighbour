# Handoff: T-079 RLS date clash in booking-api.test.ts

From: tester  To: reviewer

## What changed
- Branch: `feature/T-079-rls-date-clash`
- Pull request: see PR "Closes #141"
- Files: `tests/rls/booking-api.test.ts`, `tests/api/groceries-tester.test.ts`, `docs/lessons-learned.md`

## Root cause (evidence)
Test bug, not a product bug. `chefs_booked_on(p_day)` correctly lists every approved chef with an active booking that day (SQL checked in `20261011100100_booking_api.sql`). The test asserted an exact list `[chef.id]` for `far(5)` = Toronto today + 15.
`tests/rls/booking-changes.test.ts` (L5 test, `lastDays`) books three chefs on the literal date `2026-10-31` (one customer_home chef plus two chef_home chefs with eatOffset 1 and 6). The 3 extra ids in the CI failure match this count. Toronto 2026-10-16 + 15 = 2026-10-31. Failing runs (2026-10-16 14:43 UTC) were on that day; green runs up to 00:57 UTC on 10-16 (Toronto 10-15 evening, +15 = 10-30) were not. The RLS config has `fileParallelism: false`, so it is leftover rows from an earlier file in the same DB, not parallelism. The failure will not recur after 2026-10-16 for this date, but other literal dates (2026-10-20, 10-24, 10-30, 11-01, 2027-xx) would hit the same exact asserts on their own days.
No debug CI commit was made; the date arithmetic plus the exact count of 3 is the evidence.

## Fix
All exact `chefs_booked_on` lists in booking-api.test.ts (far(10), far(12), far(5) x2, far(20) x2) now assert only this test's chef (`toContain` / `not.toContain`). Outside-window `[]` asserts kept (always empty).

## Separate flake found
Main run on 340dcc4 failed a different test: `tests/api/groceries-tester.test.ts:157` `not.toMatch(/markup|fee/i)` matched "fee" inside the random signed-URL token of `fileUrl`. Fixed by excluding `fileUrl` from the string checked.

## How to verify
lint, typecheck, `prettier --check .`, `npm test` pass locally. RLS and API tests run only in CI: `ci` must be green (rerun once).

## Known gaps or risks
Other exact-list asserts on non-public data were not changed (they use their own chefs). Hardcoded 2027 dates in contact-privacy-tester will enter the window later; harmless now that the public-list asserts are id-scoped.

## What the next agent needs
Lessons-learned section 3 has a new row.
