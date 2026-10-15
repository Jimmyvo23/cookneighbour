# Handoff: T-072 UI follow-ups from T-066 (Tester)

From: tester  To: reviewer

## Verdict: PASS (no blocking bugs; 2 low notes for the Reviewer and Planner)

## What changed
- Branch: `feature/T-072-t066-ui-followups`, PR #125, verified on head 94cc2f2.
- Tests added (tests only): `src/components/booking/T072Tester.test.tsx` (customer Cancel on a waiting booking: server `nothing_left` shows "There is no visit left to cancel.", raw server text hidden, waiting note stays); `src/lib/booking/changes.test.ts` (Toronto-midnight boundary using `torontoToday(new Date(iso))`: 23:30Z, 03:59Z, 04:00Z, and the November EST changeover).

## How to verify
`npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run test:e2e:mock`. Before my additions: lint, typecheck, prettier clean, 75 files / 1946 unit tests pass, 215 mock e2e pass.

## Checks against the server rules
1. Waiting for a check: `isWaitingForCheck` = accepted AND every day `date < today (Toronto)` AND no `cookedAt`. Matches the migration (`cooked_at`, status accepted). Not shown for one cooked day, a day dated today, other statuses, or empty days (unit + component + e2e). Boundary tests pass: last day yesterday waits, today does not, correct at 03:59Z vs 04:00Z. `torontoToday` uses Intl with America/Toronto, no `toISOString().slice` as today (only `cookedAt`/`reportedAt` timestamps in tests). Copy is neutral: no reason, no outcome promised (a test asserts no refund/cancel/no-show/admin/free-first words).
2. List line shown only for accepted with all dates before today, customer and chef lists; Accepted group unchanged. Limit: list rows know dates only, so it also shows for a cooked booking that awaits completion; the wording is true for both.
3. D-37 wording uses `freeTrialEffect("no_show_chef", { anyDayCooked })`, only for `isFreeTrial`; cooked day = used, none = not used up; both pages (unit + component tests).
4. Mark-cooked prompt only for accepted, past, uncooked days (not today, not future, not other statuses). Server `cooked` allows `visit_date <= today`, so marking a past day is allowed (matches). Mark button works with Enter (e2e). Axe light/dark and 375 px pass in the new e2e.
5. Customer Cancel on a waiting booking: the server answers 409 `nothing_left`; UI shows a worded alert "There is no visit left to cancel." and focus moves to it. Severity LOW.

## Known gaps or risks (not blocking)
- L-A (low, wording accuracy): the server only raises the D-36 flag at `booking_auto_complete_at` = last visit date + 2 days (midnight Toronto; later for chef's-home). The UI says "waiting for a check" from the day after the last visit, i.e. up to ~2 days before any check exists, and during that time the chef can still mark the days. Per the Work Order the rule is "every day before today", so this is as specified. Repro: accepted booking, last day yesterday, none cooked: page says waiting for a check, server has no `booking_flags` row yet. Suggest the Planner confirm this with Q-35/Q-36.
- L-B (low, UX): the customer still sees "Cancel this booking" on a waiting booking and the cancel form's free-trial note ("If no day has been cooked yet, your free first booking is not used up") before the user hits the refusal. The refusal is worded, nothing breaks. The chef side already hides the button (`canChefCancel`); a customer-side guard would be a small follow-up.
- Q-35 and Q-36 remain open: if an admin resolution freezes the booking (like D-53) the chef prompt must go.
- No customer UI reports a chef no-show, so that note has component coverage only.

## What the next agent needs
Reviewer: look at L-A and L-B and decide if they need action now. Nothing else outstanding.
