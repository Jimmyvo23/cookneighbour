# Handoff: T-084 Split CI into parallel jobs

From: backend  To: tester

## What changed
- Branch: `feature/T-084-ci-time`
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/163 (Closes #162)
- Files: `.github/workflows/ci.yml` only. No test code changed, no limit raised.
- Jobs: `checks` (npm ci, lint, typecheck, prettier, npm test, build), `supabase` (Supabase start, RLS, API, seed x2 + verify, Playwright real-route e2e), `e2e-mock` (mock e2e, no Supabase), and gate `ci` (needs all three, `if: always()`, no checkout, fails unless every result is `success`).
- Each heavy job keeps `timeout-minutes: 25`. Reports upload on failure as `playwright-report-real` and `playwright-report-mock`.

## How to verify
- First CI run on PR 163 (run 39259625348), all green. Head SHA before this handoff commit: b4368415ddd81679282841ece829421f033a52a3.
- Per job: checks 2m18s, e2e-mock 9m03s, supabase 10m57s, ci gate 4s. Wall time about 11 to 12 min (longest job + gate), against 21 to 24.5 min before.
- Gate test: push a temporary failing step into each job in turn; `ci` must go red. A skipped or cancelled needed job also fails the gate.

## Known gaps or risks
- Gate logic was not exercised on a failing run by me (Tester's job per the Work Order).
- `supabase` is now the long pole (about 11 min).
- Test counts were not compared with main by me; Tester should compare per-job logs.

## What the next agent needs
- Branch protection still requires the check named `ci`; the gate job keeps that name.
