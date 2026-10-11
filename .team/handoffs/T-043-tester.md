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
