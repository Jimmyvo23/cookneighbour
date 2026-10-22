# Handoff: T-098 Reviews and reports written only by the route (Tester)

From: tester  To: reviewer

## What changed
- Branch: `feature/T-098-route-only-writes`, PR #200. Test files only.
- Added `tests/rls/t098-tester.test.ts` (CI): upsert (insert branch, conflict-as-update branch, ignoreDuplicates) refused 42501 for customer, chef, admin, stranger, anon on both tables; every single column inserted alone and every old column-update refused 42501 (strict, a silent success would fail); rpc on both guard functions fails; catalog check (anon/authenticated have no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER at table or column level; no INSERT/UPDATE/DELETE/ALL policy left; both guard functions SECURITY DEFINER, `search_path=""`, execute false for public/anon/authenticated; both triggers BEFORE INSERT row level enabled; `reviews_a_guard_insert` sorts before `reviews_before_insert`); trigger edges (chef review inside window gets a display name; 1 minute inside the 14 day window accepted, 1 minute past refused; completed_at null falls back to updated_at; every status except completed refused for a review while a report is allowed on any status; role/subject pairing; unique key still 23505; report refused for reviewing/dismissed status, stranger reporter, unknown booking).
- Added `tests/api/t098-tester.test.ts` (CI): the database no longer checks author = session, so: review body with authorId, subjectId, authorRole, booking/display-name/createdAt/id fields (camel and snake case) is 422 and nothing is written; stored author, subject and role come from the session and booking for both parties; same for reports (reporterId, status, resolved_at, bookingId 422; stored reporter = session, status open).

## How to verify
- Local: `npx eslint tests`, `npx prettier --check tests src`, `npx vitest run` (3004 passed, 3 expected fail). `tsc` shows only the known generated `LayoutProps`/`PageProps` errors.
- RLS and API suites run in CI only (no Docker). The new tests were not run locally.

## Findings
- No bug found. Verdict: PASS, subject to CI on the new tests.
- Info: `review_window_days()` stays executable by authenticated (constant 14, no data; harmless). Migration uses plain `drop policy` / `create function` (not re-runnable), same as earlier migrations; rollback header is accurate (reviews policy from 20261022100000, reports policy from 20261025100000, insert grants from 20261007221002).
- Info: the route maps any 42501 on the review insert to `window_closed`. After the route's own party check the only reachable 42501 is a window that closed in between, so it is correct today; a future new trigger rule would be mislabelled.
- Dropped "forged author" tests: every browser insert is now refused outright, so that coverage is subsumed; the route-side equivalent is now in `tests/api/t098-tester.test.ts` (reports already had a `reporterId` 422 test).
- Not tested (cannot without clock control): the exact-second window boundary and the race where the window closes between route check and insert.

## What the next agent needs
- Confirm the `ci` gate (supabase job runs the new RLS/API files). Hosted `supabase db push` still needs Jimmy after merge.
