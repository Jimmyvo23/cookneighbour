# T-035 Reviewer handoff

**Task:** T-035 Admin chef-queue API (PR #79)
**Verdict:** APPROVE on head b4bcc2c (review comment 6069585696; CI run 37847317578 green)
**Written by:** Planner, from the Reviewer's report (D-7)

## What was checked
- Admin gate: `requireAdmin()` first in every route (`getUser()` + `profiles.role`); service role only after; JWT metadata never read.
- Migration `20261010120000_admin_chef_decisions.sql`: three SECURITY INVOKER functions, `search_path ''`, EXECUTE for service_role only; locks chefs, then chef_private, and the sample dishes. Approve recomputes the 16 completeness items plus stored-file existence in the transaction and requires both MOCK checks still `verified` (closes T-031 R2). B1 kitchen stale check inside the transaction. Adds functions only, safe on hosted data.
- PATCH checks is one conditional UPDATE; strict cursor validation; signed URLs 300 s, own file names only, no-store, never logged; no hashes; logs carry only admin and chef ids.
- Contract v1.2 §6 and `src/lib/api/types.ts` match the code; tests strong (races, drift guards); scope within WO-3.

## Findings (none blocking)
1. LOW migration :133-134: rejecting a chef leaves `chef_home_enabled = true`; re-approval brings chef's home back if the kitchen did not change. No leak today (rejected chefs are not in search).
2. LOW, known (contract open points 12-13): kitchen review can enable chef's home for a pending or rejected chef (:186-199); PATCH checks can set an approved chef's check to failed/not_started without changing status (`admin-chefs.ts:300-320`). Raised with Jimmy as an open question.
3. LOW: SQL `btrim` vs TS `trim()` (:65-66); DB error text in logged messages (`admin-chefs.ts:77,132,201,218,316`). Neither reachable or sensitive today.
4. INFO: approve's `missing` can name an item the chef's own list does not (vanished file); T-036 UI should explain it.
5. INFO: `T-035-tester.md` says "NOT committed" but the Planner committed it in b4bcc2c (D-7).

## Follow-ups
- T-036: MOCK badge on every check status incl. police; server guard on `/admin/*`; fix `src/app/chef/layout.tsx` comment; refetch signed URLs after ~5 min and show "not available" for a listed file without a URL; send exactly the reviewed paths and address (`null` when none); on 409 ask to reload and focus the error; `Content-Type: application/json` on every write incl. approve; reject reason and kitchen note as plain text; mock adapter admin routes.
- WO-4: chef's-home search and booking require `status = 'approved'` AND `chef_home_enabled`; decide what happens to future bookings when an approved chef is rejected.
- WO-5: notification read API.
- Planner: `npx supabase db push` after merge; note it in PLAN.md.
