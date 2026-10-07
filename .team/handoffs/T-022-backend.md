# Handoff: T-022 CI workflow

From: backend  To: tester

## What changed
- Branch: `feature/T-022-ci`
- Pull request: see PR for Closes #10
- Files: `.github/workflows/ci.yml` (new), `.prettierignore` (added PLAN.md), `playwright.config.ts` (in CI also writes an HTML report so the failure artifact has content), this handoff.

## How to verify
- Local: `npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run build && npm run test:e2e` all pass.
- CI: the single job `ci` runs on pull_request and push to main: checkout, Node 24 + npm cache, npm ci, lint, typecheck, prettier, unit tests, supabase start (studio, imgproxy, mailpit, edge-runtime, logflare, vector, supavisor excluded), Playwright Chromium install, smoke test. Playwright report + test-results uploaded only on failure.
- Deliberate-red test (Tester): push a failing test or lint error on a throwaway branch and confirm `ci` goes red and the artifact appears.

## Known gaps or risks
- `supabase start` could not be run locally (no Docker); proven only in CI.
- No RLS/API test step yet (arrives with T-025/T-027).
- Supabase CLI version is `latest` in setup-cli; pin if it causes flakiness.
- Actions pinned to major versions only.

## What the next agent needs
- Job id and name must stay `ci` for T-024 branch protection.
- No secrets used. If tests later need env vars, take them from `supabase status -o env` on the runner.
