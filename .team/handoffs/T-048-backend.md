# Handoff: T-048 Reviews, reports and admin lists API

From: backend  To: tester

## What changed
- Branch: `feature/T-048-reviews-reports-api`. Pull request: see the PR titled "T-048: Reviews, reports and admin lists API" (Closes #176).
- Contract `docs/api-contract.md` v1.16, section 7D (first commit 337a44b), plus open points 18 to 21.
- Migration `supabase/migrations/20261022100000_reviews_reports.sql`: `review_window_days()` (14) and a new `reviews_insert_party` (completed + inside 14 x 24 h); `reports.client_id`, unique `(reporter_id, client_id)`, partial unique `reports_one_open_per_reporter`; browser `UPDATE` on reports revoked (policy dropped); table `admin_decisions` (audit + admin note, RLS on, no client privilege); function `admin_decide_booking` (one locked function, service role only).
- Domain: `src/lib/domain/reviews.ts` (+ tests, + `reviews-guards.test.ts` on the migration text), `REVIEW_WINDOW_DAYS` in `config.ts`.
- Server: `src/lib/server/{reviews,reports,admin-engagement,booking-party,paging}.ts`.
- Routes: `src/app/api/bookings/[id]/{reviews,reports}`, `src/app/api/chefs/[id]/reviews`, `src/app/api/admin/{bookings,reports,free-trial-blocks,reviews}`, `admin/bookings/[id]/{messages,resolve-flag}`, `admin/reports/[id]/{resolve,dismiss}`.
- Types: `src/lib/api/types.ts` (7D section at the end). Docs: `docs/data-model.md`.
- Tests: unit `reviews.test.ts` (window day 14 vs 15, bodies, first name), `reviews-guards.test.ts`; API `tests/api/{reviews,reports,admin-engagement}.test.ts` + `engagement-helpers.ts`; RLS `tests/rls/reviews-reports.test.ts`. Updated: `tests/rls/{visibility,engagement,hardening}.test.ts` (grant snapshot, report update now denied, one open report per booking), the two admin route-count guards (6 -> 14).
- Not built, by instruction: no UI mock adapter (Frontend owns `src/lib/mocks/mock-reviews-reports.ts`).

## How to verify
- Local: `npm run lint`, `npm run typecheck`, `npm test` (2326 passed + 3 expected fails). API and RLS suites only run in CI (no Docker). I also loaded all migrations into PGlite and exercised `admin_decide_booking` and the review policy (all decisions, flags, window 13.9 vs 14.1 days, one-open-report index): all passed.
- CI: `ci` job runs `npm run test:api` and `npm run test:rls`.

## Contract changes since 337a44b
- `PublicReview.authorDisplayName` is now `authorFirstName` (first word only, trimmed, split on whitespace, empty -> "Customer"; Jimmy 2026-10-20), cut on the server. `ReviewView.authorDisplayName` (parties) is unchanged. Nothing else changed.

## Builder choices (NOT confirmed by Jimmy)
1. Admin lists show `flaggedAt` = the flag's original `created_at`, also after an upgrade to `chef_rejected` (T-064 INFO-1).
2. Review retry: no key; same rating+comment again returns 200 with the first review, different content is 409 `already_reviewed`. Report retry: required `clientId` (lower-case uuid), same content 200, other content 409 `client_id_reused`; checked before the one-open rule.
3. Page size: house default (20, max 50), keyset on `(createdAt, id)`. Route paths and error reasons as in 7D (`INVALID_STATE` + `reason`: `not_completed`, `window_closed`, `already_reviewed`, `report_open`, `client_id_reused`, `already_decided`, `final_status_required`, `status_not_open`, `no_open_flag`).
4. A report on a booking that is NOT `accepted` can only be closed without a final status (a final status is 409 `status_not_open`); on an `accepted` booking a final status is required. Reason: never re-decide a finished booking or contradict a consumed/released free trial.
5. The admin note lives only in `admin_decisions`; the reporter sees only `status`/`resolvedAt` of a report; no notification to the reporter when a report closes.
6. `booking_decided` notice to both parties when a decision changes the status; wording "An admin reviewed this booking and set it to <completed|cancelled|a chef no-show|a customer no-show>." A dismissal or a no-status resolve notifies nobody.
7. Admin cancel is stored with `cancelled_by` null (shown as `system`), no timing, no reason. A no-show gets `no_show_day_number` = earliest active uncooked day, else first active day.
8. Extra admin route `GET /api/admin/reviews` (so the admin can see chef reviews of customers).
9. Reviews/report text is not run through the contact-details filter.
10. `GET /api/chefs/:id/reviews` reuses `getChefDetail` for the identical 404.

## Known gaps or risks / questions for Jimmy
- Q1 (open point 18): an open report still makes the chef's "visit done" answer 409 `problem_reported`, which tells a chef that a report exists when the customer filed it. Not changed (product rule). Options: neutral "on hold" text, or leave.
- Q2 (item 4 above): should the admin be able to change a finished booking's status after a report?
- Q3: contact-details filter on public review text? Show the admin note to the reporter? Notify the reporter when a report closes? Confirm the notice wording.
- Q4 (open point 21): `anon` can still select `reviews.author_id`/`booking_id` via the REST API; a column grant would close it but touches several RLS tests.
- Left out: notification read route; T-064 LOW-2 (sweep re-lock); T-064 INFO-2 is moot (a resolved booking is final, so a second reject cannot re-flag it).
- Hosted `supabase db push` of the new migration is needed after merge (Planner asks Jimmy). Existing duplicate open reports on hosted would fail the new unique index (none expected: no report UI existed).
- API and RLS tests were not run locally (no Docker); first real run is CI.

## What the next agent needs
- Tester: window edges (day 14 vs 15), non-completed bookings, second review, chef review hidden from public, report by non-party, one-open-report rule, each final status and free-trial effect, unfreeze, admin-only routes 401/403, first-name rule. Test accounts are created by the helpers; use `tests/api/engagement-helpers.ts`.
