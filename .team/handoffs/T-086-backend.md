# Handoff: T-086 Shift booking days in a safe order in test helpers

From: backend  To: tester

## What changed
- Branch: `feature/T-086-flaky-shiftdays`
- Pull request: see `gh pr list --head feature/T-086-flaky-shiftdays` (Closes #166)
- Files (tests only, no app, SQL or migration changes):
  - `tests/api/shift-order.ts` (new): pure `orderForShift(days, n)`: ascending `visit_date` when n > 0, descending when n < 0, with a comment on why.
  - `tests/api/booking-helpers.ts`: `shiftDays` now loops over `orderForShift(...)`.
  - `tests/api/shift-order.test.ts` (new): pure tests, input in shuffled order. No database needed.
  - `tests/api/shift-days.test.ts` (new): 3-day booking (+3,+4,+5) shifted by 1 then -1 against local Supabase (CI only).

## Root cause
`shiftDays` selected days with no `order by` and updated them one at a time. The partial unique index `booking_days_one_per_chef_date` is checked per row, so moving day 2 first onto day 1's date raised 23505. Row order varies, hence the flake.

## Other helpers checked (grep `visit_date` + `update` in tests/)
- `tests/rls/kitchen-followups-tester.test.ts` `moveDays`: per-row updates, but all targets are in the past (offsets -2, -10..-7, -11..-8, -30, -40) and sources are future or earlier-ascending; day i's target is never a date still held by a later row. Safe, left alone.
- `tests/rls/contact-privacy.test.ts` `setLastDay`: loops by `day_number` 1 then 2, both moving earlier; no clash. Safe (deterministic order).
- `tests/rls/kitchen-followups.test.ts` and `tests/rls/flag-freeze.test.ts`: one update for a booking that has a single day. Safe.
- `tests/rls/escalation.test.ts:407`: an update expected to be denied. Not a shift.
- Only other caller pattern: `shiftDays` callers (api tests) all go through the fixed helper.

## How to verify
- Local: `npm run lint`, `npm run typecheck`, `npx prettier --check .`, `npm test` all pass (2133 passed, 3 expected fail).
- Pure test: with a throwaway vitest config (node env, include `tests/api/shift-order.test.ts`) 3 pass; replacing the sort with a no-op fails 2.
- CI `supabase` job runs `shift-days.test.ts` and the previously flaky `auto-complete-on-pickup.test.ts`.

## Known gaps or risks
- API tests cannot run locally (no Docker). The DB regression test passes with either order only if Postgres happens to return rows in the good order; the deterministic proof of the order rule is the pure test.

## What the next agent needs
- To prove the regression: revert the `orderForShift` call in `shiftDays` to the old unordered loop and note that `shift-order.test.ts` still tests the helper in isolation; for the DB flake, look at CI repeat runs of `auto-complete-on-pickup.test.ts`.
