# Handoff: T-103 Log a free-trial block when the estimate refuses the trial

From: backend  To: tester

## What changed
- Branch: `feature/T-103-log-estimate-block`
- Pull request: see PR "T-103: Log a free-trial block when the estimate refuses the trial"
- Files: `src/lib/server/bookings.ts` (`advisoryTrial` now takes the admin client and `useFreeTrial`, logs via `recordTrialBlock`), `src/lib/server/free-trial.ts` (new `estimateBlockReason`), `src/lib/server/free-trial.test.ts` (unit tests), `tests/api/bookings.test.ts` (2 API tests, run in CI only), `docs/api-contract.md` (v1.22), `docs/domain-rules.md`, `README.md` (demo step 5 bullet).
- Behaviour: `POST /api/bookings/estimate` with `useFreeTrial: true` and a customer, phone or address match writes the `free_trial_blocks` row (same reason codes). No row when the trial is not asked for, or when the phone or address is missing. Response unchanged. Logging is best effort (existing `recordTrialBlock` swallows rpc errors).
- Migration: NONE. No hosted push needed.

## How to verify
`npx vitest run` (3007 pass). API tests need Supabase (not run locally, no Docker): `npx vitest run -c vitest.api.config.mts tests/api/bookings.test.ts -t T-103` in CI.

## Known gaps or risks
- Builder choice (unconfirmed): dedupe reuses the existing SQL function `record_free_trial_block`: one row per customer and rule per 60 minutes (`FREE_TRIAL_BLOCK_LOG_WINDOW_MINUTES`), repeats raise `attempts`. This is not "per Toronto day". Every estimate refresh while the box is ticked counts as an attempt, so `attempts` can be large; that is the cost of reusing the key without a migration.
- API tests were not run locally (no Docker); CI is the check.

## What the next agent needs
Frontend needs no change: the estimate already sends `useFreeTrial` when the box is ticked. The admin list reads `attempts`.
