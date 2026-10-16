# Handoff: T-078 T-077 follow-ups

From: frontend  To: tester

## What changed
- Branch: `feature/T-078-t077-followups`. Pull request: see the PR ("Refs #148").
- Item 1 (On hold marker on the booking lists): **NOT DONE, blocked.** `BookingSummary` (`src/lib/api/types.ts`, list rows from `src/lib/server/booking-views.ts` and the mock) has no `frozen` field, and `docs/api-contract.md` 7A lists the row fields without it. Adding it needs a contract change plus backend (list query) and mock work, which my Work Order forbids. Needs the Planner to assign Backend (add `frozen` to `BookingSummary`, via the `get_booking_frozen` / `booking_is_frozen` logic), then Frontend adds the marker.
- Item 2 done: `FrozenBooking.test.tsx` has its own test for the chef's uncooked-day hint (frozen says "Pickups are paused while this booking is on hold.", not "Mark this day as cooked first"; not-frozen control shows the old hint).
- Item 3 done without a clock hook: the mock booking A05 (9105) already has its pickup window over, so `e2e-mock/t077-frozen-booking-mock.spec.ts` got two tests (control: missed-pickup visible when not frozen; frozen: hidden). No app or mock code changed.
- Files: `src/components/booking/FrozenBooking.test.tsx`, `e2e-mock/t077-frozen-booking-mock.spec.ts`.

## How to verify
- `npm run lint`, `npm run typecheck`, `npx prettier --check .`, `npm test`, `npm run test:e2e:mock`.

## Known gaps or risks
- Item 1 outstanding (above). Impeccable helper agents skipped (D-44); no UI change, so no detect run needed.

## What the next agent needs
- Test-only change. Question for the Planner: raise a Backend task for `frozen` on list rows?
