# Work Order WO-T084: CI time limit

Tasks: T-084 (Jimmy chose it 2026-10-19, D-88). Approved by Jimmy as written 2026-10-19 (D-89): `WO-T084-backend`, `WO-T084-tester`, `WO-T084-reviewer`.

## What the Planner measured (last 4 `ci` runs on `main`/PRs, 2026-10-17)

| Step | Time |
|---|---|
| Playwright e2e (mock mode) | 7.5 to 9 min |
| API route tests | 6.5 to 8.5 min |
| Playwright e2e (real routes) | about 2 min |
| Start Supabase + RLS tests + `npm test` + build and the rest | about 4 to 5 min |
| **Whole job** | **21 to 24.5 min, limit 25** (run 39081531834 was cancelled) |

Everything runs one after another in one job. The mock e2e needs no Supabase at all, yet it waits for all the Supabase steps to finish first.

## Plan per agent

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| backend | T-084 split the CI job | Branch `feature/T-084-ci-time`, file `.github/workflows/ci.yml` only. Split the one job into three that run at the same time: `checks` (lint, typecheck, prettier, unit, build), `supabase` (RLS, API, seed, real-route e2e) and `e2e-mock`. Add a small final job still named **`ci`** that waits for all three and fails unless all three succeeded (`if: always()`), so branch protection needs no change. Keep the 25-minute limit per job. Upload the Playwright report from each e2e job on failure. Record before and after times in the handoff. No test code changes. | S | A skipped job can count as "passed" for a required check; the `if: always()` final job prevents this |
| tester | T-084 checks | Prove the gate still blocks: push a temporary failing commit in each of the three jobs in turn and confirm `ci` goes red each time, then remove it. Confirm every test count (unit, RLS, API, real e2e, mock e2e) matches the last green `main` run, so nothing was dropped. Report wall time over two green runs. | S | Three extra CI rounds (about 15 min each) |
| reviewer | T-084 review | Check the workflow: job names, `needs`, the final `ci` job logic, no secrets, permissions still `contents: read`, concurrency kept, reasons written in comments. | S | Low |

**Expected result:** wall time drops from about 23 minutes to about 15 (the `supabase` job becomes the longest), with no test removed and no limit raised.

**Builder change from the board:** the board lists Tester as owner. The Planner recommends Backend builds and Tester checks, so the Builder → Tester → Reviewer chain stays intact (lessons-learned: keep Builder → Tester → Reviewer on every task).

## Recommendation

Approve all three. Effort S. Runner minutes go up a little (three `npm ci` installs instead of one), but this is a public repo, so GitHub Actions minutes are free.

## Left out

- Running the mock e2e on a production build (`next start`) instead of the dev server. It may be faster, but some tests may depend on dev-mode behaviour (React StrictMode). Separate follow-up if the split is not enough.
- Running API test files in parallel (`fileParallelism: false` is there because the files share one database).
- Splitting Playwright across several machines (sharding), paid runners, and raising the 25-minute limit.

## Decision

Ask Jimmy per agent: Approve, Reject or Approve with changes. Decide ids `WO-T084-backend`, `WO-T084-tester`, `WO-T084-reviewer`.
