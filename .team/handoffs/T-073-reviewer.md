REQUEST CHANGES (T-073 Reviewer, head b4d5788)

Two copy-only changes are required: Jimmy decided D-63 and D-64 during this review. The code itself is sound. Apart from these two, I would approve.

Reviewed: PR #130 diff (14 files, +830/-23), .team/handoffs/T-073-frontend.md, .team/handoffs/T-073-tester.md (PASS, F-1..F-4), PLAN.md T-073 / D-52 / D-56 / D-58 / D-59, docs/api-contract.md (contactVisibleUntil), docs/lessons-learned.md.

Verified myself on b4d5788: lint, typecheck, prettier clean; unit 78 files, 1978 passed + 3 expected fail; mock e2e 220 passed. CI `ci` on b4d5788 was still pending when I posted this.

## Required (round 2)
- R-1 (D-63; was Tester F-1, a false promise per lessons-learned section 3): remove "Chat stays open." from CONTACT_RULE (src/lib/booking/changes.ts:282) and CONTACT_LOCKED_TEXT (src/lib/booking/changes.ts:295). Chat (T-046/T-047) does not exist yet. Update the assertions at src/components/booking/ContactWindow.test.tsx:102 and e2e-mock/t073-contact-window-mock.spec.ts:58, so they check that the sentence is gone (not.toContain), and grep for any other copies. Add a note on the T-047 row to bring the sentence back when chat ships.
- R-2 (D-64; was Tester F-4): replace "Visible until <Thu, Oct 22, 12:00 a.m.> (Toronto time)" in contactOpenText (src/lib/booking/changes.ts:288) with "Visible until the end of <Wed, Oct 21> (Toronto time)". Take the day from (contactVisibleUntil - 1 ms) formatted in America/Toronto with weekday, month and day only (no time), so the midnight instant from the server maps to the previous calendar day. Keep the server ISO as the only source. Tests: one summer case, and one where the cut-off falls just after the November DST change (for example last day Oct 25 -> cut-off Nov 2 05:00Z -> "end of Sun, Nov 1"). Also cover the null-`until` fallback.

## Plan compliance
- T-073 items done: D-52 explanation on both pages, cut-off shown in Toronto time, "hidden now" after the cut-off (T-065 L3), customer Cancel hidden when every visit is past (T-072 L-B), plural "Mark them as cooked" (T-072 NIT). D-53 freeze item and L-A correctly left out (they wait on T-064 / Q-35).
- D-59 UI piece (added by the Planner) is in: worded refusal, focused role=alert above Decline, MOCK hook only in the mock adapter.
- D-58: no kitchen photos block exists on the booking pages, so nothing to hide. Confirmed by grep.
- Scope matches the Work Order. No backend, migration or new area touched.

## Security and privacy
- The UI only words what the server sends. contactWindow() uses status plus whether contact is null, which matches contract v1.10 ("contact null on accepted/completed/no-show = window ended"). Nothing private is computed on the client.
- Mock viewOf hides contact and the other party's address at 00:00 Toronto on last day + 8, the same as booking_contact_ends_at. The customer's own cooking address stays visible. The Tester covered DST and boundary instants.
- Cancelled bookings show the "locked" text and promise no window (D-56). Requested, declined and expired keep their old lines.
- No secrets and no real data. The kitchenAddressMissing hook is test-only (sessionStorage), like the existing hooks.

## Accessibility
- The new texts are plain <p> elements inside the existing labelled sections. The D-59 alert gets focus (e2e asserts toBeFocused). The new e2e runs axe and checks for sideways scrolling.

## Optional (batch into round 2 if cheap)
- N-1 (NIT): the D-59 message is copied word for word in src/lib/mocks/mock-booking-changes.ts:572 and src/lib/booking/changes.ts:27. The UI reads EXTRA_REASONS first, so the mock copy is never shown. Use a short placeholder or import one constant, so the two cannot drift.
- N-2 (NIT, Tester F-3): the mock bookingRoutes call viewOf(row, role) without `now`, so route-level tests cannot move the clock.
- I-1 (INFO): an accepted chef's-home booking with no kitchen snapshot (D-62 backfill gap) would show "not shown for this booking" next to "Visible until ...". D-59 prevents new cases, so no action needed.
- I-2 (INFO): a page left open across the cut-off keeps the old text until reload. Acceptable for the prototype.

## Builder question (prefer error.message for D-59?)
No. Keep the UI wording. It states the same facts as the server message. Keep the two in step if either changes.

Re-review scope for round 2: copy and tests for R-1 and R-2 (plus N-1/N-2 if done), the full local suite, and green `ci`.


# Round 2

APPROVE (T-073 Reviewer, round 2, head 6affb93)

Scope: round-2 diff only (`git diff b4d5788..6affb93`, 7 files, +64/-20) and the "Round 2" section of .team/handoffs/T-073-frontend.md.

Verified myself on 6affb93: lint, typecheck and prettier are clean. Unit tests: 78 files, 1978 passed plus 3 expected fails. I could not run mock e2e locally because port 3101 was busy (the Tester is running in parallel). CI `ci` on 6affb93 is green (run 38763330126), and that run includes `npm run test:e2e:mock`.

## Required items
- R-1 (D-63): done. "Chat stays open." is removed from CONTACT_RULE and CONTACT_LOCKED_TEXT (src/lib/booking/changes.ts). A grep of the branch outside .team finds the phrase only in the 4 `not.toContain` assertions: ContactWindow.test.tsx:102, changes.test.ts:526 and :537, and t073-contact-window-mock.spec.ts:58. CONTACT_ENDED_TEXT picks up the change through CONTACT_RULE. The Planner still needs to add the T-047 row note.
- R-2 (D-64): done. `lastVisibleDay()` formats (until - 1 ms) in America/Toronto with weekday, month and day only. The server ISO is still the only source. Tests cover summer (2026-10-28T04:00Z -> "end of Tue, Oct 27"), the November DST case (2026-11-02T05:00Z -> "end of Sun, Nov 1"), null `until` and an unreadable `until` (both give the rule only). There is also a `not.toContain("12:00")` check. I also checked the March DST change in Node: 2026-03-09T04:00Z -> "Sun, Mar 8" and 2026-03-08T05:00Z -> "Sat, Mar 7", both correct.

## Optional items
- N-1: done. KITCHEN_ADDRESS_MISSING_MESSAGE is a single exported constant, used by both EXTRA_REASONS and the mock server. The new static import (mock-booking-changes -> lib/booking/changes -> api/client) is safe because client loads the mock adapter with a dynamic import, and the tests and build pass.
- N-2: done. detailRoute takes `now` (default new Date()) and passes it to viewOf for both roles.

## New problems
None that block approval.
- NIT (no need to fix now): src/lib/booking/changes.ts:23-24 has two JSDoc blocks in a row. The "Extra texts for the reasons..." comment now sits above KITCHEN_ADDRESS_MISSING_MESSAGE instead of EXTRA_REASONS. Move it down the next time someone touches this file.
- INFO: The new date format uses "en-CA" while formatWhen uses its own WHEN formatter. The output is "Tue, Oct 27" in Node 24 and in CI Chromium (e2e is green), so no action needed.

The changes match D-63 and D-64, and no new areas are touched. From the Reviewer's side, T-073 can close once the Tester's round-2 check passes and `ci` is green on the final head.
