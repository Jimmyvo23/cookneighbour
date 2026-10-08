# Handoff: T-031 Chef onboarding API

From: backend  To: tester

## What changed
- Branch: `feature/T-031-chef-onboarding-api`
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/67 (Closes #19)
- Routes (all under `src/app/api/chef/application/`):
  - `route.ts`: `GET` (own application, repairs missing rows), `PATCH` (whitelisted profile, kitchen and acknowledgement fields)
  - `documents/route.ts`: `POST` (register an uploaded ID, food-handler or kitchen photo path), `DELETE` (remove a registered kitchen photo and its object)
  - `submit/route.ts`: `POST` (send for review; moves checks to pending; `mock: true`)
- Server code: `src/lib/server/chef-application.ts` (gate `requireChef`, loading, mapping, the write helper `mutate`, route logic), `src/lib/server/storage.ts` (`objectExists`, `removeObject`, service role).
- Pure rules, no I/O: `src/lib/domain/chef-application.ts` (storage path check, N1 reset, submit plan, `missing`, PATCH body parsing) with 70 unit tests in `src/lib/domain/chef-application.test.ts`.
- Types: `src/lib/api/types.ts` gains `ApplicationMissingItem`; `ChefApplication.missing` now uses it.
- Contract and docs: `docs/api-contract.md` (sections 2, 5, 10, 12 updated, changes marked "(T-031)"), `docs/data-model.md` (reset note). No migration, so the RLS suite and privilege snapshot are unchanged.
- API tests (need local Supabase, run in CI): `tests/api/chef-application.test.ts` (auth matrix, CSRF, GET, repair, PATCH validation and saving, photoPath, kitchen reset), `tests/api/chef-documents.test.ts` (register / delete validation, resets, parallel registration, lost-race tests), `tests/api/chef-submit.test.ts`, `tests/api/chef-roles.test.ts` (JWT role claims), helpers in `tests/api/chef-helpers.ts`.

## How to verify
- Local, no Docker: `npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run build`. Expected: all pass, 160 unit tests (70 new), build lists `/api/chef/application`, `/documents`, `/submit`.
- With Docker (CI does this): `supabase start`, then `set -a; eval "$(supabase status -o env)"; set +a; npm run test:api` and `npm run test:rls` (unchanged).
- Things to try by hand (needs the dev server and a chef account): upload a file to Storage with the chef session (`<chefId>/id-<uuid>.png` in `chef-documents`), register it with `POST /api/chef/application/documents`, mark the ID check `verified` as admin in SQL, register a new ID file and see the check go back to `pending`. Send `PATCH` with a different `kitchenAddress` and see `checks.kitchen` and `chefHomeEnabled` reset.

## Known gaps or risks
- The API tests could not be run locally (no Docker on the build machine). They ran only in CI: run 37719277891 on head b5bd3e2 was green on the first attempt (unit 160, RLS 105 unchanged, API 177 = 29 existing + 148 new in 4 files, seed twice + verify, Playwright real-route 7, mock 6). The final run on the handoff commit is recorded in the PR.
- Storage existence uses `storage.exists` (HEAD on the object) with the service role. If a future Storage version changes that endpoint's status codes, the "object not uploaded" 404 would turn into a 500.
- PostgREST optimistic lock compares `updated_at` as the string PostgREST returned. Verified only in CI.
- A replaced ID or food-handler file stays in the private bucket (deleting needs Jimmy's approval); only kitchen photos are deleted, as specified.
- An approved chef can clear `bio` or `photoPath` and stays approved (contract allows edits; open point 6 in the contract).
- The inert trigger `chef_private_reset_checks` is untouched. It differs from the routes only in that routes also reset `failed`.
- No rate limit on the chef routes (none specified).
- `displayName` counts as missing when blank or the placeholder "New user" (my reading of the contract's `displayName` item).
- Attribution: commits carry `Co-Authored-By: Claude Sonnet 5.5` (the harness line); the Work Order text said Opus 5.5.

## What the next agent needs
- Decisions applied: failed re-upload goes to pending (Planner); the kitchen reset also covers `failed` and photo removal; the first acknowledgement time is kept; an 11th kitchen photo is 409 `INVALID_STATE`; every chef route repairs missing rows; lost races retry up to 12 times then 409 `INVALID_STATE`.
- Error mapping to test: 401 no session; 403 customer, admin, or a folder that is not the caller's; 404 unregistered or never-uploaded object; 409 `APPLICATION_INCOMPLETE` (with `error.missing`) / `INVALID_STATE`; 422 with `fields` (nested keys `kitchenAddress.line|city|postalCode`); 400 content type.
- File name patterns the route enforces: `id-<uuid>.<jpg|jpeg|png|pdf>`, `food-handler-<uuid>.<same>`, `kitchen-<uuid>.<jpg|jpeg|png|webp>`, `photo-<uuid>.<same>`, all under `<chefId>/`.
- Test seam: `registerDocument`, `removeKitchenPhoto`, `patchApplication`, `submitApplication` accept an optional `{ afterRead }` hook (tests only) to change the row between read and write.
- For T-033 (Frontend): code against `docs/api-contract.md` section 5 and `src/lib/api/types.ts` only. Upload first (fresh uuid names), then register.
- For T-035 (admin queue): the admin verdict writes must change `chef_private.updated_at` (the trigger does) so the chef routes' optimistic lock notices them; approve/verify stay conditional on the reviewed paths as the contract says.
