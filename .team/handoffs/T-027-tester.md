# Handoff: T-027 RLS test harness

From: tester  To: reviewer

## What changed
- Branch: `feature/T-027-rls-tests` (from `feature/T-025-schema-rls`)
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/56 (base `feature/T-025-schema-rls`; Closes #15)
- Files: `vitest.rls.config.mts`, `tests/rls/` (`helpers.ts`, `global-setup.ts`, `visibility`, `privacy`, `escalation`, `engagement`, `booking-rules`, `storage` test files, `README.md`), `package.json` (`test:rls`, dev deps `pg`, `@types/pg`), `.github/workflows/ci.yml` (`RLS tests` step after `supabase start`), this handoff.

## How to verify
- CI run (green): https://github.com/Jimmyvo23/cookneighbour/actions/runs/37697131032 : step "RLS tests" = 6 files, 83 tests passed. (First run 37696780728: 82/83, the one failure was a wrong expectation in my own test, fixed.)
- Locally (needs Docker): `supabase start`, then `set -a; eval "$(supabase status -o env)"; set +a; npm run test:rls`.
- Design: global setup builds the cast once through the service client (admin, 2 customers, approved chefs h1 and h2, pending, rejected, bookings in requested/accepted/chef-home/declined/completed states, claims, receipts, storage objects). Tests act as each user through RLS. Writes always chain `.select()` so a successful write returns rows and fails the assertion. Most tests pair the forbidden case with an allowed control on the same data. The helper refuses a non-local `API_URL`.

## Known gaps or risks
- Not run locally (no Docker); CI is the proof.
- Fixtures are not deleted after the run (throwaway CI DB; unique emails, random hashes and far-future random dates keep re-runs safe, re-run on the same DB not exercised).
- Not covered: Realtime delivery of messages (only the table policies), expiry of `requested` bookings (no rule defined), cancellation timing rules, Supabase auth sign-up endpoint itself (role-from-metadata tested through admin createUser which fires the same trigger), the API-route layer (does not exist yet), `postal_prefixes` write denial beyond the grants check, public photo bucket MIME and size limits.
- Free-trial rows are written by the service client; which state the API sets (held, consumed, released) is not tested here.

## What the next agent needs
- Add a case to the matching file in `tests/rls/` whenever a table, policy or bucket is added. Use `makeUser`, `makeChef`, `makeBooking` in `helpers.ts`.
