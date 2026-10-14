# Handoff: T-043 Booking flow UI

From: frontend  To: tester

## What changed
- Branch: `feature/T-043-booking-flow-ui`
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/103 (Closes #31)
- No API route, migration, contract text or business rule was changed. Built against `docs/api-contract.md` v1.5 (sections 7A, 11A).
- New pages (all customer only, server guard `requireCustomerPage` in `src/lib/server/page-guard.ts`, plus the client layer `isCustomerPage` in `src/lib/auth/route-guard.ts`):
  - `src/app/chefs/[id]/book/page.tsx` -> `BookingFlow` (step 1 form, step 2 review and send)
  - `src/app/bookings/[id]/page.tsx` -> `BookingDetailView` (confirmation, detail, customer cancel)
  - `src/app/bookings/page.tsx` -> `BookingList` (my bookings; small addition so the customer can find and cancel requests after `TOO_MANY_OPEN_REQUESTS`)
- Components: `src/components/booking/BookingFlow.tsx`, `BookingDetailView.tsx`, `BookingList.tsx`, `parts.tsx` (fields, error summary, estimate lines, MOCK payment panel, page-scoped ids).
- Pure helpers: `src/lib/booking/form.ts` (request body, local checks, error mapping, late-window check, wording).
- Mock adapter: `src/lib/mocks/mock-bookings.ts` (estimate, create, list, detail, cancel with the real pure rules), wired in `src/lib/mocks/mock-adapter.ts`; `hideHeldDates` removes the customer's own booked dates from the mock chef page (A-19). `src/lib/mocks/mock-search.ts` only exports the `MockChef` type.
- `src/lib/api/client.ts`: `ApiClientError` now carries `issues` and `reason`.
- Changed: `src/components/chefs/ChefDetailView.tsx` (Book stub becomes a link, `data-testid="book-link"`, shown only if the chef has free days), `src/components/AccountBar.tsx` ("My bookings" for customers).
- Updated old tests that referenced the stub: `src/components/chefs/ChefDetailView.tester.test.tsx`, `e2e-mock/chef-detail-mock.spec.ts`, `e2e-mock/chef-detail-tester.spec.ts`, `e2e/search-real.spec.ts`.
- New tests: `src/lib/booking/form.test.ts`, `src/lib/mocks/mock-bookings.test.ts`, `src/components/booking/BookingDetailView.test.tsx`, `src/lib/auth/route-guard.test.ts` and `src/lib/server/page-guard.test.ts` (customer cases), `e2e-mock/booking-flow-mock.spec.ts`, `e2e/booking-real.spec.ts` (listed in `playwright.config.ts` testIgnore when no local stack), helpers `signUpCustomer`, `setMockHooks`, `dayPlus` in `e2e-mock/helpers.ts`.
- `docs/lessons-learned.md`: three new rows (hidden page copies share ids, state that outlives the action, one owner for focus).

## How to verify
- `npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run build` (local: 1613 unit tests pass, 3 expected fail as before).
- `npm run test:e2e:mock` (local: 144 pass, 23 of them in `booking-flow-mock.spec.ts`).
- Real-route spec `e2e/booking-real.spec.ts` and the rest of the real suite run only in CI (no Docker on the builder's Mac). See the PR for the CI run.
- By hand in mock mode (`NEXT_PUBLIC_API_MOCK=1 npm run dev`): sign up as a customer, verify the phone (any code), save an address, open a Mississauga Vietnamese chef (Mai Tran), press Book.
- MOCK test hooks (set from a test with sessionStorage, key `cookneighbour-mock-api-state`, field `hooks`): `otherBooked: { <chefId>: [dates] }` makes create answer 409 `DOUBLE_BOOKED` while the page still lists the date; `trialRaceOnce: true` makes the next free-trial create answer 409 `FREE_TRIAL_USED`. A chef cannot answer in mock mode; a test can edit the saved booking row to `accepted` to see the kitchen address and phone appear.

## Known gaps or risks
- Real-route spec (`e2e/booking-real.spec.ts`) could not be run locally; it is unproven until CI passes. It assumes the seeded dish "Pho" (120 min) from `createSubmittedChef`.
- Not covered by the contract, so not built: nothing to show a chef's shopping list or receipt (T-044/T-045), no report-a-problem or review (WO-5), no way for the customer to propose a pickup time (T-045 owns the missed-pickup flow).
- `DATE_TOO_SOON` is handled (the dates are refreshed and the field is marked) but is hard to trigger by hand: it only happens when the page stays open past midnight in Toronto. It is covered by `form.test.ts` and `mock-bookings.test.ts`, not by a browser test.
- The cooking-address postal code is shown in the form as the API returns it (no space, for example `L5B1M2`).
- Cancel: the page shows the `late` warning computed in the browser from `cancellationTiming` (same function as the server). The server's own `cancellationTiming` in the answer is what the page shows afterwards.
- The free-trial wording after a cancel is derived from `days[].cookedAt` with `freeTrialEffect`, which mirrors D-26. Backend decides the real outcome.
- `BookingFlow.tsx` is long (about 1,400 lines after Prettier). Left as one file for now; splitting is a safe follow-up.
- Pages that stay mounted but hidden after in-app navigation (cacheComponents) mean Playwright locators for `main` need `.filter({ visible: true })`.

## What the next agent needs
- Tester focus (CLAUDE.md section 10):
  - double booking (the date disappears from the form after a booking; stale form gets 409 `DOUBLE_BOOKED` and the field is marked);
  - the fourth open request (D-28) and how the customer gets to `/bookings`;
  - over-6-hours: warning at once, blocks Review, exactly 6 hours passes;
  - allergy conflict: typed text (synonyms, D-24) and picker values; the box must be ticked; removing the dish clears it; the review repeats it;
  - second free trial: blocked reasons in words; `FREE_TRIAL_USED` race offers "Book at full price instead" and shows the new estimate first;
  - past, today and more than 3 days: the form never offers today, 3 days maximum;
  - chef's home not offered: no radio; hidden chef, pending chef and unknown id show the same not-found page;
  - 6.8: no phone number or chef address on any page before acceptance (search the page text and the API answers);
  - guards: visitor goes to /login, chef and admin go to /, server-side (real mode), and another customer's booking id is a not-found;
  - keyboard and screen reader: error summary takes focus, links move focus to the field, the review heading takes focus; axe in light and dark mode; 375 px with no sideways scroll.
- Late-cancellation warning (D-20) appears on the review when day 1 is less than 48 hours away (Toronto midnight, inclusive cut-off) and again before the customer confirms a cancel.

## Assumptions Jimmy did not decide (easy to change)
1. The flow is two steps (form, then review and send). Not specified in the Work Order.
2. The free first booking checkbox is on by default; the estimate then says whether it is available and why not.
3. Sending is disabled when the estimate says the phone is not verified or submitted (the API would refuse it anyway).
4. A small "My bookings" list page and link in the account bar were added (not in the Work Order row) so a customer can see and cancel requests.
5. The cooking address starts from the saved home address and can be changed (the contract allows a different cooking address).
6. After a successful send the form closes and shows a "request sent" panel, so coming back never shows a stale review.
7. MOCK payment panel: text only, no fake card form. Wording says what would be owed; nothing is charged.
8. The eat-by note on the booking page says the days are a prototype default (Ontario guidance not confirmed).

## Open questions for Jimmy
- Q-1: Should the customer have to re-confirm the allergy answers on the review step, or is the one tick at the conflict enough?
- Q-2: Should the price step show the per-day breakdown (the API returns it)? It currently shows totals only, plus the days and dishes above.
- Q-3: After "request sent", should a customer who is already at 3 open requests be warned on the form (before filling it in) instead of at the end? The form does not know the count; a call to `GET /api/bookings?status=requested` would tell it.
- Q-4: The customer's own cooking address is visible on their booking page at all times (the contract says so). Is that the wanted behaviour for the page, or should it also wait for acceptance?

## Round 2 (WO-4b, Jimmy's decisions D-38 to D-41)
- D-38 (Q-1): one allergy tick on the review stays. No change. The saved allergy profile is T-067, not built.
- D-39 (Q-2) per-day estimate: the review now has a "Day by day" block under the totals (`PerDayEstimate` in `src/components/booking/BookingFlow.tsx`). Source: the estimate API response, `estimate.days[]` (date, cookMinutes, labourCents, ingredientsCents), nothing computed in the browser. Labour per day is before the free first booking; the block says so when the trial applies. Totals are unchanged. Tests: `src/components/booking/PerDayEstimate.test.tsx`, mock e2e "the review shows an estimate for each day".
- D-40 (Q-3) warning before the form: after the role is known, the form step calls `GET /api/bookings?status=requested&limit=20` and, with `MAX_OPEN_REQUESTS` (3) or more, shows `open-limit-warning` above the form: why, and a link to `/bookings`. It is a warning, not a block: the form stays usable and the server `TOO_MANY_OPEN_REQUESTS` handling is unchanged. If the count call fails there is no warning. The count is refreshed whenever the flow returns to the form step. Test: mock e2e "a customer with 3 open requests is warned before the form" (also checks no warning at 2, axe, and the link). The older "fourth open request is refused" test still covers the server path.
- D-41 (Q-4): own address stays visible. No change.
- No backend, contract or migration change.
- Local results: lint, typecheck, prettier clean; 1616 unit tests pass (3 expected fail); 148 mock e2e pass.

## Round 3 (Tester MEDIUM: per-day caption)
- Bug: under the free trial the API sends `days[].labourCents = 0`, but the caption said labour was "before the free first booking".
- Fix (frontend only, option a): the caption now reads "Labour is free on this first booking, so each day shows $0.00. The full value of the waived labour is in the totals above." (`PerDayEstimate` in `BookingFlow.tsx`).
- `PerDayEstimate.test.tsx` now uses realistic data (labour 0 per day under the trial) and checks the new wording. The Tester's `PerDayEstimate.sums.test.tsx` still passes.

## Round 4 (Reviewer's 5 LOW findings)
1. Heading ids: every section heading id in `FormStep`, `ReviewStep`, `Ready`, `CancelSection` and `MockPayment` now comes from a per-instance `useId()` prefix. Test: the "second form in the same tab" mock e2e now asserts no duplicate id in the document while the booking page stays mounted hidden.
2. Focus: the heading-focus effect in `BookingFlow` skips while an alert is showing, so "Book at full price instead" leaves focus on the alert. Test: `toBeFocused()` added in the full-price mock e2e.
3. Review wording: "At this address: <line>, <city>" for customer-home bookings. Test: new mock e2e (typed address is shown, "At your home (" is not).
4. "Waiting now": `BookingList` fetches `GET /api/bookings?status=requested&limit=20` (same query as the D-40 warning). Test: new `BookingList.test.tsx` (first page has 20 other-status items, 3 requested are elsewhere, count shows 3).
5. `kitchen-later` text depends on `locationType`: chef's home keeps the kitchen sentence; customer's home says "Your cooking address is not available on this page." Test added in `BookingDetailView.test.tsx`.
- Local: lint, typecheck, prettier clean; 1625 unit tests pass (3 expected fail); 149 mock e2e pass.
