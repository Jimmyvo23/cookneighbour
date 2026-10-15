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

## Added by Planner mid-task (T-074 shape, built against contract v1.10 text, backend branch not merged in)
- D-59: `changeErrorText` knows reason `kitchen_address_missing` (wording: adding a kitchen address switches chef's home off until an admin checks it again, so declining is the practical choice). The existing focused alert in "Your answer" sits right above Decline and shows it. Mock adapter: hook `kitchenAddressMissing` makes accepting a chef's-home request answer 409 with that reason. Tests: unit (changes, mock adapter) and `chef-bookings-mock.spec.ts`. I used my own wording, not the server's "ready message", because the mock cannot know it; if the real server message differs, the UI still shows the UI wording (QUESTION: should the UI prefer `error.message`?).
- D-58: there is NO kitchen photos block on the customer or chef booking pages (`grep` finds kitchen photos only in the chef application, admin review and the public chef page, where the public page shows none). So nothing to hide; no change made. Needs the Planner's decision if a block was expected somewhere.

## How to verify
`npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run test:e2e:mock`
Results here: lint, typecheck, prettier clean; unit 77 files, 1971 passed + 3 expected fail (was 1949); mock e2e 220 passed (was 215). Impeccable `detect` on the two pages: no findings. DB tests not run locally (CI only); no backend change.

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

## Round 2

Reviewer asked for changes (R-1, R-2, N-1, N-2). Jimmy's decisions D-63 and D-64.

- R-1 (D-63): "Chat stays open." removed from CONTACT_RULE and CONTACT_LOCKED_TEXT in `src/lib/booking/changes.ts`. No other copies (grep of src, e2e-mock, e2e, docs). Tests in `ContactWindow.test.tsx`, `changes.test.ts` and `e2e-mock/t073-contact-window-mock.spec.ts` now assert the sentence is absent. The Planner adds the T-047 note (PLAN.md not touched).
- R-2 (D-64): `contactOpenText` now reads "Visible until the end of <Tue, Oct 27> (Toronto time). ...". The day is taken from (contactVisibleUntil - 1 ms) in America/Toronto, weekday/month/day, no time. Server value is the only source. Tests: summer (04:00Z), November after DST (Nov 2 05:00Z -> "Sun, Nov 1"), missing `until` and an unreadable `until` (rule only).
- N-1: `KITCHEN_ADDRESS_MISSING_MESSAGE` exported from `src/lib/booking/changes.ts`, used by EXTRA_REASONS and by the mock server.
- N-2: `detailRoute` in `src/lib/mocks/mock-bookings.ts` takes `now` and passes it to `viewOf`.
- Impeccable helper agents skipped (D-44); copy-only change, no layout edits.

Checks: lint, tsc, prettier clean; unit 1978 passed + 3 expected fail; mock e2e 220 passed.
