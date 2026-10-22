# Handoff: T-107 Per-row attempts on the admin free-trial blocks list (Tester)

From: tester  To: reviewer

## What changed
- Branch: `feature/T-107-blocks-display`; PR #206. Tests only, no app code changed.
- Files: `src/components/admin/AdminBlocksT107Tester.test.tsx` (new, 5 tests), `tests/api/admin-blocks-t107-tester.test.ts` (new, runs in CI only).

## How to verify
`npm run lint`, `npm run typecheck`, `npx vitest run` (3083 pass, 3 expected fail, 0 failures).

## Result: PASS
1. Per-row counts: rows for the same customer+rule (4 and 3), another rule (2), another customer (1, 9) each show their own number; no 7/10/12 sums. "1 attempt" singular, 2 and 10 plural.
2. "first on {date}" equals the row's createdAt in Toronto time (2026-10-20T01:30Z shows Oct 19, 9:30 p.m.). Grep of src, tests, e2e, docs finds no "last on" / "last attempt" text left.
3. MOCK admin route (3 rows, 2/1/4) renders the same lines as the response; item keys are exactly `id, customer, reason, createdAt, attempts` and the page shape is `{items, nextCursor}`, as in `docs/api-contract.md`. The real-API test (CI) checks the same keys, per-row counters (5 and 1, 2, 6) and each row's own createdAt, and no `lastAttempt` field.
4. Accessibility: the repo has axe checks only in e2e for other admin pages (`e2e/admin-queue-real.spec.ts`), none for the blocks page. I added an axe-core run on the rendered list in jsdom (colour contrast off; needs a real browser): 0 violations.

## Known gaps or risks
- INFO: no browser axe check covers `/admin/free-trial-blocks`; the markup is unchanged apart from one word.
- INFO: the real-API test cannot run locally (no Docker); CI runs it.
- INFO (builder's own note): label is "first on" because the API does not return `last_attempt_at`.

## What the next agent needs
CI `ci` result is in the final report.
