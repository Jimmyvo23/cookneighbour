# Work Order WO-T050-T089: Demo path e2e and small UI follow-ups

Tasks: T-050 (Tester), T-089 plus the T-047 Reviewer LOW from the T-050 row (Frontend). On 2026-10-21 Jimmy chose a parallel window of about 1 hour with T-049 round 3, T-060, T-089 and T-050.

- T-050: branch `feature/T-050-e2e-demo-path`, worktree `../CookNeighbour-wt-T050`. Issue #38.
- T-089 + `useChat` late-join fix: branch `feature/T-089-ui-followups`, started by Frontend **after** T-049 round 3 is pushed (Frontend works on one task at a time).

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| tester | T-050 | A new real-stack Playwright spec in `e2e/` for the §12 demo: (1) customer searches Mississauga + Vietnamese and finds the seeded chef; (2) picks dishes, sees time and cost, books 2 days on the free trial; (3) chef accepts, both exchange messages, with two browser contexts so the second party sees the message live through Realtime; (5) admin approves a new chef, and a second free-trial attempt is blocked. Step 4 (customer review) is added after T-049 merges. If the Realtime check is not reliable in CI, it becomes a recorded manual check written up in the handoff. | M–L | Realtime timing flakes in CI; shared test data |
| frontend | T-089 + late-join | (1) `src/components/refusal.tsx`: empty or whitespace-only `report()` text gives no leading full stop; update the Tester's characterisation test in `refusal.test.tsx`. (2) `src/components/chat/useChat.ts`: set the late-join flag when the first load **starts**, not when it finishes, so a message sent during the first GET is not missed; a unit test that fails before the fix. | S | Low |
| tester | T-089 checks | The two unit tests, the full unit suite, the `ci` gate. | S | Low |
| reviewer | each | Plan compliance, no flaky waits (fixed sleeps), test data isolated per lessons-learned §3, code quality. | S | Low |

## Left out
Fixing any bug the demo spec finds (each becomes its own task), T-052 accessibility, T-053 security review.

## Decision
Decide ids `WO-T050-tester`, `WO-T089-frontend`, `WO-T050-T089-tester`, `WO-T050-T089-reviewer`.
