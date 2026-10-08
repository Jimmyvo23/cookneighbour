# Handoff: T-032 Dishes and availability API (tester)

From: tester  To: backend

## Result: FAIL (one low-severity bug, small fix; everything else passes)

## What changed
- Branch: `feature/T-032-dishes-availability-api`; PR #75.
- Tester files added (tests only):
  - `tests/api/dishes-roles-tester.test.ts` (metadata role claims on all 5 handlers; year-0000 remove)
  - `src/lib/domain/dishes.test.ts` (one new unit test: `isRealDate` refuses year 0000)

## Evidence
- Fresh `npm ci`, lint, typecheck, `prettier --check .`, `npm test` (284), `npm run build`: all pass locally.
- CI `ci` on head 2b015f2 green: unit 284, RLS 115, API 258, Playwright 11 and 19 passed.
- After my push CI is red on purpose: the new unit test fails (`expected true to be false`, confirmed locally and in CI). The unit step stops the run, so the two new API tests have not yet run in CI. They have not been run anywhere (no Docker here). Expect "metadata" test to pass and "year 0000" to fail until the fix.

## Findings
1. **LOW (bug) `src/lib/domain/dishes.ts` `isRealDate` (about line 160).** `PUT /api/chef/availability` with `{"remove":["0000-01-01"]}` passes `isRealDate` (JS accepts year 0) but Postgres has no year 0 ("date/time field value out of range"), so the delete in `setAvailability` (`src/lib/server/dishes.ts`, remove branch) fails and the route answers 500 instead of 422. Contract says `remove` may be any real date. Fix: reject year `0000` in `isRealDate` (for example `v >= "0001-01-01"`); then both new tests go green. The Postgres behaviour is from my knowledge of Postgres, not run here; the API test will confirm.
2. **INFO.** The T-028 "metadata role ignored" test did not cover the five new handlers. Added (finding closed once CI runs it). Code is correct by reading: `requireChef()` takes the role from `profiles`.

## Checked and passed (existing builder tests read and confirmed to cover the try-list; code reviewed against them)
- Auth matrix anon 401 / customer, admin 403 on all handlers; no writes.
- Mass assignment, unknown keys, `isActive` on create: 422. Unsafe text (NUL, control, lone surrogates) 422, never 500, in name/cuisine/description/allergens.
- Bounds one past each limit; allergens normalised.
- Photo paths: foreign folder 403 with or without object and before any storage call; wrong bucket, upper case, traversal, missing object 422.
- PATCH other chef's dish vs malformed id: identical 404 body; ownership is checked before the photo probe, and the write is filtered by id AND chef_id.
- Cap: trigger under per-chef advisory lock, reactivation counted excluding the row itself; parallel POST and over-cap reactivation tests exist (409 INVALID_STATE). Trigger EXECUTE revoked; privilege snapshot updated.
- Availability: today and day 180 accepted, past/181/`2026-02-30`/201 dates/same date in add and remove 422 and nothing saved; Toronto-vs-UTC covered by unit test around midnight (EDT and EST).
- `missing.sampleDish` satisfiable by a photo dish and reappears on deactivating the last one (tests exist).
- RLS: direct browser insert/update/delete on `dishes` and `availability` fail; select policies unchanged; pending/rejected dishes and dates invisible to anon and customers, approved shows active only.

## Judgement on the builder's known gaps
- PUT availability not transactional: acceptable for the prototype. Both statements are idempotent and a retry fixes it; validation happens before any write.
- Orphaned replaced photos and photo deleted between probe and save: acceptable (deletion needs approval; owner-writable bucket is existing, documented design). Suggest the T-034 UI tolerates a missing image.
- Clearing a booked date leaves the booking alone: acceptable now, but WO-4 must make booking creation re-check availability and decide what happens to an already booked day. Record in PLAN.md.
- Assumptions (opt-in availability, 180 days, 50 dishes, bounds) need Jimmy's nod as the builder noted.

## How to verify the fix
`npx vitest run src/lib/domain/dishes.test.ts` locally; push and read CI for `tests/api/dishes-roles-tester.test.ts`.

## What the next agent needs
Backend: fix finding 1 only, push, confirm CI green, then hand back to the tester for a quick re-check (or straight to the reviewer if the Planner agrees, since the change is one line plus tests). Planner: `npx supabase db push` after merge (migration `20261009120000`).
