# Handoff: T-032 Dishes and availability API

From: backend  To: tester

## What changed
- Branch: `feature/T-032-dishes-availability-api`
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/75 (Closes #20). CI `ci` green on the head: unit 284, RLS 115, API 258.
- Contract v1.1 committed first: `docs/api-contract.md` sections 5A (dishes), 5B (availability), section 2 rule 3, 7, 10, 11; types in `src/lib/api/types.ts` (`Dish`, `CreateDishRequest`, `UpdateDishRequest`, `ChefDishListResponse`, `AvailabilityResponse`, `SetAvailabilityRequest`).
- **Migration (yes, Planner must `npx supabase db push` after merge):** `supabase/migrations/20261009120000_dishes_availability_routes_only.sql`. Revokes client INSERT/UPDATE/DELETE on `dishes` and `availability`, drops the six own-row write policies, adds trigger `dishes_active_cap` (max 50 active dishes per chef, advisory lock per chef, SQLSTATE 54000), revokes EXECUTE on the trigger function.
- Routes: `src/app/api/chef/dishes/route.ts` (GET, POST), `src/app/api/chef/dishes/[id]/route.ts` (PATCH), `src/app/api/chef/availability/route.ts` (GET, PUT).
- Logic: `src/lib/domain/dishes.ts` (pure rules, bounds, Toronto date), `src/lib/server/dishes.ts` (server), `checkStoragePath` now also takes `dish_photo` (`src/lib/domain/chef-application.ts`, new `PathTarget` type; `StorageTarget` and the UI upload rules are unchanged).
- Tests: `src/lib/domain/dishes.test.ts`; `tests/api/chef-dishes.test.ts`, `chef-availability.test.ts`, `dishes-visibility.test.ts`, helpers `dish-helpers.ts`; `tests/rls/dishes-cap.test.ts`; updated `tests/rls/escalation.test.ts`, `visibility.test.ts` (privilege snapshot), `hardening.test.ts`, `storage-hardening.test.ts` (comment).
- Docs: `docs/data-model.md` updated.

## How to verify
- `npm run lint`, `npm run typecheck`, `npx prettier --check .`, `npm test` (284), `npm run build`: all pass locally. API and RLS suites need Docker; they ran in CI only (`gh pr checks 75`).
- With local Supabase: `npm run test:rls` and `npm run test:api`.

## Decision: routes only (justification)
Bounds, unsafe text, photo path ownership plus object existence, the no-past-dates rule and the active cap cannot be enforced from the browser, and a direct client insert could bypass all of them. Same approach as D-12. A DB-level cap trigger is used (not a count in the route) so parallel creates and reactivations cannot pass the cap. Photo files are still uploaded by the browser to `dish-photos` (owner-writable, unchanged on purpose, see data-model Storage); the route only accepts the path after the existence probe.

## Rules and bounds (all ASSUMPTIONS except DB checks; in the contract)
name 1-120 (`Fields.text`-style unsafe-text rule), description null or <=1000 (newlines allowed), cuisine 1-40, cookMinutes 5-360 (6 h soft limit), ingredientCostCents 0-50000, servings 1-50, allergens <=14 entries of 1-40 chars, stored lower case and de-duplicated, shelfLifeDays 0-7 (default 2). Photo: `<chefId>/dish-<uuid>.<jpg|jpeg|png|webp>`, 403 foreign folder (no storage call), 422 malformed or object missing. Availability: opt-in dates (a date without a row is not available), window today..today+180 (Toronto), <=200 dates per list, `remove` may be any real date.
- `missing.sampleDish` (T-031 submit) becomes satisfiable by `POST /api/chef/dishes` with a `photoPath` (active dish with a photo); deactivating the last one brings it back.
- No DELETE route (nothing is deleted); deactivate/reactivate via PATCH `isActive`.

## Known gaps or risks
- Availability semantics (opt-in), the 180-day window and the 50-dish cap are assumptions needing Jimmy's nod; stated in the contract.
- PUT availability runs an upsert and a delete as two idempotent statements, not one transaction. A failure between them leaves a half-applied request that a retry fixes.
- A replaced dish photo object stays in Storage (no deletion without approval). The chef can still delete their own object in `dish-photos` between probe and save (owner-writable bucket); then the dish points at a missing file.
- Clearing a date that has a booking does not touch the booking (WO-4 owns that).
- Customer-facing dish and availability reads are not built (WO-4); RLS limits them to active dishes of approved chefs (tested).
- Frontend mock adapter (`src/lib/mocks/`) has no dish routes yet; T-034 must add them from the contract.

## What the next agent needs
- Tester: try
  - the auth matrix on all 5 handlers (anon 401, customer/admin 403, metadata role ignored);
  - mass assignment (`chefId`, `isActive` on create, `currency`, `id`) and unknown keys;
  - unsafe text (NUL, control chars, lone surrogates) in name, cuisine, description, allergens;
  - bounds one past each limit; photo path variants (foreign folder with and without an existing object gives the same 403; wrong bucket; upper case; traversal);
  - PATCH on another chef's dish and on a malformed id (404 both, same body);
  - the cap race (parallel POSTs) and reactivation over the cap;
  - availability: past date, today, day 181, `2026-02-30`, same date in add and remove, 201 dates, remove of a past row; midnight in Toronto vs UTC;
  - visibility: pending/rejected chef's dishes and dates invisible to anon and customers; approved shows only active dishes;
  - direct browser writes with a chef session now fail with 42501.
- Test data: helpers in `tests/api/dish-helpers.ts`; `readyChef()` still inserts its sample dish with the service role.
- T-034 (Frontend) builds from contract sections 5A and 5B only.

## Round 2 (fix round 1, after tester FAIL)
- **Finding 1 fixed:** `isRealDate` in `src/lib/domain/dishes.ts` now rejects years before 0001 (`v < "0001-01-01"`), so `remove: ["0000-01-01"]` is 422, not a 500. The helper is used only by `parseAvailabilityBody`; no other gap. Contract 5B notes the rule.
- **Finding 2:** tester's `tests/api/dishes-roles-tester.test.ts` (metadata role claims, year 0000) ran in CI and passed.
- **Jimmy's decisions recorded** in `docs/api-contract.md` (no code change): D-15 (availability opt-in, window today..today+180 Toronto) and D-16 (dish bounds, 50 active dishes cap) replace the ASSUMPTION marks. `docs/data-model.md` had none to change.
- Checks: lint, typecheck, prettier, `npm test` (285), build pass locally; CI `ci` green on the head (PR #75). Migration unchanged: Planner runs `npx supabase db push` after merge.
