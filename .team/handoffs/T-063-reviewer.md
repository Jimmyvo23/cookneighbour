# Handoff: T-063 reviewer (post-merge)

From: reviewer  To: planner

PR #101 was merged as c3677e8 on Jimmy's approval, because the auto-mode permission check blocked the Reviewer agent twice ("self-approval"). This is the post-merge review, posted as a comment: https://github.com/Jimmyvo23/cookneighbour/pull/101#issuecomment-6111899151

## Verdict
Follow-up needed, no revert. Security (SECURITY INVOKER, empty search_path, service-role-only grants), RLS on `pickup_proposals` and `booking_flags`, lock order (chef row then booking), privacy unlock rules, MOCK labels and scope are sound. All carry-ins built (D-22, D-26, D-29, D-33, D-34, T-042 finding 2, N3).

Checks on main @ c3677e8: lint passes; unit 1550 passed, 3 expected fails; CI green. Local typecheck fails only because `leaflet` and `@axe-core/playwright` are missing from local node_modules (`npm ci` fixes it).

## Findings
### MEDIUM
- M1 `supabase/migrations/20261011200000_booking_changes.sql:392-399` vs `:260`: auto-completion completes a booking with zero cooked days (consumes the trial, opens reviews); manual completion needs every day cooked. Not a contradiction of D-33 as written; question for Jimmy (PLAN Q-29). The case is asserted by `tests/api/booking-changes.test.ts:336-343` (the Tester handoff said it was not covered).
- M2 migration `:234-255`, `src/lib/domain/cancellation.ts:110`: a chef no-show after a cooked day releases the trial (A-16), while a cancel would consume it (D-26). Question for Jimmy (Q-30, linked to Q-25).
- M3 migration `:392-399`, `:158-167`: D-22 flagged bookings continue with no admin step; a rejected chef can still mark cooked, complete, report a customer no-show or mark pickup missed, and the sweep auto-completes them. Gap, not a contradiction. Fix: an open flag blocks completion and the rejected chef's actions (T-064, Q-28).
- M4 `supabase/migrations/20261007221002_core_rls.sql:74,90` with `src/lib/server/chef-application.ts:381-410`: `get_booking_contact` returns the chef's current kitchen address and phone forever for completed and no-show bookings, so past customers see a new address after N3 allows the change. Fix: snapshot the address at acceptance (T-065); re-lock window is Q-12.

### LOW
- L1 migration `:516-521`: reject cascade marks already-stale requests "cancelled" instead of "expired". Fix: filter on `coalesce(expires_at, created_at + interval '72 hours') > now()` or sweep expiry first (T-066).
- L2 migration `:259-273`: completion during an open pickup window; completion voids only `proposed` proposals, not `accepted` (cancel and no-show void both, `:202`, `:249`). Fix: void both (T-066).
- L3 migration `:282-306`: "pickup missed" needs no proof the meals were not collected; can block the customer's review (Q-26).
- L4 `chef-application.ts:381-410`: N3 is read-then-write; a concurrent accept and address change can collide. Fix with M4 in one locked function (T-065).
- L5: no API test for chef's-home auto-completion waiting for every pickup deadline (migration `:109-116`); no SQL-vs-TS test for `completionDue` / `pickupDeadline` (only cancellation timing, `tests/rls/booking-changes.test.ts:266`) (T-066).
- L6: street addresses in cancel reasons are not caught (Q-23).

## Builder assumptions 1-9
Consistent with recorded decisions: 1, 2, 5, 6, 8, 9. Jimmy to confirm: 4. Need Jimmy: 3 (Q-25), 7 (Q-24). None conflicts with a recorded decision.

## Questions for Jimmy
Q-24..Q-30 and Q-12 in PLAN.md section 6.
