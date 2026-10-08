# Handoff: T-030 Seed data (Tester)

From: tester  To: reviewer
Verdict: PASS (no blockers; 4 non-blocking notes)

## What I checked
Fresh clone of branch feature/T-030-seed-data (e303dfa), empty env, no .env.local. Nothing pushed, PR untouched.

1. CI: `ci` pass on PR #59 (run 37706241374). Log shows the RLS tests (all files green) and then "Seed demo data and verify": run 1 and run 2 both print identical counts (61 prefixes, admin, 3 customers, 12 chefs, 31 dishes, 21 days), then `verify ok`.
2. Fresh clone: npm ci, lint, typecheck, prettier --check, test (3 files, 13 tests), build all pass.
3. Safety (empty env, exit codes captured):
   - no flag: usage, exit 0, no client created.
   - `--local --hosted`: usage, exit 1.
   - `--hosted` (also with `--verify`) without URL/key: refuses, exit 1.
   - `--hosted` with URL+key but no HASH_PEPPER: refuses before any write, exit 1.
   - `--hosted` with all but an unreachable URL: fails on first call, nothing written.
   - Admin is only created when SEED_ADMIN_PASSWORD is set (`process.env.SEED_ADMIN_PASSWORD || undefined`; log says SKIPPED). grep finds no default admin password. Only occurrence is the CI throwaway `ci-throwaway-admin-password-local-only` in ci.yml, clearly labelled local-only for a disposable runner stack.
   - Secret key: used only in scripts/seed.ts (server script, node) and src/lib/supabase/env.ts server-side `required()` / scripts/db-check.mjs. Not NEXT_PUBLIC. No client import of the seed script.
4. Hygiene: all emails @example.com; phones +1416555010x; addresses "100 Fictional Way", "10 Example Lane", "50 Invented Boulevard" etc., obviously fake; names are first names with "(demo)" suffix, nobody targeted. Check statuses carry MOCK labels in file header, comments and README.
5. Demo readiness: chef.lan@example.com approved, Vietnamese, prefix L5B (Mississauga), locations customer_home + chef_home, chef_home_enabled true, kitchen address set. chef.hoa also Vietnamese (L4W, customer home only). Pending: wei, selam, ana. Rejected: carlos (with reason). 31 dishes with cook minutes, cost, servings, allergens, shelf life (1 to 2 days). Availability is computed relative to the run date (today + 1..21 days, UTC), so re-running refreshes the window; weekday gaps per chef.
6. Postal prefixes: 61 unique; 23 Mississauga prefixes L4T to L5W all present; all 61 coordinates inside lat 43.41..43.94, lng -79.72..-79.45 (within the GTA box).
7. Hash scheme (for T-028): HMAC-SHA256 keyed with HASH_PEPPER, hex digest.
   - phone: `HMAC(pepper, "phone:" + E164)`, E164 like +14165550101.
   - address: `HMAC(pepper, "address:" + lower(line) with whitespace collapsed and trimmed + "|" + postal code upper-cased with spaces removed)`.
   - Local default pepper when unset: `local-dev-pepper`; hosted requires the real HASH_PEPPER.
   T-028 must reuse `phoneHash`, `addressHash`, `normalizeAddress` from scripts/seed-lib.ts (or an identical copy) or seeded demo customers will not match.

## Notes (non-blocking)
- CI `verify ok` printed 39 chefs / 37 dishes, not 12 / 31, because RLS test fixtures run earlier on the same stack and remain. The builder handoff says 12 chefs. verify only checks "at least one", so it passes, but it does not prove the exact seed counts.
- verify does not check availability or dish fields, so a broken availability seed would not fail CI.
- Seeded `verified` statuses and `phone_verified = true` are real column values with MOCK only in comments/README; any admin UI should label them MOCK.
- Chefs have no photos or documents, and ratings are cached with no review rows (builder already noted).
- Running `--hosted` without SEED_ADMIN_PASSWORD proceeds and skips the admin, while the usage text says it is needed. Safe and logged, just inconsistent wording.

## Not tested
Hosted run (needs Jimmy's env vars). I could not run a local Supabase stack (no Docker use); idempotency and verify rely on the CI log.
