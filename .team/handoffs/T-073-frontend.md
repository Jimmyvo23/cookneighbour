# Handoff: T-073 Contact window UI (D-52, D-56) and T-072 follow-ups

From: frontend  To: tester

## What changed
- Branch: `feature/T-073-contact-window-ui`
- Pull request: see the PR for "Closes #127"
- `src/lib/booking/changes.ts`: new `canCustomerCancel`, `contactWindow` (open / ended / locked / later / never), `contactOpenText`, and the shared texts `CONTACT_RULE`, `CONTACT_ENDED_TEXT`, `CONTACT_LOCKED_TEXT`.
- `src/components/booking/BookingDetailView.tsx` (customer): while contact is visible, a `contact-window` line "Visible until <date, time> (Toronto time). Phone numbers and addresses are hidden 7 days after the last visit day. Chat stays open." After the cut-off (accepted / completed / no-show with `contact: null`) `contact-later` says "Contact details are hidden now. ..." and the kitchen line says "hidden now". Cancelled: "not shown for this booking. Phone numbers and addresses are locked when a booking is cancelled. Chat stays open." (no window promised). Cancel button uses `canCustomerCancel` (hidden when every visit day is past; T-072 L-B).
- `src/components/booking/ChefBookingView.tsx` (chef): same three cases for the customer's phone and address. `KitchenNote` no longer promises the customer "can still see" the kitchen address forever: it says "until 7 days after the last visit day", and "can no longer see" after the cut-off (it still says the address stays locked while accepted). Plural "Mark them as cooked" (T-072 NIT).
- `src/lib/mocks/mock-bookings.ts`: `viewOf` mirrors the server (`booking_contact_ends_at` = 00:00 Toronto on last day + 8): hides contact after that and sends `contactVisibleUntil`. Takes an optional `now` (default `new Date()`).
- Tests: `src/components/booking/ContactWindow.test.tsx` (new, 16), `src/lib/booking/changes.test.ts` (+4), `e2e-mock/t073-contact-window-mock.spec.ts` (new, 4). `T072Tester.test.tsx` changed: the "Cancel on a waiting booking" test now asserts the button is hidden, and the worded `nothing_left` refusal is tested on a stale page (a visit day left on load).

## How to verify
`npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run test:e2e:mock`
Results here: lint, typecheck, prettier clean; unit 77 files, 1970 passed + 3 expected fail (was 1949); mock e2e 219 passed (was 215). Impeccable `detect` on the two pages: no findings. DB tests not run locally (CI only); no backend change.

## Known gaps or risks
- The cut-off sentence says "Visible until Thu, Oct 22, 12:00 a.m. (Toronto time)": the exact instant from the server (midnight). Honest, but "12:00 a.m." can read as ambiguous; a Planner or Jimmy call if a friendlier "end of Wed, Oct 21" is wanted.
- "Hidden now" is derived: status accepted / completed / no-show AND `contact === null`. This relies on the contract (contact is null only when the window is over).
- The window is the same for both parties, so the chef page infers the customer's view of the kitchen address from its own `contact` being null.
- Stage skipped (D-44): Impeccable finish-reviewer and documenter helper agents were removed; the Tester and Reviewer do that work.
- Out of scope, untouched: D-53 freeze item (T-064), Tester L-A (Q-35), T-074 backend items (kitchen photos window, D-59 accept refusal); the generic error display is used.
- Kitchen photos (D-58) are still shown by the server status-only until T-074; no UI text here promises their window.

## What the next agent needs
- Tester: check the copy against `get_booking_contact` and `booking_contact_ends_at`: last visit day + 8 at 00:00 Toronto (so "7 days after the last visit day" means through the end of day + 7). Edge cases worth a look: DST weeks, one-day bookings, a booking whose last day is today (window open), and a page left open across the cut-off (the text only changes on reload).
- Mock e2e uses `dayPlus` (Toronto), never UTC today.

## Open questions
1. Do you want "Visible until" to read "end of <day>" instead of "12:00 a.m." (see risks)?
2. Is a "hidden now" text enough for declined and expired bookings? They keep the old "not shown for this booking" line (the window does not apply).
