# Work Order WO-5d: Reviews, report button and admin lists UI

Tasks: T-049 (frontend). Branch `feature/T-049-reviews-reports-ui`, worktree `../CookNeighbour-wt-T049`. It is based on the T-048 commit `337a44b`, which holds contract section 7D (v1.16). It rebases onto `main` once T-048 merges and opens its PR only after that.

Runs beside WO-5c (backend). Frontend's only task (one task per agent, Jimmy 2026-10-20).

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| frontend | T-049 | Mobile first, against contract 7D, using a MOCK adapter in a new file `src/lib/mocks/mock-reviews-reports.ts` (Frontend owns it). Booking pages (customer and chef): a review form after completion (1 to 5 stars, optional comment, a 14-day notice, final once posted, the other side's review shown where allowed); a "Report a problem" button on every booking with a form and the caller's own report status. Public chef page: the review list. Admin: lists of bookings, reports and free-trial blocks; report resolve or dismiss with the final status and note; flag resolve; a read-only chat view. Unit tests, mock e2e at 375 px with axe. | L | The contract may change in T-048 review |
| tester | T-049 checks | Each booking status (review allowed, window closed, already reviewed), the report rules (one open, own status only, nothing shown to the other party), admin flows and errors, keyboard and screen-reader behaviour, 375 px with axe. | M | Contract drift |
| reviewer | T-049 review | Privacy (chef review of customer and reports never shown to the wrong person), honest texts (MOCK labels, "final once posted"), accessibility, contract compliance. | M | Low |

## Rules it builds on
D-54, D-57, D-67, and Jimmy's 2026-10-20 choices in WO-5c (14 days, final once posted, chef review of customer is for that customer and the admin only, report is for admin and reporter only, one open report).

## Left out
Backend changes (T-048 owns `src/lib/api/types.ts` and the routes), notifications UI, the T-050 end-to-end demo path.

## Decision
Decide ids `WO-5d-frontend`, `WO-5d-tester`, `WO-5d-reviewer`.
