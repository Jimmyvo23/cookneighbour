APPROVE (Reviewer, T-071 backend part, round 2, head 4de0ac0)

Round 2 (`git diff 3f96518 4de0ac0`) changes only the refusal text, the contract, the grant block in the migration and the handoffs. No SQL logic, route, server or test code changed, so the round 1 checks still hold: RLS, the party and role checks, one locked transaction, the race, no regressions in `change_booking`, and the migration is safe for hosted.

## Round 1 findings
- MED-1, fixed with option (a). `src/lib/domain/bookingChanges.ts:129` now reads "The customer confirmed the pickup for every visit whose pickup deadline has passed, so there is no missed pickup to report now." That is exactly what the SQL means (migration lines 195-203), including the mixed case pinned by `tests/api/pickup-confirm-gaps.test.ts:151`. The missed row in the contract (`docs/api-contract.md:461`) now explains that a day still inside its window, or not cooked yet, can still be reported later, and that a UI must not hide the action for good. That is honest.
- LOW-1, fixed. The check order in `docs/api-contract.md:460` now matches the SQL: range 404, `expired`, `frozen`, `wrong_status`, `not_chef_home`, day not in the booking 404, cancelled day, `day_not_cooked`.
- LOW-2, fixed. The revoke/grant block is restated at the end of `supabase/migrations/20261018100000_pickup_confirm.sql`. It changes no privileges and is safe to run on hosted.
- NIT-1, fixed. The status line starts "v1.12 (T-071), covers", and the v1.12 summary lists `picked_up`.
- INFO-1, closed. The Planner says D-73 was only the go-ahead for T-071 and did not confirm A-26..A-29, so the contract's "not yet confirmed" sentence is right.
- INFO-3, addressed. The contract now marks voiding that day's proposals as the builder's decision, to be confirmed together with A-26..A-29.

## Checks on 4de0ac0
- Local: lint and typecheck clean, prettier clean, `npm test` 85 files, 2040 passed, 3 expected fail.
- CI: `ci` green on 4de0ac0 (run 38959534702).

## Remaining (not blocking)
- INFO: auto-completion still ignores `picked_up_at`. This is the follow-up named in the handoff.
- INFO: the hosted `db push` of this migration still needs Jimmy after the merge (lessons-learned section 5).
- If the Tester adds a commit after this review, the merge needs green CI on that new head. A tests-only commit does not need another review from me.

Handoffs reviewed: `.team/handoffs/T-071-backend.md` (with the Round 2 section), `.team/handoffs/T-071-tester-backend.md`.

