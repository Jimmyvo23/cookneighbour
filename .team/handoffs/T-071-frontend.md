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
- `npm run typecheck`: clean, but only with Backend's code. The first push failed `ci` typecheck because `src/lib/server/booking-views.ts` (Backend's file) lacked `pickedUpAt`. Backend's code landed (4cd32c5, c0d36e2), so this branch merges `feature/T-071-pickup-confirm-backend` (merge commit, no edits to Backend files). Merge the backend PR first; this PR's diff then shrinks to the frontend files.
- `impeccable detect src/components/booking/PickupSections.tsx`: no findings. Impeccable helper agents skipped (D-44).
- Manual: mock mode, hooks `seedCustomer: true`, open `/bookings/<A05>` and press the button; chef side with `pickedUpSeeded: [A05]` at `/chef/bookings/<A05>`.

## Known gaps or risks
- Written code first, then tests (not strict TDD); tests cover every rule above.
- In mock mode the customer's and the chef's made-up bookings are separate copies, so "customer confirms, then the chef cannot mark missed" is proven in two halves (customer click; chef with `pickedUpSeeded`) plus the mock route test for `pickup_confirmed`.
- Types and mock vs Backend's branch (contract 3b3c8ec plus code 4cd32c5): shape identical (`days[].pickedUpAt: ISO|null`, route path, no body, reasons `day_not_cooked`, `wrong_status`, `frozen`, `not_chef_home`, `pickup_confirmed`). The 409 text for `pickup_confirmed` comes from Backend's `CHANGE_REFUSALS` (I removed my own copy after the merge). Differences: a cancelled day gives 409 `wrong_status` in the contract; the mock has no cancelled days so it does not model it. Role check is 403 (mock too); a stranger or unknown day is 404 (mock too). The `pickup_confirmed` notification type is not shown in the UI yet (T-047).
- Auto-completion for confirmed bookings is unchanged (contract A-29 follow-up), nothing in the UI.
- A-26..A-29 are Planner assumptions, not yet confirmed by Jimmy.

## What the next agent needs
- Tester: try a stale page (chef page open, customer confirms elsewhere, chef presses "Yes, mark pickup missed": expect the `pickup_confirmed` text in the alert with focus). Try two days (one confirmed, one not) and 375 px / dark mode. Real API tests of the route belong to Backend's PR.
- No question for Jimmy.

## Round 2

Fixes for the Reviewer's APPROVE notes (`T-071-reviewer-frontend.md`):
- LOW: both `CustomerPickups` and `ChefPickups` now also render when any day has `pickedUpAt`, so a "Picked up on" line is not lost once the booking is completed. Unit tests: completed + confirmed with no proposals, customer and chef (plus a control: nothing confirmed, no proposals, still no section).
- NIT: intros mention the confirm action ("...press the button for that day to tell the chef you picked them up"; chef: "the customer can also confirm that they picked the meals up; after that you cannot mark that pickup as missed"). Unit test pins both.
- NIT: `PickupProposalView.status` comment in `types.ts` now says `void` also covers a pickup confirmed by the customer.
- NIT: mock confirm keeps an existing `respondedAt` (`p.respondedAt ?? now`).
- NIT: removed the unused `days[].pickedUp` seed option; the hook `pickedUpSeeded` is the only way.
- Not done on purpose: stale-409 refetch (separate follow-up).
- Local: lint, typecheck, prettier clean; vitest 2080 passed + 3 expected fail; mock e2e t071, chef-bookings and customer-changes specs 55 passed.

## Round 3

- Merged `origin/feature/T-071-pickup-confirm-backend` (e5eca44) with a merge commit, no conflicts. `changes.ts` keeps Backend's `picked_up` text (it comes from `CHANGE_REFUSALS`, so `changeErrorText` and `proposalErrorText` already show "You already confirmed that you picked up these meals.").
- Mock: `pickup/propose` on a day with `pickedUpAt` gives 409 `picked_up` after the deadline check (contract order) and stores nothing. Tests: `mock-pickup-confirm.test.ts` (+1), `changes.test.ts` (+1 assert).
- Local: lint, typecheck, prettier clean; vitest 2081 passed + 3 expected fail; full mock e2e 254 passed.
