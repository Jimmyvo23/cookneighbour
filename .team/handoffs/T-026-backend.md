# Handoff: T-026 API contract v1

From: backend  To: reviewer (Tester checks the contract against code in T-028/T-029)

## What changed
- Branch: `feature/T-026-api-contract`
- Pull request: see Issue #14 (PR "T-026 API contract v1")
- Files: `docs/api-contract.md` (new), `src/lib/api/types.ts` (new, types only), this handoff. No routes, no migrations.

## How to verify
- `npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run build` all pass.
- Read `docs/api-contract.md` against `supabase/migrations/` and `docs/data-model.md`: every route lists role, request/response types, errors, tables, and the MUST-check list (section 2).
- `src/lib/api/types.ts` has no imports and no runtime code.

## Known gaps or risks
- Marked ASSUMPTION/PROPOSED (not requirements): phone uniqueness rule and its partial unique index (section 8, for T-028 to add as a migration after Planner confirms); approve preconditions (phone verified, sample dish with photo, MOCK checks verified); rejected chefs may edit and resubmit; rate-limit numbers; email confirmation off in demo; CSRF approach; hourly-rate bounds; free-text cuisines/languages.
- Chef sign-up rows (`chefs`, `chef_private`) have no client insert policy, so sign-up must use the service role; GET /api/chef/application repairs missing rows.
- Public chef list must filter `status = 'approved'` in code: signed-in chefs also match the own-row/counterparty RLS policies.
- Dishes/availability routes, search with distance, bookings and later areas are not in v1.
- Local note: `npm run typecheck` failed until `npm ci` (stale local `@types/pg`); CI uses `npm ci`.

## What the next agent needs
- Frontend (T-029): code against sections 3 and 4 and the types file; show a MOCK badge on phone verify (`mock: true`, `mockHint`); error shape is `{ error: { code, message, fields? } }`.
- Backend T-028/T-031/T-035: implement section 2 checks in every route; use `getUser()`, role from `profiles`, whitelist columns, validate storage paths.
- Tester: write route tests for each MUST-check (foreign path, non-admin on /api/admin, role escalation at sign-up, pending chef absent from /api/chefs, no hashes in any response).
