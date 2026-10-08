# Handoff: T-028 Auth backend

From: backend  To: tester

## What changed
- Branch: `feature/T-028-auth-backend`
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/61 (Closes #16)
- Files:
  - Routes: `src/app/api/auth/{signup,login,logout}/route.ts`, `src/app/api/me/route.ts`, `src/app/api/me/phone/route.ts`, `src/app/api/me/phone/verify/route.ts`, `src/app/api/me/address/route.ts`
  - API plumbing: `src/lib/api/{errors,request,validate,rate-limit}.ts`; server-only: `src/lib/server/{caller,me,pepper,mock-sms}.ts`
  - Domain (pure, shared with the seed): `src/lib/domain/{phone,address,hash,private-rows}.ts` + tests
  - Session refresh: `src/proxy.ts`
  - Migration: `supabase/migrations/20261008004229_auth_backend.sql` (NOT applied to hosted); `docs/data-model.md`, `docs/api-contract.md` (implementation notes), `supabase/config.toml` (local auth rate limit raised to 1000 so tests can sign up repeatedly)
  - Tests: `tests/api/*` (`npm run test:api`, config `vitest.api.config.mts`), updated `tests/rls/{escalation,hardening,visibility}.test.ts`, `src/lib/api/*.test.ts`
  - Seed: `scripts/seed.ts`, `scripts/seed-lib.ts` now import the shared domain code; `--verify` follow-ups from the T-030 review.

## How to verify
- `npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run build`
- With Docker: `supabase start`, then `set -a; eval "$(supabase status -o env)"; set +a; npm run test:rls; npm run test:api`. CI does this (run 37709586470 green: 8 RLS files, API route tests, seed + verify).
- Things to try by hand: wrong content type on any POST/PUT/PATCH gives 400; 11th signup per IP per hour gives 429 with Retry-After; second account verifying an already-verified number gives 409 PHONE_IN_USE.

## Known gaps or risks
- Rate limits are in-memory and per process: best effort only (stated in code and contract section 9). Validation failures count toward limits.
- Route tests call the Route Handlers directly with a mocked `next/headers` cookie jar; the real Next request pipeline and `src/proxy.ts` are not exercised by a test (proxy only type-checked and built).
- Trigger `chef_private_reset_checks` can no longer fire (clients cannot update), so the future chef routes must apply the N1 re-verification reset themselves, as the contract says. The trigger was left in place, untested.
- `profiles` has no photo column, so "clients may still update the profile photo path" had nothing to apply to; no photo-path write exists for profiles.
- The unique verified-phone index and the new check constraints will fail to apply on hosted if existing rows violate them (hosted data is believed to be empty of such rows; check before applying).
- The migration drops the admin update policies on chefs and chef_private too (dead after the revoke); admin routes use the service role.
- Phone/address routes allow any signed-in role (the contract lists no 403 there).
- Email enumeration via EMAIL_IN_USE is accepted per contract.

## What the next agent needs
- Use `requireCaller()` (`src/lib/server/caller.ts`) in every route; `handle()` + `ApiFailure` for errors; `readJsonObject`/`requireJson` for the CSRF check; `rejectUnknownKeys` before touching columns.
- Hashes: always build with `phoneColumns` / `addressColumns` from `src/lib/domain/private-rows.ts`.
- Test harness for route tests: `tests/api/harness.ts` (`Browser` has its own cookie jar and IP; call `freshLimits()` when a test needs to get past the placeholder limiter).
