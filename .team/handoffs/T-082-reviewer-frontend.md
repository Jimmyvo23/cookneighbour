# T-082 — Reviewer (reviewer-frontend, PR #154)

## 2026-10-17T03:14:27Z

APPROVE (Reviewer, T-082 frontend part, head 186164d)

Scope: frontend-owned files only (src/components/booking/*, src/lib/mocks/mock-bookings.ts, the BookingSummary.frozen lines in src/lib/api/types.ts, e2e-mock/*, unit tests). Backend files are reviewed on #153. Read: docs/lessons-learned.md, PLAN.md T-082 row and D-76, .team/handoffs/T-082-frontend.md, .team/handoffs/T-082-tester-frontend.md.

Verified locally in the worktree at 186164d:
- lint clean, typecheck clean (with the backend commits included), prettier clean on the changed files.
- Unit: 88 files, 2091 passed + 3 expected fail (matches both handoffs).
- Mock e2e: t082-tester-mock.spec.ts and t077-frozen-booking-mock.spec.ts, 13/13 passed.
- CI on #154 was still pending when I checked; the merge gate is #153's ci anyway.

Plan compliance: matches the T-082 row and D-76 (marker on customer and chef lists, BookingSummary.frozen, T-078 NIT-1). No scope creep.

Quality: OnHoldMarker is a small shared component in parts.tsx, rendered under `b.frozen` right after the status line in both lists. The mock summaryOf reads `d.frozen` from the same row as the detail, so list and detail cannot disagree in MOCK mode. Type lines are identical to the backend PR, so the merge was clean.

Accessibility: plain text "On hold" in a <p> inside the <li>, semibold, no colour, so it is not colour-only and is read in the row order. axe is clean on both lists; no sideways scroll at 375 px (Tester spec).

Privacy and honesty: the text is just "On hold". It gives no reason and no admin, flag or report wording, the same neutral wording as the detail FrozenNotice (D-53). Nothing new is mocked beyond the existing MOCK hook.

Tests: unit tests check that the frozen row is marked and its neighbour is not, in both lists. E2E has positive cases, no-hook controls and list/detail agreement. The Tester's mutations (removing the marker, or forcing `frozen: false` in the mock) turned the tests red. Dates use torontoToday/addDays with no literals. The NIT-1 fix scopes to the first `pickup-day`, as the T-078 review asked.

Non-blocking notes:
- NIT-1: the PR body is stale. It says typecheck/CI is red until the backend merges, but the branch now contains the backend commits. Since #154 will be closed in favour of #153, a closing comment pointing to #153 is enough.
- NIT-2 (a11y, optional follow-up): someone browsing by links (a screen-reader links list) hears only "<name>, booking", without "On hold". Adding it to the link's sr-only text when frozen (", booking, on hold") would cover that mode too. Reading the row in order works today, so this is not blocking (it matches the Tester's NIT).
- INFO: the 375 px spec's no-reason regex checks only the marker text, which is fixed. A row-level `not.toContainText` would guard against future reason text added elsewhere in the row.


---

## 2026-10-17T03:23:59Z

APPROVE (Reviewer, T-082 frontend round 2, head f8dbf8d; code at 340008f)

I re-checked the diff since 186164d:
- NIT-2 is fixed. In BookingList and ChefBookingList the link's sr-only text is ", booking, on hold" only when `b.frozen`, so someone browsing by links now hears it. The wording is neutral, with no reason. The unit tests check both rows (frozen contains it, unfrozen does not). The Tester's mutation (reverting the text) turned 2 tests red.
- The INFO is fixed. The no-reason regex in e2e-mock/t082-tester-mock.spec.ts now runs on the whole row. That text has no ids or tokens, so the short-word lesson (T-079) does not apply.
- f8dbf8d only adds the Tester's round-2 notes.

Verified locally: lint, typecheck and prettier clean; unit 88 files, 2091 passed + 3 expected fail; mock e2e t082-tester-mock + t077-frozen-booking-mock 13/13 passed.

FYI, outside the frontend scope (for #153's reviewer and Backend): CI run 38997880793 on this branch (head 186164d) failed in RLS tests. `tests/rls/visibility.test.ts > function execute privileges for anon and authenticated match the snapshot exactly` expected 16 entries and got 17. This is most likely the new `get_bookings_frozen` function, which is not in the snapshot. A later run (38998298099) was cancelled; 38998558200 for f8dbf8d was still running when I posted. The merge through #153 needs a green ci.

