# Handoff: T-077 Frozen booking UI (D-53, D-65, D-66) + T-076 follow-ups

From: frontend  To: tester

## What changed
- Branch: `feature/T-077-frozen-booking-ui` (main aff0070, then merged origin/main after #133). Pull request: see the PR ("Closes #135").
- Part A, freeze UI. `FrozenNotice` (`parts.tsx`, `data-testid="frozen-notice"`) shows "On hold." plus `FROZEN_TEXT` (`lib/booking/changes.ts`, = `CHANGE_REFUSALS.frozen`, the server text). It never says why. Both pages show it in the header when `BookingDetail.frozen`.
  - Chef (`ChefBookingView`, `PickupSections`, `GroceriesSection`): hidden when frozen: the mark-cooked prompt and waiting-check line, the Mark day N button, Finish ("Visit done"), the whole "If the plan changes" section (chef cancel and customer no-show), pickup answer, propose and missed-pickup controls, receipt upload (text says a receipt cannot be added while on hold). Already cooked days still show "Cooked on".
  - Customer (`BookingDetailView`, `PickupSections`): hidden when frozen: Cancel this booking, the propose-pickup form. Receipt Confirm and Dispute stay (D-66). The customer page has no no-show button today, so nothing to hide there.
  - A 409 `reason: "frozen"` already maps to the same text through `changeErrorText` and `receiptErrorText` (both use the server tables); a unit test covers it.
  - `no_day_cooked` bookings have `frozen: false`, so their prompt stays (control test).
- Part B, T-076 (after #133 merged; merge commit, no rebase): `SavedIntakeView` moves focus to the confirm question (`tabIndex={-1}`) when Delete opens, and to the "saved-state" line after a successful delete; `BookingFlow` `SaveToProfile` unticks `saveToProfile` when the box hides because answers match the profile; `docs/api-contract.md` 4A now says "(400, PUT and DELETE; GET has no content-type check)".
- Files: `src/components/booking/{BookingDetailView,ChefBookingView,GroceriesSection,PickupSections,parts,BookingFlow,SavedIntakeView}.tsx`, `src/lib/booking/changes.ts`, `docs/api-contract.md`. Tests: `src/components/booking/FrozenBooking.test.tsx` (new, 9), `SavedIntakeView.test.tsx` (focus asserts), `e2e-mock/t077-frozen-booking-mock.spec.ts` (new, 5, uses `hooks.frozenSeeded` with SEEDED A03/A04/A05/A06), `e2e-mock/allergy-profile-mock.spec.ts` (+1, T-076).

## How to verify
- `npm run lint`, `npm run typecheck`, `npx prettier --check .`: clean.
- `npm test`: 84 files, 2019 passed + 3 expected fail.
- `npm run test:e2e:mock`: 240 passed.
- `.claude/skills/impeccable/scripts/impeccable detect` on the changed pages: no findings. Impeccable helper agents skipped (D-44).
- Manual idea: hook `frozenSeeded: [A04]` then open `/chef/bookings/<A04>` and `/bookings/<A04>`.

## Known gaps or risks
- D-65 to D-68 are not in PLAN.md yet (Planner to add); the code follows the Work Order text.
- Server-side freeze for the real adapter is untested here (DB and API tests run only in CI); the UI relies on `frozen` in `BookingDetail`.
- `BookingSummary` (lists) has no `frozen`, so list pages show no hold marker.
- After a delete, `useAnnounce` also tries to focus the status notice; the saved-state line wins because its effect runs later. The notice is still a live region, so it is announced. If the Reviewer wants a single owner, drop `afterDelete` and let the notice own focus.
- Nothing unfreezes a booking until T-048 (D-67).

## What the next agent needs
- Tester: try a stale page (loaded unfrozen, then frozen) acting: expect the neutral 409 text in the alert. Try 375 px and dark mode on the frozen pages (axe and no sideways scroll are covered for the chef A04 and customer A04 pages only).
- No question for Jimmy.

## Round 2

Fixes for the Reviewer's REQUEST CHANGES (head c4a592b):
- MEDIUM-1: `ChefPickups` now renders `<MissedPickup>` only when `!b.frozen && canMarkPickupMissed(b, now)` (function left unchanged). Test in FrozenBooking.test.tsx uses seed 9105 (window passed): button shows when not frozen, absent when frozen.
- INFO-1: `cancelErrorText` returns `FROZEN_TEXT` for `reason: "frozen"`.
- N1: frozen pickup intro and uncooked-day hints (customer and chef) say "Pickups are paused while this booking is on hold." instead of inviting a proposal. Tests for both roles.
- N2: a frozen chef with a disputed current receipt sees "A receipt cannot be added while this booking is on hold." (`no-receipt-frozen`). Test added.
- Impeccable helper agents skipped (D-44), as in round 1.
- Local: lint, typecheck, prettier clean; vitest 2025 passed, 3 expected fail; mock e2e 243 passed.
