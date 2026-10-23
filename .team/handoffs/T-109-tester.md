# Handoff: T-109 Tester

From: tester  To: reviewer

## Result: PASS (with one non-blocking MEDIUM finding, pre-existing)

## Checks
- lint clean, typecheck clean, `npx vitest run` 3187 passed, 3 expected fail.
- checkPepper/MIN_PEPPER_LENGTH shared (app pepper.ts + scripts/seed.ts). 31 refused, 32 ok, trim parity, messages never contain the value (manual run + tests). App NODE_ENV=test leniency unchanged (returns trimmed value before the check). `--hosted` refuses before any DB call (31 chars: no "seeding HOSTED", no fetch). `--verify` unaffected (reaches DB without pepper).
- README seed bullet and `--help` text accurate.
- Added `src/lib/t109-tester-pepper-parity.test.ts` (padded pepper seeds the same phone hash the app computes; 31/32 boundary).

## Parity finding (MEDIUM, pre-existing, not caused by T-109)
- CI "Seed demo data and verify" runs `db:seed -- --local` with no HASH_PEPPER, so seeded customers (profile_private phone_hash, address_hash via phoneColumns/addressColumns, scripts/seed.ts:199-201) use "local-dev-pepper". The real-routes e2e app uses "e2e-test-pepper-not-a-secret-0000" (playwright.config.ts:44). Those seeded hashes can never match what the app computes.
- Impact: the seed writes no free_trial_claims. No e2e test uses seeded customers (grep: no customer1@, 555-01xx, "Fictional Way" in e2e). demo-path-real.spec.ts and booking-real.spec.ts create their own users with random phones/addresses, so the "second free-trial attempt blocked" step passes without the seed. It is not a CI failure.
- Real demo risk: a human running the README demo against a seeded stack with the app pepper (32+ chars outside tests) cannot trigger a phone/address block using seeded customer1..n details (e.g. +14165550101), because the hashes differ. README step 5 uses new accounts, so the script still works as written only if those accounts duplicate a previously created in-app user.
- Minimal fix (recommend, separate task): make the local fallback a shared 32+ char constant also used by playwright.config.ts and documented in the README (local app runs set HASH_PEPPER to it), or have the CI seed step pass the same HASH_PEPPER as playwright.config.ts. Not changed here.

## Backend handoff note
Point 2 ("local-dev-pepper needs 32 chars") is self-contradictory (it is 15 chars); ignored per the Planner.
