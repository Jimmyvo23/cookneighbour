# Handoff: T-081 Auto-complete a chef's-home booking when every day is picked up

From: backend  To: tester

## What changed
- Branch: `feature/T-081-auto-complete-on-pickup` (from main e784cc4)
- Pull request: see the PR titled "T-081: Auto-complete a chef's-home booking when every day is picked up" (Closes #159)
- Migration: `supabase/migrations/20261020100000_auto_complete_on_pickup.sql` (NOT pushed to hosted; the Planner asks Jimmy after merge)
- Files: that migration; `src/lib/domain/bookingChanges.ts` (+ test) `completesOnPickup`; `src/lib/server/booking-changes.ts` (free-trial follow after a completing confirm); `src/lib/mocks/mock-booking-changes.ts` (+ `mock-pickup-confirm.test.ts`); `tests/api/auto-complete-on-pickup.test.ts` (new); `tests/api/pickup-confirm.test.ts`, `tests/api/pickup-confirm-gaps.test.ts` (updated for the new rule); `tests/rls/booking-changes.test.ts`; `e2e-mock/t081-complete-on-pickup-mock.spec.ts` (new); `docs/api-contract.md` (v1.14).

## The rule as built (D-81, D-83)
An `accepted` chef's-home booking becomes `completed` right away once EVERY active day is cooked (`cooked_at`) AND confirmed (`picked_up_at`).
- Confirm path: `change_booking` `pickup_confirm` sets `picked_up_at`, then, if `booking_all_picked_up(booking)` and no `open`/`reviewing` report, completes in the same locked transaction (same booking lock as before; lock order unchanged: chef, chef_private, bookings by id, day row).
- Sweep path: `sweep_booking_changes` due filter is now `booking_auto_complete_at <= now() OR booking_all_picked_up`. Frozen, no-cooked-day and open-report bookings are still skipped. Covers a report closed later, or any path that skipped the confirm.
- Otherwise nothing changes (D-33 time, chef's home waits for every pickup deadline, D-36 flag). Customer's home unchanged (`booking_all_picked_up` is false for it; confirm is still 409 `not_chef_home`).
- Side effects (same as auto-completion): status `completed`, `completed_at`, open/agreed pickup proposals voided, open `no_day_cooked` flag resolved (D-57), `booking_completed` notice to both parties (text "Every day was cooked and picked up, so this booking was completed automatically. You can now leave a review."; chef also gets `pickup_confirmed`), free trial consumed via `applyFreeTrialEvent` after the save (route: `pickup_confirm` with `status === "completed"`).
- Frozen: confirm is refused 409 `frozen` before anything (D-65), sweep skips frozen. Unchanged.
- Added (my choice, small): repeating a confirm of an already confirmed day on a booking that is now `completed` answers 200 `completed` (idempotent; double click / stale page) with no second notice, instead of 409 `wrong_status`. Other statuses still give `wrong_status`.
- Open problem report: keeps the booking `accepted` (as for every completion); the sweep completes it once the report is closed. (My choice, mirrors the sweep and `complete`; the work order did not say.)

## Cancelled-day choice
An inactive (`is_active = false`) day is ignored (not a day to cook), but at least one active day is required. In practice an `accepted` booking has no inactive day (no-show and missed pickup end the booking). Stated in the contract.

## Consequences to know
- `pickup/missed` after the last confirm is 409 `wrong_status` (booking completed), so `pickup_confirmed` now only appears while another day is still open. Existing API tests updated (single-day tests that confirmed then expected `accepted`/`pickup_confirmed`; the confirm/missed race; propose on a confirmed day now uses 2 days; "visit done" after the only day's confirm is 409).
- Mock hook `pickedUpSeeded` still seeds an `accepted` booking with every cooked day picked up (a stale-page fixture for T-080/T-071 specs). The real server cannot reach that state for a one-day booking any more; the specs still pass and I left the hook alone. Tester may want a Planner decision.
- UI: no change needed. Mock e2e (all 267 + the new spec) pass; after the completing confirm the page shows the Completed status and keeps the "Picked up on" line (new spec `t081`).
- PLAN.md A-29 text still says auto-completion unchanged; I did not edit PLAN.md (Planner's file). The contract A-29 wording is updated.
- T-082 Reviewer NIT: the contract Tables line for GET /api/bookings now names `booking_flags` via `get_bookings_frozen`.

## How to verify
- Unit: `npx vitest run` -> 92 files, 2126 passed, 3 expected fail (the 3 are existing xfails).
- `npm run lint`, `npm run typecheck`, `npx prettier --check src docs tests` clean.
- Mock e2e: `npm run test:e2e:mock` -> 267 passed (before adding my 1 spec; the new spec passes alone).
- SQL checked locally with pglite (lessons 7): 1 day completes + two notices, repeat ok, 2 days partial stays accepted, both completes and resolves the flag, customer home false/refused, frozen refused and skipped by sweep, sweep completes all-picked-up and leaves partial, open report blocks.
- API and RLS tests run in CI only: new `tests/api/auto-complete-on-pickup.test.ts` (9 tests), updated pickup-confirm tests, and a new RLS test comparing SQL `booking_all_picked_up` with TS `completesOnPickup` (7 cases) plus `booking_all_picked_up` in the server-only list. No new browser-callable function, so the privileges snapshot in `visibility.test.ts` is unchanged.

## Known gaps or risks
- API/RLS tests were not run locally (no Docker). CI first run failed on one stale test (missed after both days confirmed), fixed; second run green.
- Mock has no problem-report concept, so the open-report guard is not mirrored there.

## What the next agent needs (Tester ideas)
- Race: confirm day 1 and a chef "cooked" for day 2 in parallel; two confirms of different days at once on a 2-day booking (both cooked): exactly one completes, no double notice.
- Race: chef `missed` vs the last confirm (updated test covers 1 day).
- A report opened between cooked and confirm; admin resolving it, then any booking route: completes via sweep and the trial is consumed (route-level sweep applies the claim).
- `no_day_cooked` flagged booking where the chef marks a late day cooked and the customer then confirms.
- Customer's-home booking with `picked_up_at` forced in the DB must not complete.
- Free trial claim state `consumed` after the confirm; a second trial attempt blocked.

## Round 2 (Reviewer LOW-1, LOW-2; Tester LOW-1)
- LOW-1: the mock hook `pickedUpSeeded` now marks only the FIRST cooked day as picked up, and a one-day booking (A05) gets an uncooked, unconfirmed day 2 added by the hook (copy of day 1, tomorrow, deadline +2 days), so it never seeds a state the server cannot produce. Docs updated in `mock-bookings.ts`. `t080-reload-after-409-mock.spec.ts` edit now sets day 1 picked up and adds an open day 2 (its stale `pickup_confirmed` 409 is then reachable on the real server too). `t071-pickup-confirm-mock` and `t071-tester-mock` specs needed no change and pass. New unit test for the hook in `mock-pickup-confirm.test.ts`.
- LOW-2: contract line now says a repeat confirm of an already confirmed day returns 200 on ANY completed booking (completed by the confirm or later by the sweep); a completed booking whose day was not confirmed is still 409 `wrong_status`. No behaviour change.
- NIT-1 left alone (not trivial enough to touch the migration again).
- Checks: lint, typecheck clean; vitest 92 files, 2127 passed + 3 expected fail; full mock e2e 270 passed.

## Round 3 (Reviewer LOW-4, LOW-5: unrealistic mock dates)
- LOW-5: the `pickedUpSeeded` hook's added day 2 (`mock-booking-changes.ts`) now has its own dates like `seedRow`: dish `eatByDate = addDays(date2, shelf)` and `pickupDeadlineDate = addDays(date2, shelf)`, where the shelf is the gap between day 1's date and the dish's eat-by date (new helper `shelfGap`). Comment says the estimate still covers the original single day. `date2` is the Toronto "today + 1" already used. Unit test in `mock-pickup-confirm.test.ts` pins day 2's date, dishes' eat-by dates and deadline.
- LOW-4: `t080-reload-after-409-mock.spec.ts` day 2 now has `dayPlus(1)` (Toronto) as its date, with deadline and dish eat-by dates moved by the same gaps.
- Checks: lint, typecheck, prettier clean; vitest 92 files, 2127 passed + 3 expected fail; full mock e2e 270 passed.
