# T-038 Reviewer handoff

**Task:** T-038 Free-trial rules (PR #87)
**Verdict:** APPROVE on head 8f18e58 (comment 6094510897; CI run 38025487015 green)
**Written by:** Planner, from the Reviewer's report (D-7)

## Confirmed
- Eligibility: a held or consumed claim with the same customer, phone hash or address hash blocks; a released claim never does.
- A-16 outcomes come only from `freeTrialEffect`; no copy of the table.
- Hold is one INSERT decided by the three partial unique indexes plus the unique `booking_id`; state change is one conditional UPDATE with a re-read after a lost race.
- Privacy: one generic customer message; `free_trial_blocks` has no hash, phone or address column and is admin-only; hashes built server-side from stored data with the pepper; service role only after id, profile, role, ownership and status checks.
- Bad stored data gives a clean 409, never a 500. The in-memory test client checks the same constraints in the same order as Postgres. No routes, migration or UI.

## Findings (none blocking)
1. MEDIUM, must be fixed in T-042: `holdFreeTrial` (`src/lib/server/free-trial.ts:198-221`) reads the booking status, then inserts the claim separately. If the booking is declined or cancelled in between and that route's `applyFreeTrialEvent` runs first (it finds no claim, `:286`), the claim stays "held" on a finished booking forever, blocking the customer, phone and address. Not reachable today (no route changes booking status). T-042: create booking and claim in one SQL function or transaction, or lock the booking row while holding; consider an admin release/repair path.
2. LOW: `applyFreeTrialEvent` (`:271`) does not check the caller or ownership by design. Contract §11A should say only a route that has authorized and saved the status change may call it, with the event equal to the new stored status or "expired".
3. LOW: §11A should list 409 `INVALID_STATE` when holding a booking whose claim was already released or consumed (`:239`), and 403 for an admin like a chef.
4. LOW, later: a customer can read their own claim hashes (`core_rls.sql:421`); nothing new, since `profile_private_select_own` (`:231`) already exposes the same hashes. Fix both with column-level grants in one later migration.
5. INFO: cancelled after day 1 releases the trial (Q-22); block log has no size limit (T-042 rate-limit or group the admin list).
6. INFO `free-trial.ts:309-311`: "held" after a lost race returns 409; unreachable with current writes.

## Follow-ups for T-042
- Findings 1–3; tester findings 1, 2 and 5 (two writes).
- Set `bookings.is_free_trial` only when the hold succeeds.
- Call `applyFreeTrialEvent` on every status change and when a request expires.
