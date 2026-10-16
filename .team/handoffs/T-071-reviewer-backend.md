REQUEST CHANGES (Reviewer, T-071 backend part, head 3f96518)

One small fix to make first: the `pickup_confirmed` refusal text makes a promise the code doesn't keep (lessons-learned: "False promises in the UI"). Everything else is sound and can be merged once that fix is in and CI is green.

## What I checked
- `change_booking` in `20261018100000_pickup_confirm.sql` diffed against the `20261017100000_flag_freeze.sql` body. The only changes are the new action in the allow-list, `pickup_confirm` in the customer-only role line, `picked_up_at is null` in `pickup_missed` plus the new `pickup_confirmed` branch, the new `pickup_confirm` block, and the `picked_up` refusal in `pickup_propose`. Cancel, cooked, no_show, complete (with the D-57 flag resolve), the expiry check, the frozen check and pickup_respond are byte-identical. Nothing has regressed.
- Security and RLS. The route checks `requireCustomer` (401/403), then `requireJson`, then `requireOwn(..., "customer")` (404 for a stranger or a missing booking), then the SQL party and role check as a second line. `booking_days` still has only SELECT policies (party, admin), so `picked_up_at` cannot be written from a browser; the new RLS test proves it for customer, chef, admin and a stranger. `BookingDetail` is loaded with the user-scoped client (`caller.supabase`), and strangers never reach it. `picked_up_at` is not sensitive.
- Check-then-act and the race. Confirm and missed both run under `select ... from bookings for update` (line 51), and confirm then locks the day row (line 224). The lock order is unchanged. The write `where picked_up_at is null` together with `if found` gives exactly one notification. The race test accepts either winner and checks that the end state is consistent.
- Migration safety for hosted. Only an additive nullable column plus `create or replace` with the same signature and the same (invoker) attributes. `CREATE OR REPLACE` keeps existing grants, so service_role-only EXECUTE stays. Nothing is destructive.
- Local checks on 3f96518: lint, typecheck and prettier clean; `npm test` 85 files, 2040 passed, 3 expected fail. CI was green on 7e0823c (run 38955114919). The run on 3f96518 (handoff only) was still in progress when I looked.
- Plan compliance. In scope: no UI, types or mocks touched, as the handoff says. The `picked_up` reason on propose is a sensible small addition and is in the contract.

## Findings

MED-1 `src/lib/domain/bookingChanges.ts:129` with `supabase/migrations/20261018100000_pickup_confirm.sql:195-203`. This is Tester finding 2. `pickup_confirmed` comes back whenever no unconfirmed cooked day is past its deadline and at least one confirmed day is. That includes the case where another day is cooked but still inside its window, or not cooked yet (pinned by `tests/api/pickup-confirm-gaps.test.ts:151`). The chef then reads "...so the pickup cannot be marked as missed." That is not true: once the other day's deadline passes, missed works. A chef UI built on this reason or text could also hide the button for good. Fix one of these two ways:
  (a) Text only (smallest): something like "The customer confirmed the pickup for every visit whose eat-by date has passed, so there is no missed pickup to report now." Also add the same nuance to the missed row in the contract (`docs/api-contract.md:461`).
  (b) SQL: return `pickup_window_open` when an active cooked day that is not yet confirmed still exists (or an active day is not cooked yet), and `pickup_confirmed` only when no missed pickup can happen any more. Then update the test at gaps:151 and the contract.
  Either is fine. (a) needs no new migration logic.

LOW-1 `docs/api-contract.md:460`. This is Tester finding 1. The listed order puts "`dayNumber` 1..3 and in the booking (404)" before `frozen`/status/`not_chef_home`. The 1..3 range check (`dayOr404`) is indeed first, but "in the booking" is checked in SQL after those (migration lines 71, 111, 179, then 224-225, which the migration header at lines 7-9 states correctly). One more gap: a still-`requested` booking past its expiry gives `expired` before `frozen`. Change the contract wording to match the SQL. No data risk.

LOW-2 `supabase/migrations/20261018100000_pickup_confirm.sql` (end of file). Every earlier replacement of `change_booking` ends with `revoke execute ... from public, anon, authenticated; grant execute ... to service_role;`. This one doesn't. That's not wrong, because `CREATE OR REPLACE` keeps the grants, but restating the block keeps the "grants are explicit in each migration" pattern and protects against a drop/recreate later. Optional; it can be added in the same round as MED-1.

NIT-1 `docs/api-contract.md:3`. "Status: v1.12 (T-071), v1.11 (T-064), covers ..." now lists two versions at the start. Make it "Status: v1.12 (T-071), covers ...". The v1.12 summary later in that line doesn't mention the new `picked_up` propose reason.

INFO-1 `docs/api-contract.md:465` says "Jimmy has not yet confirmed these Planner assumptions" (A-26..A-29). The brief cites Jimmy D-73. I don't have the text of D-73. If D-73 confirmed A-26..A-29, this sentence should say so; if D-73 only approved the Work Order, the text is honest as it is. Planner to check.

INFO-2. Confirm is refused with `wrong_status` once the booking is `completed`, whether by the chef or by the sweep's auto-completion after every deadline. This matches A-27 ("while the booking is accepted") and the contract. Auto-completion ignoring `picked_up_at` is the follow-up the handoff already names.

INFO-3. The voiding of that day's open or agreed proposals on confirm is the builder's own decision, written into the contract. It's reasonable, but the Planner should record it next to A-26..A-29 for Jimmy.

Handoffs reviewed: `.team/handoffs/T-071-backend.md`, `.team/handoffs/T-071-tester-backend.md`.

