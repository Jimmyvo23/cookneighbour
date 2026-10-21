# Handoff: T-049 Reviews, report button and admin lists UI (Tester)

From: tester  To: frontend

## Verdict: PASS with findings

PR #181, head 6848526 (plus my test commit). No blocking bug. Every item in the brief was checked; the review form, report section, public list and admin pages behave as the contract 7D v1.18 says.

## What changed
- Branch: `feature/T-049-reviews-reports-ui`; Pull request: #181
- Files added (tests only): `src/components/admin/T049Tester.test.tsx` (13 tests, 1 `it.fails`), `e2e-mock/t049-tester-mock.spec.ts` (5 mock e2e tests at 375 px with axe).
- No product code changed.

## How to verify
- Before my tests: `npm run lint` and `npm run typecheck` clean; `npx vitest run` 112 files, 2439 passed + 3 expected fail; mock e2e 309 passed.
- With my tests: `npx vitest run src/components/admin/T049Tester.test.tsx` gives 12 passed + 1 expected fail; `npx playwright test -c playwright.mock.config.ts e2e-mock/t049-tester-mock.spec.ts` gives 5 passed.
- CI `supabase` and `ci` are red only from the known flaky `tests/api/t048-tester.test.ts` "nothing personal is logged" (T-088); not touched.

## What I checked (all PASS unless listed under findings)
- Review form: only on a completed booking (accepted booking has no review section, e2e); 14-day window text and closed state at 15 days (e2e); "final once posted" text tied to the Post button by `aria-describedby`; rating is a radio group in a fieldset with a legend, arrow keys move it (e2e), empty send puts focus on the group; 422 contact text sits under the comment, focus on it, text kept (e2e); after posting, focus goes to the confirmation, the form is gone and stays gone after a reload (e2e). Rating 0, 6, 2.5, NaN refused; comment 1000/1001, line breaks, NUL (unit).
- Privacy: a chef's review of a customer is labelled "Only you and an admin can see it" to the customer and "Only the customer and an admin can see it" to the chef, and is not on any public page (existing unit tests plus code). Public list shows one-word first names only, no full name (e2e); "Show more reviews" moves focus to the first new review (e2e).
- Report: button on every booking (e2e on an accepted one; code mounts it for every status, both roles); one open report per person (status replaces the form, e2e); own reports only and never an admin note or decision (existing unit test "never shows an admin note, a final status or a decision"); same `clientId` on retry (existing unit test); wording "Only you and an admin can read your report" (e2e).
- Admin: status required on accepted, optional on completed, never sent on other statuses, flag always needs a status, dismiss never sends a status, note 3 to 500 (unit, edges added); lists, filters, paging, read-only chat, MOCK badge on every admin page (existing admin e2e and mine).
- 375 px: no sideways scroll and axe clean on the review form (empty and error state and after posting), report form, public reviews.

## Findings, ranked
1. **LOW, wrong text on the admin chat.** `AdminChatView` uses the shared `ListBody`, whose count line says "Showing N messages, newest first", but the chat is listed oldest first (the list is labelled "Messages, oldest first"). Steps: open `/admin/bookings/<id>/chat` in MOCK mode as admin. Recorded as `it.fails` "BUG T49-F1" in `T049Tester.test.tsx`; when fixed, change it to `it`.
2. **LOW to MEDIUM, written reviews disappear if an admin changes a completed booking.** `BookingDetailView.tsx` and `ChefBookingView.tsx` mount `ReviewSection` only when `b.status === "completed"`. Contract v1.18 says that when an admin moves a completed booking to cancelled or a no-show, "reviews already written stay", and the admin form text tells the admin so. After the change neither party can see their own or the other's review on their booking page (the customer's review still shows on the public chef page). Not covered by a test (no test builds that state). Needs a decision: show `mine`/`other` for any status, or accept it. Question for Jimmy.
3. **INFO, a refused second report drops the typed text.** When the server answers `report_open` the form closes and the user's description is lost (the open report's status shows instead). Fine by the contract; noted only.

## Known gaps or risks
- Everything ran on the MOCK adapter; the real routes were not exercised by this UI (T-050 will). Mock review window uses `closesAt < now`; the exact second of the boundary is tested on the server side (`tests/api/t048-tester.test.ts`), not here.
- The handoff of the frontend named no e2e for the review form, report section and public list; I added them (5 tests).

## What the next agent needs
Frontend: fix finding 1 (a prop on `ListBody` for the order word) and decide finding 2 with Jimmy. Reviewer: the privacy texts above are the ones to compare with the contract.

## Re-check (round 2, head 35e5644)
Verdict: PASS. No product code touched; no new tests needed.
- F1: admin chat count line now says "oldest first"; other admin lists keep "newest first" (default prop; converted test passes).
- F2: both booking pages mount ReviewSection for every status, readOnly when not completed. Read-only shows mine/other cards with the same privacy labels, no form (even if the server says allowed), no why text; nothing while loading, on load error, or with no reviews (unit tests plus new 375 px axe e2e).
- F3: refused report_open stays in the form, typed text kept, role=alert, focus on the alert (unit test). Old refusal box removed.
- Regressions: lint and tsc clean; unit 113 files, 2458 passed + 3 expected fails (unrelated ChefDetail it.fails.each); mock e2e 315 passed.
- Notes (INFO): the extra GET reviews runs for every status; failures render nothing, so pages are not broken. Real routes not exercised (T-050).

## Round 3 re-check (head 6b5d076 plus Tester tests)

Verdict: PASS. No bugs found.

- Item 1 (MOCK only when isMockEnabled): PASS. In live mode the MOCK badge, "made-up" lines and test id are absent from the DOM (checked innerHTML on bookings, blocks, reports and chat). Privacy sentences show in both modes; "only the reporter and admins read it, other person never told" matches contract 7D.
- Item 2 (encodeURIComponent): PASS. Ids `..%2F..`, `../x`, `a#b`, `a b` are encoded.
- Item 3 (mock ReviewView keys): PASS (builder test checks exact keys on POST and GET).
- Item 4 (focus after Cancel): PASS for ReportSection, admin report Resolve and Dismiss, booking Resolve flag (unit) and admin reports in a real browser.
- Items 5 and 6: PASS (comment cites D-114; error box uses dangerBoxCls with dark colours).
- Earlier fixes F1, F2, F3: no regression (existing specs pass).

Tests added: `src/components/admin/AdminEngagementRound3.test.tsx` (8 tests), `e2e-mock/t049-round3-focus-mock.spec.ts` (1 test).
Results: lint, typecheck, prettier clean; vitest 113 files 2466 passed + 3 expected fail (before my 8); T-049 mock Playwright 12 passed + 1 new.
