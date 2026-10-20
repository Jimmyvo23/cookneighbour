# Handoff: T-048 Reviews, reports and admin lists API (Tester)

From: tester  To: backend

## Verdict: PASS with findings
No blocking defect in the builder's code. Two findings need Jimmy's decision (F-1, F-2); they are pinned by `it.fails` tests so CI stays green until they are fixed.
(The API and RLS suites cannot run on this Mac; the CI result for head of this push is recorded in the PR checks and in my final report.)

## What changed
- Branch: `feature/T-048-reviews-reports-api`. Pull request: #180.
- Files added (tests only, no application code): `tests/api/t048-tester.test.ts`, `tests/rls/t048-tester.test.ts`, this handoff.
- Existing builder suites were read in full first (reviews, reports, admin-engagement, RLS); I added only what was missing:
  - Review window 30 s either side of 14 x 24 h (API and RLS, both roles); declined, cancelled and no-show bookings are not reviewable (API); cancelled/declined/requested/accepted refused by RLS; window follows `completed_at`.
  - Public review body never holds the full name, the customer id, the booking id, the other review's id/text or the e-mail; chef-on-customer review hidden from other customers, other chefs and anon (API and RLS) and visible to the customer and admin (admin list filter by `authorRole`).
  - Reports: the chef's reads (detail, list, report list, reviews, chat) are unchanged after a customer report, and the same the other way round; same-`clientId` race (201 + 200, one row); a dismissed report frees the reporter; stranger gets 404 and nothing is written; RLS insert rules (non-party, spoofed reporter, born closed, born with a note); reports on requested/declined/cancelled/completed; other party and anon read nothing.
  - Admin: `chef_rejected` flag with all four final statuses and each free-trial effect; `no_day_cooked` flag with completed/no_show_customer/cancelled; cooked day + chef rejected + cancel = consumed; races (two resolve-flag, resolve vs dismiss) give exactly one winner and one audit row; dismiss on requested/completed bookings changes nothing; the party chat READ route is 403 for the admin; a signed-in admin cannot call `admin_decide_booking` or read `admin_decisions`.
  - Logging: console spies over reviews, reports and admin decisions (including error paths) find no text, name, e-mail, phone or address.

## How to verify
- Local: `npm run lint`, `npx tsc --noEmit`, `npx prettier --check .` (all clean for the new files).
- CI: `ci` job runs `npm run test:api` and `npm run test:rls`. `gh pr checks 180`.

## Findings (ranked)
1. **F-2 MEDIUM (privacy, defeats Jimmy's first-name rule):** `anon` has a table-wide `SELECT` on `public.reviews` (migration `20261007221002_core_rls.sql` line 191). The REST API returns every column of a public review to anyone holding the anon key: `author_display_name` (the FULL name snapshot), `author_id`, `booking_id` (and `subject_id`). Backend named only `author_id` and `booking_id`; the full-name column is the worse part, because the route's "first word only" cut can be bypassed by calling PostgREST directly. Fix: replace the anon table grant with a column grant (`id, subject_id, author_role, rating, comment, created_at` plus a first-name-only column or view), then update the RLS tests that select other columns. Tests: `FINDING F-2` in `tests/rls/t048-tester.test.ts` (3 `it.fails`).
2. **F-1 MEDIUM (privacy, conflicts with Jimmy's rule):** with a customer's open report on an `accepted` booking, the chef's "visit done" returns 409 `problem_reported` (confirmed in code: `change_booking` action `complete`). This tells the chef that a report exists. Test: `FINDING F-1` in `tests/api/t048-tester.test.ts` (`it.fails`). Options: neutral "on hold" wording with no reference to a report, or leave and ask Jimmy. Side note (LOW): an open report also stops automatic completion and the `no_day_cooked` flag, so the chef can see the booking not completing; same root cause.
3. **INFO:** `logDecision` logs `admin=<uuid> booking=<uuid>` on each decision. These are ids, not personal data, and no text, name, e-mail or phone is logged anywhere in the new code.
4. **INFO (builder choices to confirm):** admin cannot change a finished booking's status after a report (open point 19); admin cancel is stored with `cancelled_by` null.

## Counts
New tests: API 18 cases in `t048-tester.test.ts` (1 `it.fails`), RLS about 22 cases (3 `it.fails`). Each expands to the `it.each` rows.
(Fix round, backend: F-1 and F-2 are fixed, so `t048-tester.test.ts` now has 0 `it.fails` in both files; F-2 is 4 column rows plus one positive test in the RLS file.)

## Known gaps or risks
- API and RLS suites only run in CI (no Docker here); my tests were checked with lint, typecheck and prettier locally.
- Not covered: notification read route (not built), hosted database (never touched).

## What the next agent needs
- Backend: decide F-1 and F-2 with Jimmy. When fixed, delete `.fails` from the matching tests (vitest will flag them).
- Reviewer: privacy items above; all other WO-5c rules held in tests.
