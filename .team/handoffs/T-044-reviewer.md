# T-044 Reviewer handoff (saved by the Planner from the Reviewer's report)

PR #110, head reviewed a76b1c2. Verdict: APPROVE (PR comment, D-42). Reviewer ran lint, typecheck, unit tests (1709 pass, 3 expected fails); `ci` green on a76b1c2.

## Checked and OK

- Receipts table RLS: parties and admin read; no client insert/update/delete.
- Storage bucket private, insert-only; upload only while booking accepted or completed.
- Signed links under the caller's session; superseded receipts get no link; `file_path` never returned.
- `submit_receipt` / `answer_receipt` SECURITY INVOKER, `search_path = ''`, service role only. `booking_accepts_receipts` SECURITY DEFINER, `search_path = ''`, in the privilege snapshot.
- Races: booking row locked first (one lock order); `answer_receipt` one conditional update; partial unique index backstop; `path_used` leaves the old receipt untouched.
- Mismatch flag uses the immutable estimate snapshot. Paths: shared `isSafeStoragePath` + own folder + extension + object exists + register once.
- No markup; reimbursement MOCK (`mock: true, collected: false`), amount only after confirm. Notifications carry no amount, address, phone or dispute note.
- Contract v1.6 §7B matches code and types. Migration additive; no existing rows at risk. Scope matches WO-4b and Jimmy's 2026-10-14 decisions.

## Findings

1. LOW: `booking_accepts_receipts` did not check `grocery_option = 'chef_shops'`, so an option A chef could upload unregistrable files. *(Planner: fixed in round 2, same unpushed migration.)*
2. LOW: `src/lib/server/groceries.ts` comment said the body is not read before the 404 check; routes parse JSON first. *(Planner: comment fixed in round 2.)*
3. LOW (info): unregistered or refused uploads stay in the bucket; cleanup deletes data, needs Jimmy.
4. INFO: migration needs `npx supabase db push` after merge (ask Jimmy).
5. INFO for T-045: MOCK badge wherever reimbursement appears; show `differenceCents` and `toleranceCents` on flagged receipts.

## Round 2

Head 24eb41b: APPROVE. LOW-1 fixed (`and b.grocery_option = 'chef_shops'`; SECURITY DEFINER, `search_path = ''`, grants unchanged and safe). LOW-2 comment fixed. Tests cover the new rule both ways. Merged 42d1aec on green `ci` (head 32a1161, after update-branch).
