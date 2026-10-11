# Handoff: T-063 Booking changes API

From: backend  To: tester

## What changed
- Branch: `feature/T-063-booking-changes`. Pull request: see the PR titled "T-063: Booking changes API" (Closes #100).
- Contract: `docs/api-contract.md` v1.5 (section 7A "Booking changes"; error fields `reason` and `latest`; BookingDetail fields; N3/N5/open point 14 closed). Types: `src/lib/api/types.ts`.
- Migration (new, NOT pushed to hosted; the Planner runs `supabase db push` after merge): `supabase/migrations/20261011200000_booking_changes.sql`
  - columns: `bookings.completed_at, no_show_reported_at, no_show_day_number, pickup_missed_at`; `booking_days.cooked_at`
  - tables: `pickup_proposals` (parties + admin read), `booking_flags` (admin read); both RLS on, select-only for authenticated
  - functions (service role only, SECURITY INVOKER): `change_booking` (cancel, cooked, no_show, complete, pickup_propose, pickup_respond, pickup_missed), `sweep_booking_changes` (D-33 lazy auto-complete + claim-repair list), time helpers `booking_cancellation_timing`, `booking_pickup_end`, `booking_auto_complete_at`
  - replaced: `answer_booking` (chef row FOR SHARE first, re-checks `approved` and `chef_home_enabled`), `admin_reject_chef` (D-21 body + D-22 cascade, returns `cancelled` and `flagged` ids)
- Routes (new, `src/app/api/bookings/[id]/`): `cancel`, `no-show`, `complete`, `days/[dayNumber]/cooked`, `days/[dayNumber]/pickup/propose`, `days/[dayNumber]/pickup/respond`, `pickup/missed`.
- Server: `src/lib/server/booking-changes.ts` (new), `bookings.ts` (`sweepExpired` now also runs `sweep_booking_changes` and repairs claims for every finished status; accept maps `chef_home_not_enabled`), `booking-views.ts` (new detail fields, pickups read under RLS), `free-trial.ts` (`anyDayCooked`, `releaseCancelledClaims`), `admin-chefs.ts` (reject follow-up), `chef-application.ts` (N3 block), `src/lib/api/request.ts` (`readOptionalJsonObject`).
- Domain: `src/lib/domain/bookingChanges.ts` (new: body parsing, refusal texts, TS mirrors of the time rules), `cancellation.ts` (`freeTrialEffect(status, { anyDayCooked })`, D-26), `freeTrial.ts` (ctx passed through).
- Tests added/changed: unit `bookingChanges.test.ts`, `booking-changes-guards.test.ts`, `free-trial.test.ts` (cooked cases, fake db gained `not`/`limit`), `request.test.ts`; API `tests/api/booking-changes.test.ts` (new), `booking-helpers.ts` (route wrappers, `shiftDays`, `setEatBy`, `activeDates`), `bookings.test.ts` (days now carry `cookedAt`, `pickupDeadlineDate`, `pickups`); RLS `tests/rls/booking-changes.test.ts` (new), `visibility.test.ts` (two tables added to the snapshot).
- Docs: `docs/data-model.md`, `docs/lessons-learned.md` (lock order).

## How to verify
- `npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run build` (all passed locally; unit count in the PR).
- `npm run test:rls` and `npm run test:api` need the local Supabase stack (no Docker on the builder's Mac): CI only. The SQL was run in PGlite (scratch folder, not committed): 46 checks covering cancel (on_time, late, chef rules, stranger), cooked, no-show, complete, auto-complete sweep, report block, pickup flow, missed pickup, accept re-check, reject cascade and the timing boundary.
- Suggested Tester focus (section 10): cancel timing and D-26 (cooked before cancel consumes, before releases, second trial blocked), chef and customer no-show, missed pickup (propose, decline, re-propose, deadline, 0-day shelf life, missed), parallel cancels / cancel vs accept, reject cascade (cancelled, flagged, finished untouched, claims), N3, unauthorized access (stranger 404, admin 403, anonymous 401), contact details in a cancel reason.

## Known gaps or risks
- API and RLS tests were not run locally; the new API test file is long and unproven until CI.
- Expiry and auto-completion are lazy (no scheduler). WO-7: schedule `expire_stale_bookings(null)` and `sweep_booking_changes(null)`.
- The pickup flow has no "picked up" confirmation: the chef alone decides "pickup missed" after the deadline (same trust as no-show reports).
- N3 check is a read before the write (the chef is the only actor; accepting a chef's-home booking after an address change is already refused because the change switches chef's home off).

## Assumptions (not decided by Jimmy; most conservative choice, easy to change)
1. A chef may cancel only an `accepted` booking; a waiting request is declined (keeps the D-34 reason rule).
2. A cancel needs at least one visit that is not cooked and not past; otherwise 409.
3. A no-show may be reported from the visit date (no clock time exists); it ends the booking and frees future uncooked days (also for pickup missed, D-29).
4. D-33 "24 hours after the last day" = one calendar day after the end of the last visit date, Toronto time. For chef's-home bookings also after every day's pickup deadline.
5. "Visit done" needs every day cooked; an `open` or `reviewing` report blocks both manual and automatic completion.
6. A pickup can be proposed only for a cooked day, one live proposal per day, none after one was accepted; accepting a time already in the past is refused.
7. D-26 applies to a chef's cancellation too (consumes the customer's trial after a cooked day); chef no-show always releases (A-16).
8. Notifications are sent to the other party for every change, plus customers for the D-22 cascade (generic text, no names or addresses).
9. N3 decided as "block", not "notify and re-confirm".

## Open questions for Jimmy
- Q-A: Should a chef cancelling after a cooked day consume the customer's free trial (D-26 read literally) or release it?
- Q-B: How early may a no-show be reported (visit date from 00:00 is built)? A visit start time in the model would fix this.
- Q-C: Add a customer "I picked up my meals" confirmation so the chef cannot falsely mark "pickup missed"?
- Q-D: When a problem report is resolved by the admin, which final status does the booking get (WO-5)? Until then an `open` or `reviewing` report keeps it `accepted`.
- Q-E: Do customers of flagged (D-22) accepted bookings need anything beyond the neutral notification (refund, rebooking)?

## What the next agent needs
- T-045 (chef dashboard, missed-pickup UI): use `days[].cookedAt`, `pickupDeadlineDate`, `pickups`, `error.reason`, `error.latest`; call `cooked` per day, then `complete`; tell chefs the kitchen address is locked while a chef's-home booking is accepted (409 `kitchen_in_use`).
- T-043 / customer UI: cancel shows the `late` warning when day 1 is under 48 hours away; `cancelledBy: system` means the chef was removed; trial wording after cancel depends on cooked days.
- WO-5: admin list should show `booking_flags`; `findContactDetails` on chat; resolve reports; reviews rely on `status = completed`.
- WO-7: schedule the two sweep functions; `supabase db push` after merge.
- Test helpers: `shiftDays(bookingId, n)` simulates time; `setEatBy(bookingId, offset)`.
