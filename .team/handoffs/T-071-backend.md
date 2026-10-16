# Handoff: T-071 Pickup confirm (backend part)

From: backend  To: tester

## What changed
- Branch: `feature/T-071-pickup-confirm-backend` (from main 02ff60c). Issue #144, D-55, D-73. PR title "T-071: pickup confirm (backend part)".
- Migration `supabase/migrations/20261018100000_pickup_confirm.sql`: `booking_days.picked_up_at`; `change_booking` replaced (new action `pickup_confirm`; `pickup_missed` ignores confirmed days). NOT pushed to hosted (the Planner asks Jimmy after the merge).
- Route `src/app/api/bookings/[id]/days/[dayNumber]/pickup/confirm/route.ts` (POST, customer, no body, JSON content type like `cooked`).
- Server: `confirmPickup` in `src/lib/server/booking-changes.ts`; `pickedUpAt` in `src/lib/server/booking-views.ts`; `pickup_confirmed` text in `CHANGE_REFUSALS` (`src/lib/domain/bookingChanges.ts`).
- Contract v1.12 in `docs/api-contract.md` (route row, field, reason, notification, A-26..A-29).
- Tests: `tests/api/pickup-confirm.test.ts` (9 API tests, CI only), RLS test in `tests/rls/booking-changes.test.ts` (1), helper `confirmPickup` in `tests/api/booking-helpers.ts`, refusal list in `src/lib/domain/bookingChanges.test.ts`.
- NOT touched: `src/lib/api/types.ts`, `src/lib/mocks/**`, UI (Frontend adds `pickedUpAt` and the call).

## How to verify
- `npm run lint`, `npm run typecheck`, `npx prettier --check .`, `npm test` (85 files, 2040 passed, 3 expected fail locally).
- `npm run test:api` and `npm run test:rls` need local Supabase (CI only on this Mac). I also loaded all migrations in pglite and ran confirm, a repeat, a wrong-side call and `pickup_missed` by SQL: results as specified.

## Known gaps or risks
- Behaviour follows the Planner assumptions A-26..A-29, not yet confirmed by Jimmy.
- Auto-completion unchanged (follow-up): a chef's-home booking still waits for every day's pickup deadline before auto-completing, even when all days are confirmed.
- Reason for a customer_home booking: reused `not_chef_home`. Order of checks: party 404, frozen, status (`wrong_status`, so a `no_show_customer` booking after missed gives `wrong_status`), `not_chef_home`, day missing 404, inactive day `wrong_status`, uncooked `day_not_cooked`.
- Review fix: `pickup_propose` on a confirmed day is 409 `picked_up` (new reason, in the contract, text in CHANGE_REFUSALS, one API test).
- Confirm voids that day's open or agreed pickup proposals (decision of mine, noted in the contract). The chef is notified once (`pickup_confirmed`), not on a repeat.
- The race test accepts either winner and asserts the booking is consistent.

## What the next agent needs
- Shape: `BookingDetail.days[].pickedUpAt: "ISO|null"` (always present). `POST /api/bookings/:id/days/:dayNumber/pickup/confirm` returns the full `BookingDetail` (200). 409 `INVALID_STATE` reasons: `frozen`, `wrong_status`, `not_chef_home`, `day_not_cooked`; missed pickup adds `pickup_confirmed`.
- Test ideas: confirm on a past-deadline day; confirm then missed; missed with a mix of confirmed and unconfirmed past-deadline days; stranger 404; chef 403.

## Round 2 (Reviewer REQUEST CHANGES, MED-1 and follow-ups)
- MED-1 (option a, SQL untouched): `pickup_confirmed` text now says "...for every visit whose pickup deadline has passed, so there is no missed pickup to report now." The contract's missed row says the same and warns a UI not to hide the action for good. Reason code unchanged. No test pinned the old text (tests use `CHANGE_REFUSALS.pickup_confirmed`).
- LOW-1: contract check order now matches the SQL: range 1..3 (404), `expired`, `frozen`, status, `not_chef_home`, day not in booking (404), inactive day, `day_not_cooked`.
- LOW-2: migration ends with the revoke/grant block for `change_booking` (signature unchanged).
- NIT-1: status line "v1.12 (T-071), covers ..."; v1.12 summary mentions `picked_up`.
- INFO-3: voiding proposals on confirm is marked as the builder's decision, to be confirmed with A-26..A-29 (still "not yet confirmed").
