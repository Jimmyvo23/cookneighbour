# Handoff: T-039 Search API

From: backend  To: tester

## What changed
- Branch: `feature/T-039-search-api`
- Pull request: #85 (Closes #27). CI run 38016490743 green on head 294b6c5.
- Files:
  - `docs/api-contract.md`: v1.3, section 7 rewritten (search, detail, postal prefixes); header and section 11 updated.
  - `src/lib/api/types.ts`: new `PublicChefSearchQuery`, `PublicChefSearchItem`, `PublicChefSearchResponse`, `PublicDish`, `PublicChefDetail`; the old `PublicChef` / `PublicChefListQuery` types were unused and are removed.
  - `src/lib/domain/search.ts` (+ `search.test.ts`, 33 tests): query parsing, cursor, A-18 reach, A-20, location options, filter, sort, keyset paging. Reuses `centreForPostal`, `distanceMetres`, `chefMatchesDietary`, `isRealDate`, `addDays`, `AVAILABILITY_HORIZON_DAYS`.
  - `src/lib/server/search.ts`: reads (server-only), user-scoped client.
  - `src/app/api/chefs/route.ts`, `src/app/api/chefs/[id]/route.ts`, `src/app/api/reference/postal-prefixes/route.ts`.
  - `src/app/api/admin/chefs/route.ts`: `await connection()` first (T-036 backlog); the source-guard test `admin-chefs-guards.test.ts` now allows it before the admin gate.
  - `tests/api/search.test.ts` (new, 22 tests), `tests/api/setup.ts` (no-op `connection()` mock).
- **No migration.** Existing RLS already lets anon read approved chefs, active dishes and availability of approved chefs, and `postal_prefixes`. Nothing to `db push`.

## Contract v1.3 summary
- `GET /api/chefs`: `postalCode` (full or 3 chars) or `city` (never both), `cuisine`, `language`, `avoidAllergens` (comma list, A-17), `minRateCents`, `maxRateCents`, `date` (inside D-15 window), `locationType`, `limit` (1-50, default 20), `cursor`. Empty values ignored, repeated parameter 422, unknown parameters ignored, all errors at once. Items: `id, displayName, photoPath, cuisines, languages, hourlyRateCents, currency, ratingAvg, reviewCount, serviceCity, serviceRadiusKm, distanceKm, locationOptions, chefHomeOnly`. Sort: distance (nulls last), rating desc, name, id; without a point rating desc, name, id. No location param is allowed (browse all, `distanceKm: null`).
- `locationType` absent behaves like `customer_home`: reachable chefs plus out-of-reach chefs bookable at their home (marked `chefHomeOnly`); `chef_home` keeps only chefs bookable at home, no radius check.
- `GET /api/chefs/:id`: `PublicChefDetail` with active dishes (oldest first), `bookableDates`, `today`, `lastBookableDay`. One identical 404 for non-uuid, unknown, pending, rejected, A-20-hidden.
- `GET /api/reference/postal-prefixes`: `{items:[{prefix,city,lat,lng}]}`, `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`, cookie-free client. Search and detail are `no-store`.

## How to verify
- `npm run lint`, `npm run typecheck`, `npm test` (735 unit tests, 37 files), `npm run build` (no cookies() prerender error any more; the three new routes and the admin list are dynamic).
- DB suites need Docker (not available on the builder's machine), so they ran in CI only: `npm run test:rls`, `npm run test:api` (15 files green in run 38016490743). `tests/api/search.test.ts` covers: every filter, distance order for postal code, prefix and city, rating fallback, radius and chef's-home-only (both enabled and not enabled), chef_home options visibility, chefs without a service area, A-20 (five cases, identical 404 bodies), pending and rejected never returned to seven viewers (visitor, customer, pending chef, rejected chef, approved chef, booking counterparty, admin), exact key sets and no private strings, dishes and dates (past, beyond window and unavailable rows excluded), 404 variants, all 422 cases, unknown-parameter tolerance, paging with a chef joining mid-way.

## Known gaps or risks
- The search reads up to 1000 approved chefs and filters and sorts in code (prototype scale); noted in the contract. A real launch needs SQL-side filtering and paging.
- Cuisine and language filters are case-insensitive exact matches of one entry (free text, no synonyms).
- `date` filter: booked dates are not subtracted yet (WO-4b, T-042; A-19). The detail page's `bookableDates` likewise.
- Distance is between area centres (A-1), approximate; never an address.
- A chef offering only an unapproved chef's home is hidden from search but the detail page still answers with `locationOptions: []` (decision: only A-20 hides a detail page; Planner may change).
- Q-13 (approved chef clearing bio/photo) still uses the A-20 interim rule. Q-18 (diets beyond allergens) unchanged.
- Hosted seed data was not touched. Frontend demo needs chefs with bio, photo and an active dish; the seed script already makes those, but hosted seeding needs Jimmy.

## What the next agent needs
- Frontend T-040/T-041: build against contract section 7 and the types in `src/lib/api/types.ts`. Use `/api/reference/postal-prefixes` for the city picker (and for lat/lng of map pins, centres only). `photoPath` is an object name in the public `profile-photos` bucket; dish photos are in `dish-photos`. Show a "chef's home only" label when `chefHomeOnly` is true. The mock adapter needs routes for the three endpoints (query semantics as in section 7). Use `today` and `lastBookableDay` from the detail response for the date picker.
- Tester: DB suites run only in CI. Try edge cases around cursor tampering, a non-ASCII city, `limit` with leading zeros, and a signed-in chef viewing a hidden chef's detail. `connection()` is mocked to a no-op in `tests/api/setup.ts`.
- T-042 (WO-4b) must subtract booked dates in both the date filter and `bookableDates`.
