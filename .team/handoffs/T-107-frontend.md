# Handoff: T-107 Per-row attempts on the admin free-trial blocks list

From: frontend  To: tester

## What changed
- Branch: `feature/T-107-blocks-display` (stacked on T-103, PR #203)
- Files: `src/lib/server/admin-engagement.ts` (list now returns each row's own `attempts`; the second summing query is gone), `src/components/admin/AdminEngagementViews.tsx` (label "first on"), tests `src/lib/server/admin-blocks-list.test.ts` (new), `src/components/admin/AdminEngagementViews.test.tsx`, `tests/api/estimate-block-log-tester.test.ts` (3 and 4, not 7), `tests/api/admin-engagement.test.ts` (phone rows now 1 each), `docs/api-contract.md` (body text only, Status line untouched).
- No response shape change, no migration. D-155 kept.

## How to verify
`npm run lint`, `npm run typecheck`, `npx vitest run` (3058 pass). API tests run only in CI.

## Known gaps or risks
- `free_trial_blocks.last_attempt_at` exists in the table but the API does not return it, so the label says "first on" (createdAt) rather than a last time. Returning it needs a new response field; not done (Planner: shape kept).
- Builder choice for Jimmy: the only visible text change is "last on" -> "first on" ("N attempts, first on {date}").
- Impeccable detect not run: one word of text changed, no layout change. Impeccable finish-reviewer skipped (D-44).

## What the next agent needs
Rebase onto main after #203 merges if needed.
