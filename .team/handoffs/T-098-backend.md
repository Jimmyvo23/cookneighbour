# Handoff: T-098 Reviews and reports written only by the route

From: backend  To: tester

## What changed
- Branch: `feature/T-098-route-only-writes`
- Pull request: see the PR titled "T-098: Reviews and reports written only by the route"
- Migration: `supabase/migrations/20261026100000_reviews_reports_route_only.sql`
  - drops `reviews_insert_party` and `reports_insert_party`
  - revokes insert (table and column), update, delete, truncate, references, trigger on `reviews` and `reports` from `anon` and `authenticated` (only SELECT remains)
  - new BEFORE INSERT triggers keep the old policy rules for every writer, service role included: `reviews_a_guard_insert` (completed booking, inside `review_window_days()` x 24 h, author a party, subject the other party, role matches; 42501) and `reports_guard_insert` (reporter is a party of the booking, status `open`, `resolved_at` null; 42501). Both functions SECURITY DEFINER, `search_path = ''`, execute revoked from public, anon, authenticated.
  - rollback steps are in the migration header.
- Code: `src/lib/server/reviews.ts` inserts with the service role (`createAdminClient`); the 42501 to `window_closed` mapping is unchanged. `src/lib/server/reports.ts` already inserted with the service role; only the comment changed.
- Docs: `docs/api-contract.md` v1.22 (no response change), `docs/data-model.md`.
- Tests: new `tests/rls/t098-route-only-writes.test.ts` (direct insert of a valid review and report refused with 42501 for customer, chef, admin, a stranger and anon, with and without returning, with client_id; update and delete refused; trigger refusals for window, status, party, role, resolved report, for the service role). Existing RLS files (`reviews-reports`, `engagement`, `t048-tester`, `t090-tester`, `hardening`) now insert through the service role, so they test the trigger rules; hardening P4 reviews/reports tests became "no browser insert". `tests/api/reviews.test.ts` paging test now makes real completed bookings with the same chef (the trigger refuses a review by a non-party); helpers `completedBooking` / `requestedBooking` accept `chef`, `offsets`, `shift`.

## How to verify
- `npm test`, `npx eslint src tests`, `npx tsc --noEmit` (ignore the generated `PageProps` errors without `next typegen`): pass locally.
- RLS and API suites run only in CI (no Docker): `npm run test:rls`, `npm run test:api`.
- SQL loaded with pglite (all 26 migrations): grants show SELECT only; the three trigger refusals give 42501.

## Known gaps or risks
- RLS/API suites not run locally. The positive trigger path (valid review accepted) is covered only by CI tests.
- Update and delete on both tables were already closed in the browser (reviews: never granted; reports: removed in 20261022100000); now re-asserted by explicit revokes and tested for all browser roles.
- Hosted: the migration needs `supabase db push` after merge (Jimmy). No data pre-check needed; the triggers act only on new rows. Optional sanity query: `select grantee, privilege_type from information_schema.table_privileges where table_name in ('reviews','reports') and grantee in ('anon','authenticated');` should list only SELECT.

## What the next agent needs
- Builder choices (unconfirmed by Jimmy): used triggers rather than a SECURITY DEFINER `create_review` function, so the route code and error mapping stay as they were; the reports route needed no code change.
- Tester: confirm CI `supabase` job is green, and that the review route still returns the same texts (contact filter, window_closed, already_reviewed, retry 200).
