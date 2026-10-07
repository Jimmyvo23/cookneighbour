# Handoff: T-022 CI workflow

From: tester  To: reviewer

## What changed
- Verdict: PASS. No application or workflow changes by tester.
- Branch: `feature/T-022-ci`; PR #48 (Closes #10).
- Throwaway draft PR #49 (`test/T-022-ci-red`) opened, closed unmerged, remote branch deleted.

## How to verify (evidence)
- Green run on PR #48: https://github.com/Jimmyvo23/cookneighbour/actions/runs/37689931662 (`ci` pass, 2m16s, includes supabase start and Playwright smoke).
- Red run on PR #49: https://github.com/Jimmyvo23/cookneighbour/actions/runs/37690503715 . lint, typecheck, prettier passed; `npm test` failed ("expected 1 to be 2"); later steps skipped; `ci` red. An earlier red run (37690314451) failed at prettier because my one-line test was unformatted; fixed to isolate the unit-test step.
- Fresh clone of feature/T-022-ci: npm ci, lint, typecheck, prettier --check, test (6 passed), build, test:e2e (1 passed) all pass.
- Workflow checks: no `secrets.` references; top-level `permissions: contents: read`; job id `ci` and name `ci`.

## Known gaps or risks
- Failure artifact: red run was a unit-test failure before Playwright ran, so no playwright-report was produced (upload step ran with if-no-files-found: ignore, no artifact listed). Artifact content on an e2e failure was not exercised.
- CI warnings (non-blocking): Node.js 20 actions (checkout@v4, setup-node@v4, supabase/setup-cli@v1) forced to Node 24; eslint@9.39.5 deprecated; npm "install-scripts" notice for unrs-resolver; punycode deprecation.
- supabase CLI `latest` unpinned; actions pinned to major only (as handoff states).
- Branch protection (T-024) not yet applied, so red does not yet block merge.

## What the next agent needs
- Keep job id and name `ci` for T-024.
