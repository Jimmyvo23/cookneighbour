# Handoff: T-043 Booking flow UI (tester)

From: tester  To: reviewer

## Verdict
PASS (no product bugs found). Real Playwright, API and RLS run in CI only.

## Checked
- Local: lint, typecheck, prettier --check, unit tests (1613 pass, 3 expected fail as before), build, mock Playwright (144 builder tests plus 2 new, all pass).
- Section 10 and the WO row, covered by existing mock specs and re-read: 1-3 days; day 1 not before tomorrow (D-27); 6 h limit (exactly 6 allowed, over blocks); allergy conflict acknowledgement (picker, synonyms, clears on dish removal); chef's home only when offered; travel fee only at the customer's home; platform fee "Shown only, not collected" with MOCK badge; MOCK payment panel "does not charge you"; free-trial label, second trial at full price with reason, FREE_TRIAL_USED race; D-20 late warning; D-19 expiry note; D-28 fourth request; DOUBLE_BOOKED and DATE_BOOKED marked on the day; no chef phone or address before acceptance (6.8), shown after accept; unbookable and unknown chef give the same not-found; another customer's booking is 404; visitor and chef client guards; axe light and dark; keyboard; 375 px.
- Mock adapter reuses the real pure domain functions (parse, validate, pricing, expiry, cancellation timing) and is typed with src/lib/api/types.ts, so shapes follow the contract (`platformFeeCollected: false`, contact hidden until accepted).
- Server guards (anonymous, chef, admin, other customer 404) are in `e2e/booking-real.spec.ts` and API tests: CI only.

## Bugs
None.

## Tests added
- `e2e-mock/booking-flow-tester.spec.ts`: days offered are 1 to 3; no today or past date offered; a date chosen for day 1 is not offered for day 2; a booked date disappears from a fresh form.

## Open notes
- INFO: `BookingFlow.tsx` is about 1,400 lines; split later.
- Builder's open questions Q-1 to Q-4 remain for Jimmy.
- Admin server guard and the real-route spec depend on CI.

## Round 2 (D-39, D-40) - Tester re-check

Result: **PASS with one bug (MEDIUM, caption is false under the free trial)**. Head checked: 5e04b03.

Bug (MEDIUM, frontend): `PerDayEstimate` says "Labour here is before the free first booking; the total above has it waived" when the trial applies. The API does the opposite: `estimateBooking` sets `days[].labourCents = 0` when `isFreeTrial` (src/lib/domain/pricing.ts, `const labourCents = input.isFreeTrial ? 0 : fullLabour`), and only the totals carry `labourBeforeWaiverCents` / `freeTrialWaivedCents`. So with the trial every day row shows Labour $0.00 and the caption is wrong. The builder's unit test passes non-zero labour with `freeTrial: true`, and the e2e uses `trial: false`, so neither caught it. Fix options (Jimmy/Planner choice): (a) change the caption to "Labour is $0.00 because of the free first booking" (frontend only), or (b) backend adds per-day full labour to `days[]` and the contract. The contract lists `days[]` with `date, cookMinutes, labourCents, ingredientsCents, travelCents, platformFeeCents` and does not say labour is post-waiver; it should.

D-39 checks: per-day cookMinutes, labour and ingredients sum exactly to the totals for 1, 2 and 3 days, with and without the trial (new test). Rows are sorted by date and numbered Day 1..n. Travel and platform fee are in the API days[] but not shown per day (travel shown only as a caption); the totals block still shows them. Not a bug, noted.

D-40 checks: the count uses `GET /api/bookings?status=requested&limit=20` and counts only `requested`, which matches D-28 and the backend rule (`create_booking`: `status = 'requested'` and not past `expires_at`; accepted bookings do NOT count). The list route runs the lazy expiry first, so expired requests drop out of the count. So "open" in the backend means requested and not expired only. (Do not confuse with the list filter `status=open`, which is requested + accepted; the builder correctly did not use it.) limit=20 is above the cap of 3, so the count is exact. A failed count call shows no warning (server still refuses with TOO_MANY_OPEN_REQUESTS). Refetch runs whenever phase changes away from review (returning to the form). Minor: on a failed refetch the previous count stays (stale), harmless. Warning-only does not conflict with PLAN.md D-28 (which asks for a clear error on the fourth request) or the WO; no question for Jimmy.

Regression: none. 3 expected-fail unit tests are the same as round 1 (`ChefDetailView.tester.test.tsx`, marked expected fail).

Tests added: `src/components/booking/PerDayEstimate.sums.test.tsx` (1/2/3 days x trial on/off sums against real `estimateBooking` output, plus a test that documents that API days labour is 0 under the trial).

Results: unit 1623 pass + 3 expected fail; mock e2e 148 pass; eslint, tsc, prettier clean.
