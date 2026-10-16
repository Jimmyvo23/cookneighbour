APPROVE

Reviewer verdict for T-064 (flagged bookings freeze), PR #134, head cf7a43c. `ci` is green on cf7a43c (run 38789232728, 21m19s). I re-ran the local checks on that head: lint, typecheck and prettier are clean, and `npm test` has 1987 passing and 3 expected fails (80 files). I read `.team/handoffs/T-064-backend.md` and `.team/handoffs/T-064-tester.md` (Tester PASS, INFO only).

## What I checked

- **No applied migration was edited.** The only SQL change is the new file `20261017100000_flag_freeze.sql`. I compared each replaced function with its latest earlier version (`change_booking`, `sweep_booking_changes` and `admin_reject_chef` from 20261014150000; `answer_booking` from 20261016100000; `submit_receipt` and `booking_accepts_receipts` from 20261014100000). The only differences are the marked T-064 changes. T-074 N1 is done with `comment on function`, not by editing 20261016100000.
- **D-53 (freeze).** `change_booking` checks `booking_is_frozen` after the party check, the wrong-side check and the expiry check, and before any status logic, so a stranger still gets not_found. `submit_receipt` and `booking_accepts_receipts` refuse a frozen booking. The sweep skips frozen bookings.
- **D-65 (customer actions refused).** The freeze check covers every action, so the customer's cancel, no-show and pickup proposal are refused. The mock adapter does the same: `changeRoute` covers every case and `cancelRoute` returns 409 frozen.
- **D-66 (receipt answers allowed).** `answer_receipt` was not changed. The mock still allows confirm and dispute. The Tester covered this at DB, API and mock level.
- **D-67 (nothing unfreezes).** Nothing sets `resolved_at` on a `chef_rejected` flag. The only writer is D-57 completion, and it only touches `no_day_cooked` flags.
- **D-68 (reject upgrades the flag).** `admin_reject_chef` uses `on conflict ... do update set reason = 'chef_rejected' where reason = 'no_day_cooked' and resolved_at is null`, and the customer gets the `booking_flagged` notice. Tested at RLS and route level.
- **D-57 (no_day_cooked).** A `no_day_cooked` flag does not freeze. Completion resolves it, both manually (`change_booking`) and automatically (the sweep).
- **Lock order.** It stays chef, then chef_private, then bookings by id. `admin_reject_chef` locks the accepted bookings with `order by id for update` (LockRows sits above Sort, so locks are taken in id order). The sweep locks due bookings one at a time in id order and re-checks in new statements, which see a flag committed while it waited (READ COMMITTED, volatile plpgsql). `change_booking` locks a single booking and no chef row, so there is no cycle. The upsert's re-check (EvalPlanQual on `status = 'accepted'`) means a booking that completed first is not flagged. LOW-2 is satisfied.
- **Security.** `booking_is_frozen` is not SECURITY DEFINER, has `search_path = ''`, and only service_role can execute it. `get_booking_frozen` is SECURITY DEFINER with `search_path = ''`. Execute is revoked from public and anon and granted to authenticated. It returns null to anyone who is not a party (admin included), and it is in the `visibility.test.ts` privilege snapshot. The `booking_flags` policy was not changed, so the table stays admin-only (RLS test at `tests/rls/flag-freeze.test.ts:364`). `loadBookingDetail` calls the RPC with the caller's own client (`caller.supabase`), so `auth.uid()` is the real user.
- **Privacy.** `frozen` is a plain boolean. The refusal text in `CHANGE_REFUSALS.frozen` and `RECEIPT_REFUSALS.frozen` is neutral and does not say why, and an API test checks this.
- **Mocks.** No money moves and the MOCK note is kept. There is no refund or rebooking flow, which matches D-53.
- **Scope.** This matches the T-064 row in PLAN.md and WO-4b. The only file touched outside backend is one test fixture (`BookingDetailView.test.tsx`, adding `frozen: false`). No UI was added; the notice is T-073's freeze item.
- **Follow-ups.** T-066 LOW-2 is done (flags are inserted and locked in id order in the sweep and in the reject). T-066 NIT-1 is done (`src/lib/server/bookings.ts` comment). T-074 L1 is done (`answer_booking` uses `coalesce(btrim(x), '') = ''`, with RLS tests for an empty and a spaces-only line and city). T-074 N1 is done.

## Findings (none blocking)

- **LOW-1 (docs and comments still call D-65 a question).** These places still say "INTERIM (question for Jimmy)" or "interim" for the customer's cancel, no-show and pickup refusal, and none of them cite D-65 to D-68:
  - `supabase/migrations/20261017100000_flag_freeze.sql:13`
  - `docs/api-contract.md:464` (the "Frozen bookings" bullet)
  - `docs/domain-rules.md:44`
  - the `cancelRoute` comment in `src/lib/mocks/mock-bookings.ts` ("D-53, interim")

  The behaviour matches D-65, D-66, D-67 and D-68 exactly. Only the wording is out of date. The migration comment can only be fixed **before** the hosted `db push`, because after that the file is applied and frozen. Suggest one small doc commit on this branch before merge. Otherwise the Planner's notes PR fixes the contract and domain rules, and the migration header keeps the stale word.
- **LOW-2 (sweep takes locks on every lazy read).** `20261017100000_flag_freeze.sql:336-345`: the sweep now takes `FOR UPDATE` on every due accepted booking in scope each time it runs lazily (list, detail, every change). Frozen bookings and open `no_day_cooked` bookings stay accepted and due until T-048, so they are re-locked on every call. This cannot deadlock (id order) and is harmless at prototype scale, but it serialises the two parties' concurrent requests on those rows. Optional fix (here or WO-7): also filter the loop query by "a cooked day exists and not frozen", then re-check under the lock as now.
- **INFO-1 (T-048: flag date).** `admin_reject_chef` (line 463): when the flag is upgraded it keeps the old `created_at`, so an admin queue would show when the `no_day_cooked` flag was raised, not when the chef was rejected. T-048 may want an `updated_at` or a reset.
- **INFO-2 (T-048: re-rejection).** After an admin resolves a `chef_rejected` flag (T-048), a later reject of the same chef does not reopen it, because the upsert only updates open `no_day_cooked` rows. T-048 should decide whether that is right.
- **INFO-3 (existing notification text).** The customer's `booking_flagged` notification ("The chef's account changed...") is existing T-063 text that the upgrade path now reuses. The freeze notice and refusal text say nothing about the reason.
- **INFO-4 (no e2e for the hook).** No mock e2e uses `hooks.frozenSeeded` yet (the Tester noted this). The T-073 freeze UI item should add one.

## After merge

Jimmy runs `npx supabase db push --linked` for `20261017100000_flag_freeze.sql` and checks it with `npx supabase migration list --linked`.
