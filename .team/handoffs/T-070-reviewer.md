# Handoff: T-070 Chef dashboard follow-ups (reviewer, round 1)

From: reviewer  To: planner, frontend
Verdict: **REQUEST CHANGES** on head 22920ee. PR comment: https://github.com/Jimmyvo23/cookneighbour/pull/117#issuecomment-6181841201

## MEDIUM (block merge)
- **M1.** `e2e-mock/chef-end-booking-mock.spec.ts:201` makes "today" with `new Date().toISOString().slice(0, 10)` (UTC date). From 20:00 EDT / 19:00 EST to midnight that is tomorrow, so the no-show button never shows (timeout at line 206). Fix: pass `dayPlus(0)` (`e2e-mock/helpers.ts:119`, Toronto calendar) into `editMockState`. Add a lessons-learned line.
- **M2.** `src/components/booking/ChefEndSections.tsx:191-194`: chef's-home cancel confirm only says the customer loses the kitchen address; contact locks both ways once cancelled, so the chef also loses the customer's phone. Suggested: "They can no longer see your kitchen address, and you can no longer see their phone number." Add a component assertion.

## LOW
- **L1.** `ChefEndSections.tsx:150-153` `cancel-unavailable` says "press Visit done" even when a past visit was never cooked (server refuses with `days_not_cooked`). Suggested: "There is nothing left to cancel: every visit is cooked or its date has passed. Mark the days you cooked, then press Visit done. If the customer did not show up, report it below." Update the pinned tester test.
- **L2.** Stale error after failed cancel -> Keep the booking -> reopen (`useConfirm`/`useSection`, `ChefEndSections.tsx:45-66`). Clear the section error on `show()` (small reset in `src/components/chef/parts.tsx`) if cheap, else follow-up.
- **L3.** D-52 ("whatever the status", built in T-065) may make "locked after cancel" copy false later: `ChefEndSections.tsx:191-194`, `ChefBookingView.tsx:546-549`, `BookingDetailView.tsx:291, 306`. Correct for today's server. Planner to ask Jimmy (Q-37).
- **L4.** Mock check order for an expired `requested` booking differs from server (`src/lib/mocks/mock-booking-changes.ts:604-605, 623`). Mock only; optional.

## NIT
- **N1.** `ChefBookingView.tsx:271`: trial-used sentence shown only when `pickupMissed` is false; a missed pickup also uses the trial. Optional.

## Checked, no finding
D-37 (not yet on main; no T-070 text contradicts it; T-072 owns the wording), security, accessibility, MOCK honesty, scope.

## Needed to approve
M1, M2, L1 fixed; full `npm run test:e2e:mock` green; CI green on new head; short Tester re-check of changed copy.
