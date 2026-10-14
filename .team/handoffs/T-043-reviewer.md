# T-043 Reviewer handoff (saved by the Planner from the Reviewer's report)

PR #103, head reviewed bf7e1fb. Verdict: APPROVE. No blocking or medium findings. Posted on GitHub as a comment (state COMMENTED) because one account cannot approve its own PR; branch protection on `main` requires only `ci`.

Reviewer ran: lint, typecheck, prettier clean; 1623 unit tests pass (same 3 expected failures); mock Playwright `booking-flow*` and `chef-detail*` 48/48; CI green on bf7e1fb (includes `e2e/booking-real.spec.ts`).

## Low findings (Planner: fix in round 4 before merge)

1. **Duplicate ids across hidden page copies.** Section heading ids are fixed strings (`days-h`, `where-h`, `groc-h`, `intake-h`, `trial-h`, `sum-h`, `est-h`, `before-h` in `BookingFlow.tsx`; `days-h`, `where-h`, `intake-h`, `est-h`, `cancel-h` in `BookingDetailView.tsx`; `pay-h` in `parts.tsx:428`). Client-side navigation between the booking page and the form left `days-h`, `where-h`, `intake-h` twice in the document. Fix: `useDomId(...)` / `useId`.
2. **Focus after "Book at full price instead" lands on the review heading, not the alert.** `BookingFlow.tsx:470-474` focuses the alert, then the effect at 289-292 re-runs because `review` changed and focuses `review-heading`. Fix: skip heading focus while an alert is set; add `toBeFocused()` to the full-price test (`e2e-mock/booking-flow-mock.spec.ts` ~483).
3. **Review step wording.** `BookingFlow.tsx:1354` says "At your home (...)" even when the customer typed another cooking address. Suggest "At this address: ...".
4. **"Waiting now" can undercount.** `BookingList.tsx:56-59` counts `requested` only among the first 20 loaded items of all statuses. The D-40 form warning uses the correct query.
5. **Fallback text ignores location type.** `BookingDetailView.tsx:273-278` says the kitchen address comes later whenever `cookingPlace` is null, even for `customer_home`. Make the text depend on `locationType`.

## Info (no action in T-043)

- `BookingFlow.tsx` is about 1,550 lines; splitting it is a safe follow-up.
- `MockPayment` always renders an `h2`, even inside `h3` sections. axe does not flag it.

## Checked and OK

WO row complete (days, dishes, location options, intake D-23, allergy tick D-24/D-38, grocery A/B at cost, estimate matches `pricing.ts`, MOCK platform fee not collected, travel only at customer's home, 6 h limit, free trial and FREE_TRIAL_USED race, MOCK payment D-18, D-27, D-28, D-40 warning-only, D-20 warnings, D-39 per-day from `days[]`). Privacy §6.8 and D-41 respected. Server guards via `requireCustomerPage()` plus client layer; other customer's booking is 404. MOCK labels honest. Accessibility: error summary, focus after errors, axe light and dark, keyboard, 375 px. The `/bookings` list page (outside the WO row) is fine and well under the 25% scope threshold.
