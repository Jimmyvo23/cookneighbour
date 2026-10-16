REQUEST CHANGES (T-077 frozen booking UI + T-076, head c4a592b)

Reviewer: reviewer agent. Read: .team/handoffs/T-077-frontend.md, .team/handoffs/T-077-tester.md (PASS, INFO-1 to INFO-3), PLAN.md T-076/T-077 rows, D-53, D-57, D-65 to D-68, docs/api-contract.md v1.11, docs/lessons-learned.md, PRODUCT.md, `gh pr diff 137`.
Checked myself: lint clean, typecheck clean, prettier clean, `npx vitest run src/components/booking` 16 files / 215 passed. ci green.

## MEDIUM-1 (must fix): "The meals were not picked up" (missed pickup) still shows on a frozen booking
- `ChefPickups` (src/components/booking/PickupSections.tsx, around line 361) renders `<MissedPickup>` when `canMarkPickupMissed(b, now)` is true. `canMarkPickupMissed` (src/lib/booking/changes.ts:220) checks status, location and the passed pickup window only. Neither checks `b.frozen`.
- The server refuses it: contract v1.11 lists "pickup ... missed" among the actions `change_booking` refuses with 409 `frozen`, and src/lib/mocks/mock-flag-freeze.test.ts:78 sends `POST /pickup/missed` on a frozen booking and expects the refusal.
- So on a frozen chef's-home booking whose pickup window has passed, the chef sees a button the server always refuses. This is a likely case: a rejected chef's (D-22) accepted bookings get older while they wait for T-048 (D-67). The stale-page fallback shows the neutral text, so nothing leaks, but the task says to hide every action the server refuses, and both handoffs say missed-pickup is hidden.
- Why the tests missed it: the frozen chef's-home unit test (seeded 9103) has no passed pickup window, so `missed-pickup` is absent whether frozen or not. No control test proves the button appears when the booking is not frozen.
- Fix: add `!b.frozen &&` to the `MissedPickup` condition (or to `canMarkPickupMissed`, with a check that it has no other callers that need the unfrozen meaning). Add a unit test with a passed pickup window: not frozen shows `missed-pickup`, frozen does not.

## Tester INFO-1 (recommend fixing in the same round)
`cancelErrorText` (BookingDetailView.tsx:74) returns `err.message` for `reason: "frozen"`. The real route and the mock send the same sentence today, so it works. Add `if (err.reason === "frozen") return FROZEN_TEXT;`. Then the customer's cancel matches `changeErrorText`/`receiptErrorText`, and the neutral wording cannot drift if the server message changes. The privacy promise ("never says why") should not depend on another layer's string. It is one line, and the Tester's stale-cancel test already covers it.

## NITs (optional, same round if convenient)
- N1: on a frozen customer chef's-home page the intro still says "Agree a pickup time with the chef here: you propose a time..." and uncooked days say "You can propose a pickup time after that" (the `live` wording). Both are acceptable with the On hold notice above them. Optionally use the `open` wording, or a short "Pickups are paused while this booking is on hold."
- N2: GroceriesSection, chef, frozen, current receipt `disputed`: the upload form is hidden (correct), but nothing says why, because the "cannot be added while on hold" line shows only when there is no receipt. Optional one-line hint.

## Verified OK
- Correctness: hidden when frozen. Chef: mark-cooked prompt and waiting line, Mark day N, Visit done (Finish), the whole end section (chef cancel and customer no-show), pickup accept/decline, receipt upload. Customer: Cancel, propose form. Kept (D-66): receipt Confirm and Dispute. Reading stays: days, "Cooked on", history, contact window. Only `accepted` bookings get frozen (admin_reject_chef flags only `status = 'accepted'`; requests are cancelled), so accept/decline needs no gate. `no_day_cooked` keeps `frozen: false` and its prompt (D-57; control test).
- Privacy: `FrozenNotice` shows "On hold." plus `FROZEN_TEXT` = `CHANGE_REFUSALS.frozen`, with no reason, flag name or admin note. Tests assert no reject/flag words. `frozen` comes only from `get_booking_frozen` (parties only).
- Accessibility: the notice is static text in the header area, with the info box style. Axe and no sideways scroll at 375 px in light and dark on A03 to A06 (Tester).
- T-076: focus goes to the confirm question (`tabIndex=-1`) on open, back to Delete on cancel, and to the saved-state line after delete. Two effects focus after a delete (`useAnnounce` notice, then the saved line). The saved line wins because its effect runs later. The notice stays a `role="status"` live region, so "deleted" is still announced. Recommendation: keep it as is. The unit test and the Tester's keyboard e2e pin the order. If it ever regresses, drop the notice's focus for this path rather than the saved line's. The `SaveToProfile` hook now runs before the early return (Rules of Hooks OK). It unticks only when hidden, and the default is false. The contract 4A wording is fixed.
- Mocks: no money, identity or SMS code touched. No MOCK labels needed or lost.
- Scope: matches the T-076 and T-077 rows (WO-4b). No new areas. INFO-2 (no list marker) and INFO-3 (real-adapter UI untested) are fine as follow-ups or for T-048.

Re-review needed after the fix: only the MEDIUM-1 change and its test (plus INFO-1 if taken).

---

# Round 2

APPROVE (T-077 frozen booking UI + T-076, round 2, head c5ea0ae)

Reviewer: reviewer agent. Read: my round-1 REQUEST CHANGES (head c4a592b), "## Round 2" in .team/handoffs/T-077-frontend.md, "## Round 2" in .team/handoffs/T-077-tester.md (PASS, no new test commits), `git diff c4a592b 04fcc83`, the main merge ce61efe, and the Tester's handoff-only commit c5ea0ae.
Checked myself on ce61efe: lint clean, `tsc --noEmit` clean, prettier clean, `npx vitest run src/components/booking src/lib` 82 files / 1960 passed. CI: 04fcc83 green. ce61efe was cancelled because a newer push replaced it. c5ea0ae (handoff text only) is still running. Merge only after it is green (D-42).

## Round-1 items
- MEDIUM-1 FIXED. `ChefPickups` (src/components/booking/PickupSections.tsx) now renders `<MissedPickup>` only when `!b.frozen && canMarkPickupMissed(b, now)`. `canMarkPickupMissed` is unchanged, so other callers keep their meaning. The new FrozenBooking.test.tsx case uses seed 9105, where the pickup window has passed. It checks both sides: `missed-pickup` shows when not frozen and is gone when frozen. That is the control test that was missing.
- INFO-1 FIXED. `cancelErrorText` (BookingDetailView.tsx) returns `FROZEN_TEXT` for `reason: "frozen"` before the `err.message` fallback. So the customer's cancel now uses the same neutral wording as `changeErrorText` and `receiptErrorText`. The Tester's stale-cancel test still passes.
- N1 FIXED. When frozen, the intros and the uncooked-day hints on both the customer and chef pickup sections say "Pickups are paused while this booking is on hold." (shared `PICKUPS_PAUSED` constant). Unfrozen wording is unchanged. The customer test checks the new text and that neither proposal invitation appears.
- N2 FIXED. GroceriesSection: when the viewer is the chef, the booking is frozen, option B applies, the booking is open and the current receipt is `disputed`, the chef now sees "A receipt cannot be added while this booking is on hold." (`no-receipt-frozen`). This condition is the exact opposite of the `canUpload` branch for disputed receipts (frozen instead of !frozen), so the hint shows exactly when the form is hidden only because of the freeze. Test added (form absent, hint present).

## Nothing new introduced
- Privacy: the new text says "on hold" or "paused" only. No reason, flag or admin wording.
- The diff touches only the four T-077 files plus the handoff. The main merge brings only PLAN.md and other tasks' handoff files. No scope growth. No money, identity or SMS code touched. MOCK labels unchanged.

## Follow-up NITs (non-blocking, do not hold the merge)
- NIT-1 (test): the chef "pickup intro" test checks for "Pickups are paused" in the whole section, but the intro already has that text. So the chef's uncooked-day hint change is not pinned on its own, and `not.toMatch(/proposes a pickup time/)` does not catch the old day-hint wording ("Then the customer can propose a pickup time"). Its second half (`pastUncooked(true)`) only checks `frozen-notice`. Suggest scoping the check to the day `<li>` or adding `not.toMatch(/can propose a pickup time/)`.
- NIT-2 (wording): a frozen chef's-home page now says "on hold" or "paused" in the notice, the intro and each uncooked day. This is clear but a little repetitive. Fine for the prototype.
- Carried over: Tester INFO (the missed-pickup e2e is weak with no clock hook), round-1 INFO-2 (no list marker) and INFO-3 (real-adapter UI untested). These belong in follow-ups or T-048.
