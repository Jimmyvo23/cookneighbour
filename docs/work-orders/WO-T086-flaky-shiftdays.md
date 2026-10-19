# Work Order WO-T086: Flaky `shiftDays` test helper

Tasks: T-086. Approved by Jimmy 2026-10-19 (D-91).

PR #165's CI failed in `tests/api/auto-complete-on-pickup.test.ts` ("2 days: day 1 confirmed and day 2 not cooked") with 23505 (`booking_days_one_per_chef_date`). `shiftDays` in `tests/api/booking-helpers.ts` moves a booking's days one row at a time, in the order the select returns them (no `order by`). When a multi-day booking moves earlier and the later day is updated first, it lands on the earlier day's date for the same chef. The same code passed on `main` minutes before: the failure depends on row order.

| Agent | Task | Plan (100 words or fewer) | Effort | Risk |
|---|---|---|---|---|
| backend | T-086 fix | Branch `feature/T-086-flaky-shiftdays`. In `shiftDays`, order the updates so no row ever lands on a date another row of the same booking still holds: ascending `visit_date` when moving earlier (n > 0), descending when moving later. Check other helpers that move several `booking_days` rows (grep `visit_date` updates in `tests/`) for the same pattern and fix them the same way. Tests only. | S | Another helper with the same pattern missed |
| tester | T-086 checks | Show the old helper fails when rows come back in the bad order (e.g. a unit-style API test that forces the order), and the new one passes; run the API suite in CI. | S | Low |
| reviewer | T-086 review | Review the helper change and any other helpers touched. | S | Low |
