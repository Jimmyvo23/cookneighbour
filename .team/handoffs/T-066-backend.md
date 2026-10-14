# Handoff: T-066 Booking change fixes

From: backend  To: tester

## What changed
- Branch: `feature/T-066-booking-change-fixes`. Pull request: "T-066: booking change fixes" (Closes #114, WO-4b).
- Migration (new, NOT pushed to hosted; the Planner asks Jimmy to run `supabase db push --linked` after merge): `supabase/migrations/20261014150000_booking_change_fixes.sql`
  - `booking_flags.reason` check now allows `no_day_cooked` (besides `chef_rejected`).
  - `sweep_booking_changes` (replaced): auto-completes only when at least one day has `cooked_at` (D-36); otherwise inserts ONE `no_day_cooked` flag (on conflict do nothing) and ONE `booking_flagged` notification to each party; booking stays `accepted`, claim stays `held`. Auto-completion also voids proposed and accepted pickups. Returns `{ completed, flagged, release }`.
  - `change_booking` (replaced, copy of the T-063 body): `complete` voids `proposed` AND `accepted` pickup proposals (L2).
  - `admin_reject_chef` (replaced, copy of the T-063 body): the cascade only cancels `requested` bookings whose `coalesce(expires_at, created_at + 72 h) > now()`; a stale one is left for the expiry sweep to mark `expired` (L1).
  - Grants re-applied (service role only). Lock order unchanged (chef then booking).
- TS: `src/lib/domain/cancellation.ts` (`freeTrialEffect`: `no_show_chef` now follows the cooked marker like `cancelled`, D-37), `src/lib/server/free-trial.ts` (reads the cooked marker for every event when the caller did not pass it; no event names added, so the A-16 single-source test still holds). No route code changed: `change_booking` already returns `cooked` and `followClaim` passes it.
- Docs: `docs/api-contract.md` v1.7, `docs/domain-rules.md`, `docs/data-model.md`.
- Tests: unit `bookingChanges.test.ts` (D-37), `free-trial.test.ts` (D-37; the "opposite outcome refused" check now uses `expired`); API `tests/api/booking-changes.test.ts` (rewrote the auto-completion test at the old line 336; added: D-36 flag, chef's-home auto-completion waits for pickup deadline, L2 void x2, D-37 x2, L1); RLS `tests/rls/booking-changes.test.ts` (SQL vs TS `pickupDeadline` and `completionDue`, across both daylight-saving changes, customer's home and chef's home).

## How to verify
- `npm run lint && npm run typecheck && npx prettier --check . && npm test` (all passed locally: 71 files, 1852 passed, 3 expected fails).
- API and RLS tests: CI only (no Docker). The migration was loaded after all earlier ones in PGlite (scratch, not committed) and checked: sweep flags once and completes the cooked booking, second sweep does nothing, `complete` voids an accepted pickup, the reject cascade skips a stale request.

## Known gaps or risks
- API and RLS tests unproven until CI.
- A booking already flagged `no_day_cooked` that later has its chef rejected keeps the `no_day_cooked` flag (one flag per booking, primary key); the reject notification still goes out only if a new flag is inserted. Cosmetic; WO-5 admin list should show every flag anyway.
- A flagged no-cooked-day booking has no way out except an admin (WO-5): the chef can still mark days cooked (past dates are allowed) and then complete, which is fine; cancel is refused with `nothing_left`. The sweep cannot complete it by itself afterwards unless a day is marked cooked.
- M3 (open flag should block chef actions) is T-064, not done here.

## Assumptions
1. "Flagged for the admin" = the existing `booking_flags` table plus a notification to both parties (neutral text, no names). No new status.
2. D-37 uses the same marker as D-26: any `cooked_at` on the booking, even if later days were not cooked.

## Open questions for Jimmy
- Q-1: Should the parties be told in the UI why a past, uncooked booking is "waiting for an admin"? (notification text exists; screen wording is Frontend's.)
- Q-2: When an admin resolves a `no_day_cooked` flag, what final status does the booking get (cancelled, no-show chef)? Belongs to WO-5.

## What the next agent needs (Frontend, T-070 and later)
- A booking can now stay `accepted` after its last visit date (no day cooked). Do not assume `accepted` means "upcoming": show something like "Waiting for a check" when every day is past and none has `cookedAt`. There is no field for the flag; derive it from days. (If the UI needs a field, ask the Planner for a contract addition.)
- Chef no-show now consumes the customer's trial when a day was cooked: any copy that says a chef no-show always gives the free booking back is wrong (`src/components/booking/BookingDetailView.tsx` trial text for `no_show_chef`, and `src/lib/booking/changes.ts:279`). Use `freeTrialEffect("no_show_chef", { anyDayCooked })` as `trialAfterCancel` does for cancel.
- Completed through the auto-sweep now needs a cooked day: the chef dashboard should prompt "mark cooked" for past days.
- New notification type `booking_flagged` is also sent for the no-cooked-day case (previously only for the chef-rejected case); the text is generic.
- A stale request is now `expired` (not `cancelled`/`system`) when its chef was rejected after the deadline.
