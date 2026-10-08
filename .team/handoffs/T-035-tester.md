# Handoff: T-035 Admin chef-queue API (Tester)

From: tester  To: planner (reviewer next)

## Verdict: PASS (no blocking findings)

- PR #79, branch `feature/T-035-admin-chef-queue-api`. Verified head `5d7b5e0`; tester added one test file, new head `a5c9195`.
- CI run **37846158546** on head `a5c9195`: success. Unit 426 (412 + 14 new), RLS 118, API 315, Playwright real routes 18, mock 39. Earlier run 37842999861 on `5d7b5e0`: success.
- Local: lint clean, `npm run typecheck` clean, `npm test` 426 passed (25 files), `npm run build` OK (all 7 admin API routes present). No Docker locally, so RLS/API/Playwright were checked from CI logs only.
- Note: one local `npm test` run had 4 timeouts in `src/lib/mocks/mock-adapter*.test.ts` while two vitest runs overlapped on the machine; re-run alone it passed (426/426, 24 s). Not a code problem.

## Tests added (tests only)
`src/lib/domain/admin-chefs-guards.test.ts` (14 tests, no database):
1. SQL approve items == `computeMissing` items, same order (16 each). Mutation-checked: renaming `'sampleDish'` in the SQL made it fail; restored.
2. Migration: exactly 3 functions, no SECURITY DEFINER, `search_path = ''` x3, revoke from public/anon/authenticated and grant to service_role only (3 grants), no create/alter/drop table/policy/trigger/index, no delete, writes limited to 4 decision columns + `notifications` insert, lock order chefs then chef_private with `for no key update`. Mutation-checked (security/search_path change fails).
3. Source guards: six route files each call `requireAdmin()` as first await; one `createAdminClient()` call, after the role check; no JWT metadata/getSession in server code or routes; a single `console` call (`api: admin <action> admin=<id> chef=<id>`) with fixed action names; signed URL lifetime 300 s and never logged.
4. Extra cursor tampering cases (whitespace, newline, 7-digit fraction, `+0000`, `%2B`, injected filter text, uppercase id, oversize).

## Checked and found correct (reading code + CI results)
- Gate: `requireCaller` uses `getUser()` + `profiles.role`; 401 anon, 403 customer/chef on all six routes and unknown ids (access test lines 65-145); admin JWT-metadata test both ways; service role created after the gate.
- Migration: SECURITY INVOKER, search_path '', EXECUTE service_role only (also an RLS test calls as anon/customer/chef/admin); functions only, no data change, safe on hosted. `create function` (not `create or replace`) is fine for a first apply.
- Approve/reject/PATCH/kitchen review/list/detail: each rule, race and B1 case in the task list is covered by an existing CI-passing API test (decisions test 52-441, checks test 31-252 and 253-677, access test 147-456), including approve vs swap, approve vs reject, double approve, kitchen vs chef photo add, cursor injection and other forms of bad cursor, `checks=pending`, signed URL only for own file names/right bucket, no-store, log content.
- Contract v1.2 section 6 and `src/lib/api/types.ts` match the code: order of checks (401, 403, 400, 404, JSON, unknown keys, fields, state), error codes, `reviewedAddress: null`, `checks?: "pending"`.
- `e2e/helpers/local-admin.ts` refuses unless `API_URL` hostname is exactly `127.0.0.1` or `localhost` and uses `API_URL`/`SERVICE_ROLE_KEY` (not the app's hosted env names); the spec is skipped without the local stack. It cannot create an admin on hosted.

## Findings (all Low, none blocking)
1. Low, `supabase/migrations/20261010120000_admin_chef_decisions.sql:65-66` vs `src/lib/domain/chef-application.ts:298-300`: SQL uses `btrim` (spaces only), TypeScript uses `trim()` (tabs/newlines too) for display name and bio. Not reachable today: bio is trimmed on write (`chef-application.ts:424`) and unsafe text is refused; display name goes through signup validation. Worth remembering if another writer is added; any change needs a new migration.
2. Low, `tests/api/admin-chefs-decisions.test.ts:158-215`: the drift test only catches a rule added on one side if the new rule is also added to `BREAKS` or trips in the "all broken at once" fixture. My new static test closes this (item list and count of 16 are compared directly).
3. Low (already documented as open points 12 and 13): admin can set a MOCK check back to `not_started`/`pending`; kitchen review allowed for chefs of any status (kitchen approve can set `chef_home_enabled` on a pending chef); `checks=pending` ignores police. Not requirements; Planner may want a decision before T-036 builds the UI.
4. Info: DB error text is put in thrown messages (`${fn} failed: ${error.message}`) and logged by `handle()` (`errors.ts`). Our functions raise no custom messages with user data, so nothing sensitive is expected; keep it that way.
5. Info: T-034 reviewer finding 1 (`src/app/chef/layout.tsx` comment inaccurate) is still open, not part of T-035.

## Not verified here
- Real concurrency interleavings beyond what the CI tests sample (no local Docker). Same-millisecond `created_at` ties rely on the `profile_id` tie-break plus the keyset filter; the pagination test covers 5 chefs created in sequence, not an exact tie.
- Hosted behaviour (migration not pushed; Planner runs `npx supabase db push` after merge).

Handoff file is NOT committed (per instructions).
