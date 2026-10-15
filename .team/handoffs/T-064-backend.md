# Handoff: T-064 Flagged bookings freeze (D-22, D-53, D-57)

From: backend  To: tester

## What changed
- Branch: `feature/T-064-flag-freeze` (from main 425c751). Pull request: see the PR for issue #132 ("Closes #132").
- Migration `supabase/migrations/20261017100000_flag_freeze.sql` (NOT pushed to hosted; Jimmy runs `npx supabase db push --linked` after merge):
  - `booking_flags.resolved_at` (null = open).
  - `booking_is_frozen(booking)` (service role only): an open flag whose reason is not `no_day_cooked`.
  - `get_booking_frozen(booking)` (security definer, authenticated, parties only; null for anyone else). Added to the function-privilege snapshot in `tests/rls/visibility.test.ts`.
  - `change_booking`: after the party check and the expiry check, a frozen booking returns `invalid_state` / `frozen` for EVERY action by EITHER party. `complete` resolves an open `no_day_cooked` flag (D-57).
  - `sweep_booking_changes`: the auto-completion now loops over due bookings in id order, locks each (`FOR UPDATE`), then re-checks status, frozen, cooked day and open report in new statements; skips frozen ones; resolves a `no_day_cooked` flag on completion. The `no_day_cooked` flag inserts are ordered by booking id (LOW-2).
  - `admin_reject_chef`: flags accepted bookings in id order under `FOR UPDATE` (LOW-2, and a parallel completion either finishes first or sees the flag); an open `no_day_cooked` flag is upgraded to `chef_rejected` (`ON CONFLICT DO UPDATE ... WHERE reason = 'no_day_cooked' and resolved_at is null`) so the booking freezes; the customer gets the usual `booking_flagged` notice.
  - `submit_receipt` returns `frozen` (chef action); `booking_accepts_receipts` (storage upload policy helper) is false for a frozen booking.
  - `answer_booking`: D-59 uses `coalesce(btrim(x), '') = ''` for line, city and postal code (T-074 L1).
  - `comment on function set_chef_kitchen_address(...)`: says JSON null gives an empty array for cuisines, languages and location_options (T-074 N1; the applied migration is not edited).
- TS: `BookingDetail.frozen: boolean` (`src/lib/api/types.ts`, read in `src/lib/server/booking-views.ts` through `get_booking_frozen` with the caller's own client); `CHANGE_REFUSALS.frozen` and `RECEIPT_REFUSALS.frozen` (same neutral text, does not say why); `sweepExpired` comment updated (NIT-1).
- Mock adapter (`src/lib/mocks/mock-bookings.ts`, `mock-booking-changes.ts`): `frozen: false` on every detail; new test hook `hooks.frozenSeeded = [ids]` (use `SEEDED.A0x` ids from `e2e-mock/helpers.ts`, set it before the made-up bookings are brought in) makes those bookings `frozen: true`; every change route, the customer cancel and a chef receipt answer 409 `frozen`.
- Docs: `docs/api-contract.md` v1.11, `docs/domain-rules.md`, `docs/data-model.md`.
- One Frontend file touched: `src/components/booking/BookingDetailView.test.tsx` got `frozen: false` in its fixture (type now required). Nothing else under components or pages.
- Tests added: `src/lib/mocks/mock-flag-freeze.test.ts` (5, local), `tests/rls/flag-freeze.test.ts` (DB, CI only), `tests/api/flag-freeze.test.ts` (routes, CI only); `bookingChanges.test.ts` and `visibility.test.ts` updated.

## How to verify
- Local: `npm run lint`, `npm run typecheck`, `npx prettier --check .`, `npm test` (1984 passed + 3 expected fail, 79 files).
- DB, RLS and API tests run only in CI (no Docker): `tests/rls/flag-freeze.test.ts`, `tests/api/flag-freeze.test.ts`, `tests/rls/visibility.test.ts`.
- I loaded all 17 migrations into PGlite (scratch, not committed) and ran: frozen refuses complete and customer cancel; sweep skips a frozen cooked booking and completes the others; `no_day_cooked` is not frozen, cooked + complete resolves it, the sweep completion resolves it; reject upgrades the flag; `get_booking_frozen` is true for the customer, null for a stranger. Races and RLS are NOT covered by that check.

## Known gaps or risks
- No admin route decides a flag yet (T-048), so a frozen booking stays frozen until then. `resolved_at` is set by completion (D-57) only; T-048 must set it when the admin decides.
- Free-trial claim of a frozen booking stays `held` (no change).
- Not tested for concurrency: the id-order locking in `admin_reject_chef` and the sweep (LOW-2 is a reasoning fix).
- `BookingSummary` (the list) has no `frozen`; only `BookingDetail` has it.
- The mock e2e suite was not re-run locally; the mock change is additive.

## What the next agent needs
- Frontend (T-073 freeze item): read `BookingDetail.frozen`. When true: neutral notice, hide mark-cooked prompt, visit done, no-show, pickup answers, add receipt (chef) and cancel, no-show, propose pickup (customer). Do not say why. A `no_day_cooked` booking is NOT frozen (`frozen: false`): keep the mark-cooked prompt. Refusal: 409 `INVALID_STATE`, `error.reason === "frozen"`.
- Tester: edge cases to try: reject a chef with an accepted booking whose visits are past and uncooked (flag upgrade); complete after cooked on a flagged booking; receipt upload on a frozen option B booking; stranger and admin calling `get_booking_frozen` (null); 13 refused actions all leave status and `cooked_at` unchanged.

## Questions for Jimmy (interim behaviour chosen is the most conservative)
1. D-53 says "no completion and no chef actions". Interim: the customer's cancel, no-show report and pickup proposal are also refused on a frozen booking (a cancel could consume or release the free trial before an admin decides). Should the customer be able to cancel a frozen booking?
2. Customer receipt answers (confirm or dispute) are still allowed on a frozen booking (they change no status). OK?
3. Until T-048 exists nothing unfreezes a booking. Is that acceptable for the demo, or should an admin "unflag" route come earlier?
4. If a chef is rejected while a `no_day_cooked` flag is open, the booking freezes (flag becomes `chef_rejected`). Confirm that D-22 wins over D-57 here.
