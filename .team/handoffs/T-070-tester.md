# Handoff: T-070 Chef dashboard follow-ups (tester)

From: tester  To: reviewer

## What changed
- Branch: `feature/T-070-chef-dashboard-followups`. Pull request: #117 (issue #115). Verdict: **PASS** (no blocking bug).
- Tester file added (tests only): `src/components/booking/ChefEndSections.tester.test.tsx` (27 tests).
- Verified: cancel only while `accepted` (all 7 other statuses checked); confirm text vs D-20 (47h59/48h/48h01 boundary with fake clock), D-26, MOCK, contact data per location (matches `booking_contact_unlocked`: cancelled is locked, so customer loses kitchen address and chef loses customer's address/phone); reason 3-500 (500 sent, 501 refused, whitespace sent as `{}`), contact guard on the field with focus; all cancel/no-show refusals worded; double click sends one request; no-show offered only when a date has come and uncooked (yesterday, today, day 2 after day 1 cooked, tomorrow = hint with next visit); chef's-home pointer to Mark pickup missed; kitchen wording per status; customer page wording for requested/declined/expired/cancelled; mock check order and reason codes match `change_booking` (wrong_status, chef_use_decline, nothing_left; no_visit_due); mock e2e covers axe (light/dark), 375 px, keyboard, focus, storage blocked.

## How to verify
- `npm run lint` clean, `npm run typecheck` clean, `npx prettier --check` on new file clean.
- `npm test`: 72 files before my file, 1896 pass + 3 expected fail; my file 27 pass.
- `npm run test:e2e:mock`: 211 passed.
- `gh pr checks 117`: ci pass.

## Known gaps or risks (bugs, none blocking)
1. LOW, known issue reproduced: after a failed cancel, "Keep the booking" then "Cancel this booking" again shows the old alert text (stale `useSection` error). Not focused, disappears on the next attempt; no data harm. Pinned by test "REPRODUCES: after a failure..." (flip to `toBeNull` when fixed).
2. LOW wording: `cancel-unavailable` says "every visit is either cooked or in the past ... press Visit done". If a past visit was never cooked, Visit done is refused by the server (`days_not_cooked`); the right way out is the no-show button (shown). Repro: accepted booking, day 1 two days ago, not cooked. Pinned by a test.
3. LOW wording: for a chef's-home cancel the confirm text only says the customer loses the kitchen address; the chef also loses the customer's phone (contact locks both ways when cancelled). Not false, incomplete.
4. LOW mock divergence: chef cancel or no-show on an expired `requested` booking: server answers `expired` first; mock answers `chef_use_decline` / `wrong_status`. Mock only; the UI never offers these for a requested booking.
5. INFO: mock no-show does not mark future days inactive (server does); UI does not depend on it.
6. D-37 (T-066) check: nothing in T-070 text says what an auto-complete or a chef no-show does to the trial. The chef-cancel and customer-no-show trial wording follows D-26 as built. No contradiction found. Reviewer: if T-066 changes the customer no-show trial effect to depend on a cooked day, the no-show confirm text ("counts as used") and the post-no-show chef note must be revisited.

## What the next agent needs
- Open questions still Jimmy's: Q-24 (cancel after cooked day uses trial), clock time for no-show, reason required on chef cancel.
- Real-mode routes not run locally (no Docker); covered by T-063 API tests.

## Round 2 (re-check of d6f4bd1)

Verdict: **PASS**. No bugs.

- **M1:** the spec now passes `dayPlus(0)` (Toronto) as the `editMockState` argument. Proof of the evening window: with a faked clock of 21:30 EDT on 13 Oct, `new Date().toISOString().slice(0, 10)` gives 2026-10-14 (wrong) and the Toronto formatter used by `dayPlus` and `torontoToday` gives 2026-10-13. Running the whole Playwright spec under a faked clock was not practical (no faketime); the logic is identical to the app rule. The other `toISOString().slice(0, 10)` uses the frontend listed only add days to a given YYYY-MM-DD at noon UTC (checked `helpers.ts:128`, `calendar.ts`, `dishes.ts`), so they are safe.
- **M2:** chef's-home cancel text names the phone. `booking_contact_unlocked` unlocks only accepted, completed and both no-show statuses, so after a cancel both sides lose contact. The text is correct. Component assertion present.
- **L1:** `cancel-unavailable` now says to mark cooked days then press Visit done, and to report a no-show below. Server `complete` refuses with `days_not_cooked` when an active day is uncooked, and the no-show button is still shown (tester test asserts it).
- **L2:** `useSection.clear()` is new and additive (returned object gains one key); only `useConfirm(sec.clear)` calls it. Other `useSection` users in `src/components/chef/` (AvailabilityView, ChefApplicationView, DishesView, etc.) are unchanged and their tests pass. Flipped tester test expects no alert after cancel failure then reopen; no-show reopen shares the same hook.
- **N1:** missed-pickup text adds "so the customer's free first booking counts as used" only for free-trial bookings; matches contract 7A ("trial consumed").
- Not checked: L3 (Q-37, waiting on Jimmy), L4 (skipped).
- Suite: `npm run lint`, `typecheck` clean; `npm test` 1923 passed, 3 expected fail; `npm run test:e2e:mock` 211 passed.
