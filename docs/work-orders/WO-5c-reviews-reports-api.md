# Work Order WO-5c: Reviews, reports and admin lists API

Tasks: T-048 (backend). Branch `feature/T-048-reviews-reports-api`, worktree `../CookNeighbour-wt-T048`. T-049 (UI) follows in its own Work Order once contract section 7D is merged.

Runs beside WO-T087 (frontend, separate files). One task per agent (Jimmy, 2026-10-20).

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| backend | T-048 | Contract section 7D first (v1.16). Then the routes: `POST/GET` reviews (completed bookings only; within 14 days of completion, configurable; one per author per booking; idempotent retry); `POST` report (any party, any status; one open report per reporter per booking); admin `GET` bookings, reports and free-trial blocks (paged); admin resolve report or `no_day_cooked` flag: picks the final status with a note, free trial follows that status (D-54, D-57), sets `resolved_at` and unfreezes (D-67), as one locked database function; admin chat read route. RLS window check in a migration. Unit, route and RLS tests. | L | Resolution touches booking status, free trial and flags together |
| tester | T-048 checks | Review window edges (day 14 vs day 15), non-completed bookings, a second review, chef review hidden from the public, report by a non-party, one-open-report rule, each D-54 final status and its free-trial effect, unfreeze, admin-only routes (401/403 for everyone else), RLS on the real stack. | M | Time-based tests |
| reviewer | T-048 review | Privacy (chef reviews of customers visible only to the customer and admin; reports never shown to the other party), atomic resolution, plan compliance with D-54/D-57/D-67, contract matches code, no logged personal data. | M | Low |

## Decisions already made (2026-10-20)
- Reviews may be written up to **14 days** after completion (configurable constant). Jimmy chose "14 days (Recommended)".
- A chef's review of a customer is visible to **that customer and the admin only**. Jimmy chose "Customer + admin only (Recommended)". The existing RLS already matches this.

- A posted review is **final**: no edit, no delete. Jimmy chose "Final once posted (Recommended)" ("A mistake goes through report-a-problem to the admin").
- A problem report is seen by the **admin only**. Jimmy chose "No, admin only (Recommended)": the reporter sees their report's status; the other party sees only an admin decision when it changes the booking status.
- **One open report** (open or reviewing) per reporter per booking. Jimmy chose "One open at a time (Recommended)": a second report waits until the first is resolved or dismissed.
- Approved: Jimmy chose "Approve both (Recommended)" for WO-5c and WO-T087, all agent slots.

## Builder choices (to be confirmed by Jimmy afterwards)
Which time the admin lists show for an upgraded flag (T-064 INFO-1); the idempotency key shape; paging size.

## Left out
The UI (T-049), the notification read route unless it is needed for tests, the sweep re-lock cost (T-064 LOW-2, fine at prototype scale), a hosted `db push` (the Planner asks Jimmy after merge).

## Decision
Decide ids `WO-5c-backend`, `WO-5c-tester`, `WO-5c-reviewer`.
