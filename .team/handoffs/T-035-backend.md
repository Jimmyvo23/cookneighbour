# Handoff: T-035 Admin chef-queue API

From: backend  To: tester

## What changed
- Branch: `feature/T-035-admin-chef-queue-api`
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/79 (Closes #23). CI run 37840403383 green on head 46a68dc (unit 412, RLS 118, API 315, Playwright real routes 18, mock 39).
- Routes (contract v1.2 section 6): `GET /api/admin/chefs`, `GET /api/admin/chefs/:id`, `POST .../approve`, `POST .../reject`, `PATCH .../checks` (MOCK), `POST .../kitchen-review` (MOCK).
- Files:
  - `src/app/api/admin/chefs/route.ts` and `[id]/route.ts`, `[id]/approve|reject|checks|kitchen-review/route.ts` (thin handlers)
  - `src/lib/server/admin-chefs.ts` (requireAdmin gate, list, detail with signed URLs, decision calls, MOCK checks)
  - `src/lib/domain/admin-chefs.ts` and `.test.ts` (query, cursor, reason, checks and kitchen-review parsing; 24 unit tests)
  - `supabase/migrations/20261010120000_admin_chef_decisions.sql` (three functions, see below)
  - `src/lib/api/types.ts` (`AdminChefListQuery.checks`, `KitchenReviewRequest.reviewedAddress` may be `null`)
  - `docs/api-contract.md` (v1.2, section 6 rewritten, route table, open points 11 to 13), `docs/data-model.md` (decision functions note)
  - Tests: `tests/api/admin-helpers.ts`, `admin-chefs-access.test.ts`, `admin-chefs-decisions.test.ts`, `admin-chefs-checks.test.ts`, `tests/rls/admin-decisions.test.ts`, `e2e/admin-real.spec.ts`, `e2e/helpers/local-admin.ts`, `playwright.config.ts` (spec skipped without the local stack)

## Design choice: atomic approve (and reject, kitchen review)
The REST API cannot lock or compare across `chefs`, `chef_private`, `profile_private`, `dishes` and storage in one statement. An optimistic `updated_at` fence would cover only `chef_private`, and a dish deactivated or a bio cleared between the read and the write would still be approved (T-031 R2). So each multi-table decision is one `SECURITY INVOKER` plpgsql function (`admin_approve_chef`, `admin_reject_chef`, `admin_review_kitchen`), called with the service role after the route's `profiles.role = 'admin'` check:
- takes `FOR NO KEY UPDATE` locks on the chef's `chefs` row and then `chef_private` row (same order everywhere; it still lets a chef add a dish), share-locks the sample dishes, re-reads everything under the locks, decides, writes and inserts the `notifications` row in one transaction;
- approve: status must be `pending`; the same rules and item names as `computeMissing` (SQL mirror) plus "the stored object exists" in `storage.objects` (profile photo, ID, food handler, sample dish photo, at least one kitchen photo when chef's home is offered); then `id_check_status` and `food_handler_status` must still be `verified`; then `reject_reason = null` (bumps `updated_at`, so a chef write that read the old row retries) and `status = 'approved'`;
- kitchen review: the B1 comparison (photos set-equal via `@>` and `<@`, address equal or both absent) is inside the transaction, before the approve preconditions;
- EXECUTE revoked from public, anon and authenticated, granted to `service_role` only; no SECURITY DEFINER; `search_path = ''`.
- MOCK checks (`PATCH .../checks`) is one conditional UPDATE with the reviewed paths in the WHERE clause (no function needed); the trigger bumps `updated_at`.
- Drift guard: a test breaks each approve rule on its own, and all at once, and compares the function's `missing` list with the chef's own `missing` (computeMissing).

## Migration
`20261010120000_admin_chef_decisions.sql`: adds the three functions only. No table, column, policy or data change, so it is safe on hosted data. Applied to the CI local stack. **Not pushed to hosted**: the Planner runs `npx supabase db push` after merge (lessons-learned section 5).

## How to verify
- `npm run lint && npm run typecheck && npm test` (412 unit tests, 24 new)
- With the local Supabase stack: `eval "$(supabase status -o env)"; npm run test:rls` (118, 3 new) and `npm run test:api` (315; 54 new in the three `admin-chefs-*.test.ts` files), `npm run test:e2e` (18, 1 new)
- No Docker on the builder's machine, so RLS, API and Playwright real-route suites ran in CI only (run 37840403383).

## Known gaps or risks
- Approve and `computeMissing` rules exist in two places (SQL and TypeScript); a test compares them, but a new rule needs both (contract open point 11). Future change = new migration with `create or replace function`.
- Approve says `missing: ["idDocument"]` when the file object is gone, while the chef's own `missing` (submit rule) does not check objects. Documented.
- An admin can set a MOCK check back to `not_started` or `pending`; kitchen review is allowed for chefs of any status; `checks=pending` ignores the police check (open points 12 and 13). None of these is a requirement.
- Not built: `submittedAt` field (R-note "consider"); the notification read API (WO-5); mock adapter routes for the admin API (T-036).
- A chef who swaps a file right after approval stays approved with the check reset to `pending` (accepted, N5, tested).
- Signed URLs are returned in the response body only (`no-store`, never logged); an unreadable object is left out of `documents`.
- The seeded demo admin needs `SEED_ADMIN_PASSWORD` (Jimmy); the e2e admin is created per test on the local stack only.

## What the next agent needs (Tester, then T-036 Frontend)
- Tester: please try the interleavings the tests only sample (approve vs swap, approve vs reject, kitchen approve vs chef photo add), the cursor with chefs created in the same millisecond, and `status=all&checks=pending` at 50 per page. Check the log lines (`api: admin <action> admin=<id> chef=<id>`) never carry reasons, emails or URLs.
- Frontend (T-036), from contract section 6:
  - List: `GET /api/admin/chefs?status=pending|approved|rejected|all&checks=pending&limit=&cursor=`; items have `checks` (MOCK badge on every status), `chefHomeEnabled`, `locationOptions`, `createdAt`.
  - Detail: `application` (same shape as the chef's), `email`, `documents[]` with `kind`, `path`, `url`, `expiresInSeconds: 300`. Fetch again if the admin waits longer than 5 minutes; show a document as "not available" when its path is in `application.documents` but absent from `documents`.
  - Send back the paths the admin viewed: `idDocumentPath`/`foodHandlerPath` with `idCheck`/`foodHandlerCheck`; `reviewedPhotoPaths` and `reviewedAddress` (`null` when `application.kitchenAddress` is null) for the kitchen. A 409 `INVALID_STATE` from these means "the chef changed it after you opened it: reload".
  - Approve errors: 409 `APPLICATION_INCOMPLETE` (`error.missing`) or 409 `INVALID_STATE` (message says which check is not verified, or that the chef is not pending). Reject needs `reason` 3 to 500 characters; the reason is shown to the chef.
  - Every state-changing call must send `Content-Type: application/json`, even approve with no body.
  - `/admin/*` pages need a server guard like `src/lib/server/page-guard.ts` (admin variant); `/chef` raw HTML for a signed-in admin is already tested in `e2e/admin-real.spec.ts` (helper `e2e/helpers/local-admin.ts`).
  - T-034 reviewer finding 1: the `src/app/chef/layout.tsx` comment is still inaccurate; not touched here (UI file).
