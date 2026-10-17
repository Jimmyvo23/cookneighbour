# T-082 — Frontend handoff (issue #150, branch feature/T-082-list-frozen-frontend)

## What changed
- `src/lib/api/types.ts`: `BookingSummary.frozen: boolean` as the last field (identical lines to Backend's PR for a clean merge).
- `src/lib/mocks/mock-bookings.ts` `summaryOf`: `frozen: d.frozen`, from the same row state as the detail (so the `frozenSeeded` hook and later changes agree).
- `src/components/booking/parts.tsx`: `OnHoldMarker` (plain text "On hold", `data-testid="on-hold"`, semibold like the status line, no colour reliance, inside the row so screen readers read it with the booking; no reason, no admin wording).
- `BookingList.tsx` (customer) and `ChefBookingList.tsx` (chef): marker shown when `b.frozen`.
- `FrozenBooking.test.tsx`: T-078 NIT-1, the positive hint check is scoped to the first `pickup-day`.

## Tests
- Unit: one new test per list (frozen row marked, unfrozen row not). Whole suite 2091 passed + 3 expected fail.
- Mock e2e: 2 new tests in `t077-frozen-booking-mock.spec.ts` (customer list, chef list; axe clean). Whole mock suite 258 passed. No date literals.
- lint, prettier clean. Impeccable detect: no findings. Impeccable helper agents skipped (D-44).

## Known
- `npm run typecheck` fails ONLY in `src/lib/server/booking-views.ts` (list query lacks `frozen`). That file is Backend's; it is fixed by Backend's parallel PR. CI on this PR is red until that merges first (or this is updated after it).
- Did not touch docs/api-contract.md or src/lib/server/.
