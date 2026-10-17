# Handoff: T-082 backend (BookingSummary.frozen)

From: backend  To: tester

## What changed
- Branch: `feature/T-082-list-frozen-backend`
- Pull request: see PR "T-082 backend: BookingSummary.frozen (Refs #150)"
- Files:
  - `supabase/migrations/20261019100000_list_frozen.sql` (NEW, needs `supabase db push` on hosted: Jimmy). Adds `get_bookings_frozen(uuid[])`, the batch twin of `get_booking_frozen`: security definer, parties only, returns the frozen ids of one page (max 100 looked at). Same source of truth (`booking_is_frozen`). No table or policy change.
  - `src/lib/server/booking-views.ts`: `listBookings` calls it once per page (no N+1) and sets `frozen`.
  - `src/lib/api/types.ts`: `BookingSummary.frozen` as the last field (exact wording from the Work Order).
  - `docs/api-contract.md`: section 7A list shape, Status line v1.13 (T-082).
  - `tests/api/flag-freeze.test.ts`, `tests/rls/flag-freeze.test.ts`: new tests.

## How to verify
- `npm run lint`, `npx vitest run` (2089 pass + 3 expected fail) locally.
- API and RLS tests run in CI only (`npm run test:api`, `npm run test:rls`). The SQL was also checked locally with PGlite (frozen id returned for a party, nothing for a stranger, empty batch fine, `no_day_cooked` not frozen).

## Known gaps or risks
- `npm run typecheck` fails on `src/lib/mocks/mock-bookings.ts(781)`: `frozen` missing in the mock `BookingSummary`. Frontend owns mocks and adds it in its own branch; CI on this PR stays red on typecheck until both merge (or until Frontend's change lands first).
- Hosted DB needs the migration before the deployed list works against hosted.

## What the next agent needs
- API tests: frozen true in both lists after a chef rejection, false for unflagged and for `no_day_cooked` (D-57), a stranger's list never holds the row, response keys carry no reason/notes. RLS test: batch function for parties, stranger, admin, empty batch, anon denied.
- No fixed date literals in the new tests.
