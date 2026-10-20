# Work Order WO-6b: §10 edge-case sweep

Task: T-051 (tester). Branch `feature/T-051-edge-case-sweep`, worktree `../CookNeighbour-wt-T051`. Runs beside WO-6a (backend) and WO-5d (frontend). The Tester pauses this sweep whenever T-049 or a WO-6a task is ready for testing, which comes first.

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| tester | T-051 | Map each CLAUDE.md §10 edge case to the tests that already cover it (unit, API, RLS, e2e) in a table at `docs/edge-case-matrix.md`. Add tests only for gaps, in test files only, never product code. Each case gets: covered / added / BUG (with steps). A bug list in the handoff for the Planner to turn into tasks. Real-route e2e only where the CI stack supports it. | M–L | Long; can conflict with the parallel WO-6a test files, so new tests go in new `*-t051.test.ts` files |
| reviewer | T-051 review | The matrix is honest (no "covered" without a real test), the new tests check behaviour, scope is test-only. | S | Low |

## Left out
Fixing bugs (each becomes its own task), T-050 demo path, T-052 accessibility.

## Decision
Decide ids `WO-6b-tester`, `WO-6b-reviewer`.
