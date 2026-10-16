# Handoff: T-071 Pickup confirm (backend part), Tester

From: tester  To: reviewer

## Result: PASS

## What I checked
- Diffed `20261018100000_pickup_confirm.sql` against `change_booking` in `20261017100000_flag_freeze.sql`: only the intended changes (new action, role line, `pickup_missed` ignores confirmed days plus `pickup_confirmed` reason, `pickup_propose` `picked_up` refusal). Cancel, cooked, no_show, complete (incl. D-57 flag resolve), frozen check, pickup_respond are identical. The new migration contains only `change_booking`, so the sweep, `admin_reject_chef`, `answer_booking`, `submit_receipt` are untouched.
- Race: confirm and missed both start with `select ... from bookings for update`, so they serialize; the loser re-reads (confirm sees `no_show_customer` -> `wrong_status`; missed sees the confirmed day -> `pickup_confirmed`). Day row lock is taken after the booking lock (same order as the other pickup actions).
- Added `tests/api/pickup-confirm-gaps.test.ts` (10 tests, own chefs/customers, id-scoped asserts, no literal dates): 400 on bad content type, 403 admin/chef, 401, proposals voided only for the confirmed day, another day still proposable, two parallel confirms give one notification, missed with mixed confirmed/unconfirmed days, missed `pickup_confirmed` and `pickup_window_open`, confirm after no_show_customer/no_show_chef is `wrong_status`, order (`day_not_cooked`, `not_chef_home`, `wrong_status`), confirm then complete keeps `pickedUpAt`.
- Existing builder tests already cover: 401/403/404 party/day, idempotent repeat, `picked_up` on propose, frozen, inactive day, race, RLS read/denied-write of `picked_up_at`.

## Results
- Local: lint, typecheck, prettier clean; `npm test` 85 files, 2040 passed, 3 expected fail.
- CI (API and RLS tests run there): green on my head, run 38955114919.

## Findings (not blocking)
1. Contract text for the check order says "dayNumber 1..3 and in the booking (404)" comes before `frozen`/`wrong_status`/`not_chef_home`. The SQL looks up the day after those. Only the combination "valid-range day missing from the booking AND booking frozen/not accepted/customer_home" differs (409 instead of 404). Same as the existing `pickup_propose`. Fix the wording in the contract or ignore; no data risk.
2. `pickup_confirmed` is also returned when the only unconfirmed cooked day is still inside its window while another day is confirmed and past its deadline. Matches the contract wording; the UI should not assume it means "all days confirmed".
3. Not tested (needs the browser/SQL harness, noted for the Reviewer): the SQL sweep with `picked_up_at` set (unchanged by this PR; auto-complete still waits for every deadline, a known follow-up).
