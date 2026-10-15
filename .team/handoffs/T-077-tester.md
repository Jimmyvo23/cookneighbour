# Handoff: T-077 Frozen booking UI + T-076 focus fixes (Tester)

From: tester  To: reviewer

Result: PASS

## What changed
- Tests only. New: `src/components/booking/FrozenBooking.tester.test.tsx` (3 unit), `e2e-mock/t077-tester-mock.spec.ts` (3 mock e2e). No app code touched.
- Head under test: 2470a82 (builder). Final head: see the PR (this handoff is the last commit).

## Verified
- Frozen, chef: notice shows "On hold." plus the server text, no reason (checked for reject/flag words); mark-cooked prompt, waiting line, Mark day, Visit done, cancel and no-show, pickup answer and missed-pickup, receipt upload all hidden. Cooked days still show "Cooked on" (new test).
- Frozen, customer: notice shown; Cancel and propose form hidden; receipt Confirm and Dispute kept (D-66).
- Stale pages: chef mark-cooked (builder test), customer cancel and customer propose answering 409 `frozen` (new tests) all show the same neutral text in the alert.
- `no_day_cooked` (frozen false): no notice, prompt stays (builder control test).
- T-076: keyboard only (new e2e): Enter on Delete puts focus on the confirm question; Tab reaches "Yes, delete it"; Enter deletes; focus lands on the saved-state line; `profile-status` is still `role="status"` with "deleted", so it is announced; Tab leaves the line (no trap). Builder's focus-order note is fine: the saved line wins because its effect runs after `useAnnounce`'s. The unticking e2e (builder) passes; contract 4A wording reads "(400, PUT and DELETE; GET has no content-type check)".
- Accessibility (new e2e): all four seeded bookings (A03 to A06) frozen, chef and customer pages, 375 px, light and dark: no sideways scroll, axe clean. Builder e2e also covers axe on A04.
- Regressions: `npm run lint` clean, `npm run typecheck` clean, `npx prettier --check .` clean, `npm test` 84 files 2019 passed + 3 expected fail (before my additions; with them 85 files, 2022 passed), `npm run test:e2e:mock` 240 passed before my additions.

## Findings
- No failures.
- INFO-1: `BookingDetailView.cancelErrorText` returns the server message for `frozen`, not the shared table. Fine with the real route and mock (both send the same text, and a unit test proves it); a different message would show as is. Optional hardening: map `reason: "frozen"` to FROZEN_TEXT.
- INFO-2: list pages have no `frozen` marker (builder already noted).
- INFO-3: real-adapter freeze is untested in the UI (DB tests run in CI only), as the builder noted.
- Test-writing note: a second `loginCustomer` on a page where the chef is signed in does not switch accounts; use a new browser context.

## Known gaps or risks
- Dark mode on frozen pages is checked by axe only (no visual review).

## What the next agent needs
- Reviewer: nothing blocking. Check D-65 to D-68 wording in PLAN.md vs the notice text if desired.
