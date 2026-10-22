# Handoff: T-099 Hosted seed takes demo passwords from the environment

From: backend  To: tester

## What changed
- Branch: `feature/T-099-hosted-demo-passwords`
- Pull request: see the PR for this branch
- Files: `scripts/seed-lib.ts` (new `resolveDemoPasswords`), `scripts/seed.ts` (uses it; usage text), `src/lib/seed-data.test.ts` (6 new tests), `.env.example` (names only), `README.md` (Demo data section).
- `--local` still uses the constants in `scripts/seed-data.ts` (local logins unchanged). `--hosted` refuses to seed without `SEED_DEMO_CHEF_PASSWORD` and `SEED_DEMO_CUSTOMER_PASSWORD`. Error messages name the variable and never contain a password value. No seed was run against hosted.

## How to verify
- `npx vitest run src/lib/seed-data.test.ts` passes. Full suite, lint, tsc, prettier pass locally.
- `env -u SEED_DEMO_CHEF_PASSWORD NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:1 SUPABASE_SECRET_KEY=x HASH_PEPPER=x node scripts/seed.ts --hosted` exits 1 with a message naming `SEED_DEMO_CHEF_PASSWORD`, before any network call.
- CI seeds with `--local`, so its path is unchanged.

## Known gaps or risks
- Builder choices, unconfirmed by Jimmy: variable names `SEED_DEMO_CHEF_PASSWORD` / `SEED_DEMO_CUSTOMER_PASSWORD`; minimum 12 characters; hosted also rejects a value equal to the public repo default; the same password is shared by all demo chefs (and by all demo customers), as before.
- Hosted demo accounts that were already seeded with the old public passwords keep them until the seed is re-run with the new variables (it updates passwords of existing users). Jimmy needs to do that if hosted was seeded.
- Not implemented: generating and printing passwords once (the alternative in the review).

## What the next agent needs
Nothing else; no API or schema change.

## Round 1
- Tester LOW fixed: `resolveDemoPasswords` now checks the trimmed value. Whitespace-only is treated as missing, the 12-character minimum applies to the trimmed value, and a value whose trim equals the repo default is rejected.
- Builder choice (unconfirmed): a valid value is used exactly as given, not trimmed, so the password is never silently changed. A password with surrounding spaces is therefore allowed if its trimmed form is valid.
- Tests added in `src/lib/seed-data.test.ts` (whitespace cases and as-given). The Tester's tests did not pin the old behaviour, so they are unchanged.
- The `supabase` job failure on `e2e/booking-real.spec.ts:154` is outside this change; spec untouched.
