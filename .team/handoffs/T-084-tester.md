# Handoff: T-084 Tester

From: tester  To: reviewer

## Result: PASS
Final head 1c9f34a (all temporary commits reverted with `git revert`, no force-push). Final CI run 39268299623: success. Diff vs main: `.github/workflows/ci.yml` and `.team/handoffs/T-084-backend.md` only.

## Gate logic (read of ci.yml)
Job id and name `ci`; `needs: [checks, supabase, e2e-mock]`; `if: always()`; fails on any result not `success` (so failure, cancelled and skipped all fail). No checkout, permissions `contents: read`, concurrency kept, 25-minute limit kept on three heavy jobs.

## Gate proofs (one failing `exit 1` step as first step of one job; each run waited to the end)
| Proof | Run | checks | supabase | e2e-mock | ci |
|---|---|---|---|---|---|
| checks | 39261388813 | failure | success | success | failure |
| supabase | 39265035703 | success | failure | success | failure |
| e2e-mock | 39266516069 | success | success | failure | failure |
Note: my first supabase attempt (run 39263562047) was not attributable because a silent failed revert left the checks failure in; ci was red as expected. I redid it cleanly (the row above). Skipped/cancelled paths were read in the logic, not exercised.

## Test counts (main run 39090146559 at 9f789c7 vs PR green run 39259625348)
| Suite | main | PR |
|---|---|---|
| Unit (vitest) | 92 files, 2127 passed, 3 expected fail | same |
| RLS | 20 files, 228 passed | same |
| API | 35 files, 695 passed | same |
| E2E real routes | 43 passed | 43 passed |
| E2E mock | 270 passed | 270 passed |
Nothing dropped.

## Timings
- Main (single job) 21m29s.
- PR run 39259625348: 11m8s (checks 2m18s, e2e-mock 9m03s, supabase 10m57s, gate 4s).
- PR final run 39268299623: 13m46s (checks ~2m, e2e-mock ~9m, supabase ~13m, gate 4s). Slower runner that day; still well under 25 min per job and about 10 min better than the 21 to 24.5 min before.

## Findings
- None blocking. Low: `supabase` is the long pole (11 to 13 min); headroom under the 25-minute job limit is about 12 min.
- Low: concurrency cancels an in-progress PR run on a new push, so the handoff-commit run was cancelled (expected).
