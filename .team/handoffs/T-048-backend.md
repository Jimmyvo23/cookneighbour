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

# Fix round (WO-5c, Jimmy's decisions of 2026-10-20)

## What changed
- New migration `supabase/migrations/20261023100000_report_never_blocks.sql` (no old migration edited). Contract v1.17, section 7D "Changes in the fix round" lists everything for Frontend; `docs/data-model.md` updated.
- **F-2 (Tester MEDIUM, "Close it in this fix round"):** `anon` table `SELECT` on `reviews` revoked, column grant `id, author_role, rating, comment, created_at` only. `GET /api/chefs/:id/reviews` now reads with the service role AFTER the `getChefDetail` visibility check (same 404), filtered to that chef's customer reviews, and cuts the first name on the server. RLS tests that filtered anon by `booking_id`/`subject_id`/`author_id` now read by `id`. The Tester's 3 `it.fails` are normal passing tests (4 column rows now, plus a positive test and a `select *` refusal).
- **F-1 (Tester MEDIUM + LOW, "Let the chef finish", "All of them"):** `change_booking` (action `complete` and the last `pickup_confirm`) and `sweep_booking_changes` (auto completion and the `no_day_cooked` flag) no longer look at reports. 409 `problem_reported` and its message text are removed. **A-30 is replaced** (an open or reviewing report never blocks any completion path). The Tester's `it.fails` is a passing test. Old tests that asserted the block were rewritten to assert completion (`booking-changes`, `auto-complete-on-pickup` x2, `booking-changes-t066-tester`, `admin-engagement` dismiss test).
- **Admin may change a completed booking ("Yes, admin may change it"):** inside the one locked function `admin_decide_booking`. On `completed`, `finalStatus` is optional: `cancelled`, `no_show_chef`, `no_show_customer` change it; `completed` or none leaves it (no notice). `accepted` still requires a final status. Other statuses (`requested`, `declined`, `expired`, `cancelled`, no-shows): final status is still 409 `status_not_open`, close with a note only. Both parties get the existing `booking_decided` notice. Free trial: `applyFreeTrialEvent` got `allowReopen`, which lets a `consumed` claim be released when the new status is cancelled / chef no-show with no cooked day (A-16, D-26, D-37). The sweep also lists such a consumed claim, so a failed follow-up is repaired. Reviews written stay; no new review (policy and route need `completed`).
- **Contact filter ("Yes for public reviews"):** `createReview` runs a customer's comment through `findContactDetails`: 422 `CONTACT_DETAILS_NOT_ALLOWED`, `fields.comment`, nothing stored. A chef's review is not filtered.
- **Reporter notice ("Notification, no note"):** `admin_decide_booking` writes one `report_closed` notification (title "An admin closed your problem report") to the reporter on resolve and on dismiss; no note, nothing for the other party. Test asserts the other party has none.

## Tests
- Unit: `npm test` 2330 passed + 3 expected fail (the 3 are Frontend component `it.fails`, not mine); new `report-never-blocks-guards.test.ts`. Lint, `npm run typecheck` and prettier clean.
- New or changed API tests (CI only): `admin-engagement` (completed -> each status with trial effects, re-release with no cooked day, reporter notice x4 rows, open report then chef finishes, dismiss afterwards), `reviews` (3 contact rows + chef not filtered), `t048-tester` (F-1 passing), plus the 5 rewritten completion tests above.
- New or changed RLS tests (CI only): F-2 4 column rows + positive/`select *`, anon reads by id in `reviews-reports`, `engagement`.
- I also ran the new migration on PGlite (all migrations loaded; completed -> cancelled, completed -> completed, requested refusal, dismiss notice, chef complete with an open report, anon column grant): all passed. The API/RLS suites themselves ran only in CI.

## Contract changes since 48d20c1
v1.17: no shape change except: new 422 `CONTACT_DETAILS_NOT_ALLOWED` on `POST /api/bookings/:id/reviews`; `resolve` accepts a `finalStatus` on a `completed` booking; reason `problem_reported` removed; notification type `report_closed`. Open points 18, 19, 20, 21 updated.

## Builder choices (NOT confirmed by Jimmy)
1. `completed` chosen on a completed booking means leave it (no notice, audit row still written with `final_status = completed`).
2. For `requested`, `declined`, `expired`, `cancelled`, no-show bookings a resolve only closes the report (`status_not_open` if a final status is sent), as built before.
3. The `report_closed` type name and body "An admin has looked at your report and closed it."; a resolve that changes the status sends the reporter both this and `booking_decided`.
4. A completed booking moved to cancelled keeps `completed_at` (not cleared); `cancelled_by` stays null, as for the other admin cancels.
5. The customer's contact filter runs before the retry/state checks of a review.
6. Open point 21 remains partly: `authenticated` keeps the table grant on `reviews`, so a signed-in user can still read the full name and author id of public reviews through PostgREST. Needs Jimmy's decision.
7. Report text is still not filtered (only the public review comment is).

## Next
Tester: re-run the fix-round areas in CI (API + RLS); Planner: `supabase db push` for both migrations after merge.
