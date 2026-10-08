# Handoff: T-030 Seed data

From: backend  To: tester

## What changed
- Branch: `feature/T-030-seed-data`
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/59 (Closes #18)
- Files: `supabase/seed.sql`, `scripts/seed.ts`, `scripts/seed-data.ts`, `scripts/seed-lib.ts`, `src/lib/seed-data.test.ts`, `.github/workflows/ci.yml` (seed + verify step after the RLS tests), `package.json` (`db:seed`), `tsconfig.json` (`allowImportingTsExtensions`), `README.md` (Demo data section).

## How to verify
- `npm test` (seed data unit tests), `npm run lint`, `npm run typecheck`, `npx prettier --check .`.
- `npm run db:seed` prints usage and exits 0 without touching anything. `--local --hosted` together also prints usage.
- With Docker and `supabase start`: `SEED_ADMIN_PASSWORD=anything npm run db:seed -- --local` twice (second run must change nothing), then `npm run db:seed -- --local --verify` (expects "verify ok: 12 chefs, 1 approved Vietnamese ...", 31 dishes... exact counts: 61 prefixes, 3 customers, 12 chefs).
- CI step "Seed demo data and verify" already does this (run 37705950696, green).

## Known gaps or risks
- Not run against the hosted project; the Planner runs `--hosted` after Jimmy sets `SEED_ADMIN_PASSWORD` (and `HASH_PEPPER`, which `--hosted` also requires so seeded hashes match the app).
- Seeded phone/address hashes are HMAC-SHA256 with the pepper. T-028/WO-4 must use the same scheme (`scripts/seed-lib.ts`) or the demo customers' hashes will not match what the app computes.
- Chefs have no photos or uploaded documents (paths are null); an admin "view documents" demo will show none. Ratings are cached demo values with no review rows.
- Cuisines have no table (free text, per contract), so there is no cuisine reference data.
- Postal-prefix coordinates are approximate, not an official dataset.
- The admin account is skipped (with a log line) when `SEED_ADMIN_PASSWORD` is unset.

## What the next agent needs
- Demo logins are in README "Demo data": customers `customer1..3@example.com` / `DemoCustomer!2026`; chefs `chef.<name>@example.com` / `DemoChef!2026`; admin `admin@example.com` with the env password.
- Vietnamese approved chef in Mississauga with both locations: `chef.lan@example.com` (prefix L5B, chef home enabled). Also `chef.hoa@` (Vietnamese, L4W, customer home only). Pending: wei, selam, ana. Rejected: carlos.
- Customer 1 (L5B) and 3 have no prior bookings, so each has the free trial available.
