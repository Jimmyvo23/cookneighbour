# Handoff: T-109 Hosted seed refuses a short HASH_PEPPER

From: backend  To: tester

## What changed
- Branch: `feature/T-109-seed-pepper`
- Pull request: see the PR for this branch
- Files: `src/lib/domain/pepper-rule.ts` (new: `MIN_PEPPER_LENGTH`, pure `checkPepper`), `src/lib/domain/pepper-rule.test.ts`, `src/lib/seed-hosted-pepper.test.ts` (process-level), `src/lib/server/pepper.ts` (now uses the shared rule, still re-exports `MIN_PEPPER_LENGTH`), `scripts/seed.ts`, `src/lib/seed-hosted-passwords.test.ts` (its fake pepper is now 32+ chars), `README.md`.

## How to verify
`npm run lint && npm run typecheck && npx vitest run` all pass. `HASH_PEPPER=short npm run db:seed -- --hosted` (with the other hosted vars) exits 1 with "HASH_PEPPER must be at least 32 characters" and never prints the value.

## Known gaps or risks
- App behaviour is unchanged: under NODE_ENV=test the app still accepts short peppers.
- `--local` keeps the `"local-dev-pepper"` fallback (builder choice below).

## What the next agent needs
- Parity: the app trims HASH_PEPPER, so the seed now trims too (hosted and local). Before, a pepper with stray whitespace would have produced seeded free-trial hashes the app never matches.
- Builder choice: `--local` also trims an explicit HASH_PEPPER (parity only). With no env it still uses `local-dev-pepper`; a local app run needs HASH_PEPPER=local-dev-pepper (32 chars needed by the app outside tests, so a local app run must use its own 32+ char value and seed with that same value). Not enforced for --local.
- The check runs before password resolution and before any DB call; `--verify` is unaffected (needs no pepper).
