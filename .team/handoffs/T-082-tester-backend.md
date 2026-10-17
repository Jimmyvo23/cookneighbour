# Handoff: T-082 backend verification (BookingSummary.frozen)

From: tester  To: reviewer

## What changed
- Branch: `feature/T-082-list-frozen-backend`, PR #153.
- Tests added (no app code touched):
  - `src/lib/server/booking-views-list-frozen.test.ts` (5 unit tests, fake client): mapping of the batch answer, exactly one RPC per page, only page ids (not the look-ahead row), null answer = nothing frozen, empty page makes no RPC, RPC error throws "bookings read failed: list parts" without row data.
  - `tests/api/flag-freeze.test.ts`: a customer page mixing a frozen and an unfrozen row, limit=1 page boundary with cursor (flag follows each row), and `status=open` filter keeps the flag. No date literals.

## How to verify
- Local: `npm run lint`, `npx tsc --noEmit` clean; `npx vitest run` 2096 pass + 3 expected fail.
- API and RLS tests run in CI only (no Docker); see CI result on the final head.

## Review result
- Migration: security definer, `search_path = ''`, execute revoked from public/anon, granted to authenticated; parties-only predicate via `auth.uid()`; same source (`booking_is_frozen`, so `no_day_cooked` is not frozen); returns ids only (no reason/notes); null array handled by coalesce; 100-id cap. OK.
- `listBookings`: one RPC per page, parallel with the other parts, error throws; mapping correct. OK.
- Contract v1.13 section 7A matches the code. OK.
- Existing RLS test covers party, other chef, stranger, admin, empty batch, anon denied, no_day_cooked.
- Cancelled frozen booking: not tested; a frozen booking refuses cancel (409 frozen), so the state is not reachable by the routes. Note only.

## Known gaps or risks
- Hosted DB needs the migration pushed (Jimmy).
- A 51+ id batch is cut at 100 silently; pages are max 50, so unreachable.

## What the next agent needs
Verdict PASS if CI `ci` is green on the final head.
