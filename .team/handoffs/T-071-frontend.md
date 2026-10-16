# Handoff: T-071 Pickup confirm (frontend part)

From: frontend  To: tester

## What changed
- Branch: `feature/T-071-pickup-confirm-frontend` (from main 02ff60c). Pull request: "T-071: pickup confirm (frontend part)", Closes #144.
- Types: `BookingDayView.pickedUpAt: string | null` (always present) in `src/lib/api/types.ts`.
- Customer (`PickupSections.tsx`, new `ConfirmPickup`): on every cooked, unconfirmed day of an `accepted`, not frozen, `chef_home` booking: button "I picked up my meals" (or "I picked up day N's meals" when the booking has several days). It opens a confirm step ("Confirm that you picked up ...?", "This can't be undone. The chef is told, and they can no longer mark this pickup as missed. Only confirm if you have the meals.", buttons "Yes, I picked them up" and "Not yet"). On success the same component shows "Picked up on <Toronto time>" and focuses that line (the page is given no message to announce, so the line is the one focus owner). "Not yet" returns focus to the opener. A 409 shows in that day's alert (focus moves to it). Hidden: frozen, not accepted (so also once missed, status `no_show_customer`), customer's home, day not cooked. The deadline passing does not hide it. After a confirm the line stays with no button (no undo, A-28).
- Chef: each confirmed day shows "Picked up (confirmed by the customer) on <time> (Toronto time)." `canMarkPickupMissed` now needs a past-deadline cooked day with no `pickedUpAt`, so the missed-pickup section is hidden otherwise. 409 `pickup_confirmed` has a clear text in `changeErrorText` (`EXTRA_REASONS`): "The customer has confirmed they picked up their meals, so the pickup cannot be marked as missed."
- Decision (confirm vs proposing a time): once a day is confirmed the customer's propose form, "waiting for the chef", "window over" warning and deadline hint for that day are hidden, and the chef's answer buttons / waiting hints for that day are hidden, because there is nothing left to arrange. The server (contract v1.12) voids that day's open/agreed proposals on confirm; the history then reads "closed because you picked up the meals" (customer) / "closed because the customer picked up the meals" (chef) instead of "no answer before the booking ended". The customer's "if the meals are not picked up" warning is hidden when every day is cooked and confirmed. Confirming before a proposal exists is allowed; a proposal is not required.
- Mock adapter: route `POST /api/bookings/:id/days/:n/pickup/confirm` (customer only, 403 for the chef like the other mock role checks), contract v1.12 check order (404 day, `frozen`, `wrong_status`, `not_chef_home`, `day_not_cooked`), idempotent, voids that day's live proposals; `pickedUpAt` on all days; missed pickup answers `pickup_confirmed` when every cooked past-deadline day is confirmed (`pickup_window_open` when none is past its deadline). New hook `pickedUpSeeded: [ids]` marks the cooked days of made-up bookings as picked up.
- Files: `src/lib/api/types.ts`, `src/lib/booking/changes.ts`, `src/components/booking/PickupSections.tsx`, `src/lib/mocks/mock-bookings.ts`, `src/lib/mocks/mock-booking-changes.ts`; tests `src/components/booking/PickupConfirm.test.tsx` (16), `src/lib/mocks/mock-pickup-confirm.test.ts` (10), `src/lib/booking/changes.test.ts` (+3), fixture fix in `BookingDetailView.test.tsx`; `e2e-mock/t071-pickup-confirm-mock.spec.ts` (7).

## How to verify
- `npm run lint`, `npx prettier --check .`: clean. `npm test`: 87 files, 2068 passed + 3 expected fail. `npm run test:e2e:mock`: 250 passed (incl. 7 new). Spec blocks hosted storage.
- `npm run typecheck`: one error, `src/lib/server/booking-views.ts` is missing `pickedUpAt` in the day it builds. That file is Backend's (`src/lib/server/**`, I may not edit it). It goes away when the backend PR merges (Backend adds `pickedUpAt: d.picked_up_at ...` there). Merge order: backend first, then update this branch, then `ci` is green.
- `impeccable detect src/components/booking/PickupSections.tsx`: no findings. Impeccable helper agents skipped (D-44).
- Manual: mock mode, hooks `seedCustomer: true`, open `/bookings/<A05>` and press the button; chef side with `pickedUpSeeded: [A05]` at `/chef/bookings/<A05>`.

## Known gaps or risks
- Written code first, then tests (not strict TDD); tests cover every rule above.
- In mock mode the customer's and the chef's made-up bookings are separate copies, so "customer confirms, then the chef cannot mark missed" is proven in two halves (customer click; chef with `pickedUpSeeded`) plus the mock route test for `pickup_confirmed`.
- Types vs Backend's contract (branch `feature/T-071-pickup-confirm-backend`, commit 3b3c8ec, contract only so far; no server code yet). Differences found: none in shape. Notes: contract names the chef-home-only reason `not_chef_home` (mock uses it). A cancelled day gives 409 `wrong_status` in the contract; the mock has no cancelled days so it does not model it. Contract says a wrong party gets 404 and the role check is 403 (mock: 403 for the chef, 404 for a stranger/unknown day/booking, like the other routes). The contract adds a `pickup_confirmed` notification type; the UI does not show notifications yet (T-047).
- The `pickup_confirmed` text is in `EXTRA_REASONS` (frontend) and the mock's `PICKUP_CONFIRM_REFUSALS`; the server's own message for the reason may differ in wording (the UI uses its own text by reason, so users see one wording).
- Auto-completion for confirmed bookings is unchanged (contract A-29 follow-up), nothing in the UI.
- A-26..A-29 are Planner assumptions, not yet confirmed by Jimmy.

## What the next agent needs
- Tester: try a stale page (chef page open, customer confirms elsewhere, chef presses "Yes, mark pickup missed": expect the `pickup_confirmed` text in the alert with focus). Try two days (one confirmed, one not) and 375 px / dark mode. Real API tests of the route belong to Backend's PR.
- No question for Jimmy.
