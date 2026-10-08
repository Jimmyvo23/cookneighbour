# Handoff: T-031 Chef onboarding API (round 2: tester findings folded in)

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
- The API tests could not be run locally (no Docker on the build machine). They ran only in CI: run 37719277891 (head b5bd3e2) was green on the first attempt, and run 37719779496 (head 051f976, after the handoff and three extra give-up tests) was green too: unit 160, RLS 105 unchanged, API 180 = 29 existing + 151 new in 4 files, seed twice + verify, Playwright real-route 7, mock 6. The branch was then merged with main (docs only: WO-3 and PLAN.md); the CI run on that merge is recorded in the PR.
- Storage existence uses `storage.exists` (HEAD on the object) with the service role. If a future Storage version changes that endpoint's status codes, the "object not uploaded" 404 would turn into a 500.
- PostgREST optimistic lock compares `updated_at` as the string PostgREST returned. Verified only in CI.
- A replaced ID or food-handler file stays in the private bucket (deleting needs Jimmy's approval); only kitchen photos are deleted, as specified.
- An approved chef can clear `bio` or `photoPath` and stays approved (contract allows edits; open point 6 in the contract).
- The inert trigger `chef_private_reset_checks` is untouched. It differs from the routes only in that routes also reset `failed`.
- No rate limit on the chef routes (none specified).
- `displayName` counts as missing when blank or the placeholder "New user" (my reading of the contract's `displayName` item).
- Attribution: commits carry `Co-Authored-By: Claude Sonnet 5.5` (the harness line); the Work Order text said Opus 5.5.

## Round 2: tester findings folded into PR #67 (Planner decisions)
Source: `.team/handoffs/T-031-tester.md` (committed). New migration: `supabase/migrations/20261008150000_kitchen_photos_insert_only.sql` (NOT applied to hosted; the Planner applies it after review, like the earlier ones).
- **F3 (kitchen photo overwrite).** The migration drops `kitchen_photos_update_own` and `kitchen_photos_delete_own`: a chef can only insert new kitchen-photo objects. Tests in `tests/rls/storage-hardening.test.ts` (describe "F3"): exact policy set via `pg_policies`; owner can insert and read, upsert/update/re-insert of the same name are refused and the content stays; owner delete removes nothing; admin and the service role can delete; another chef still cannot write into the folder. The privilege snapshot covers table and function grants only, so it is unchanged (storage policies were never part of it). **profile-photos and dish-photos checked:** both still let the owner update and delete. No verified check depends on those files and the chef can already point a row at a new file, so I left them and pinned that decision in a test (T-032 should revisit it knowingly). Recorded in `docs/data-model.md` (Storage) and contract open point 10.
- **F6.** The `i` flag is gone: file names must be lower case. Unit tests plus API tests pin that `ID-...`, an upper-case uuid and `.PNG` are 422. Contract rule 7 and the upload flow say so.
- **F1.** `bio` rejects NUL and other control characters (line feed, carriage return and tab are allowed). I also reject lone UTF-16 surrogates in every text field (bio, cuisines, languages, kitchen address), because the database cannot store those either. Unit and API tests (422, row unchanged).
- **F2.** Contract (PATCH) says `chefs` columns may already be saved when PATCH returns 409 after lost races. Pinned by an API test: bio and rate saved, `chef_home_enabled` switched off, kitchen address / acknowledgement / kitchen status not saved.
- **F4 (MOCK in JSON).** The contract preamble now says only submit carries `mock: true` and the UI must label every check MOCK. No code change.
- **F5.** The `contentType: null` case was a string body that `Request` gave text/plain. T1 adds a harness option `noBody` and tests a truly absent header.
- **T1-T12** (new or extended tests): T1 `src/lib/api/request.test.ts` plus an API case on every state-changing route; T2 and T3 kitchen reset when chef's home is not offered, removing and re-adding `chef_home`, and the "remove chef_home, edit kitchen, add back" bypass; T4 approved and rejected chefs on the documents routes; T5 and T8 `tests/api/chef-storage-probe.test.ts` (a spy that wraps the real `objectExists`: zero calls for foreign, malformed and already-registered paths, one call for a new path); T6 no phone, home address, email or hash in any route response of a chef with data; T7 is the F1 test; T9 10 parallel registrations, 10 stored plus 2 parallel (409 both), 5 stored plus 8 parallel (exactly 5 succeed), acknowledgement plus photo in parallel; T10 DELETE with another kind's file name is 422 and no object is deleted; T11 `tests/api/chef-visibility.test.ts` (anon and a customer cannot read a pending or rejected chef, its dishes or chef_private after edits, submit, rejection and rejected -> pending; an approved chef is visible as the control); T12 `failed` check stays failed on a same-path re-register and the row is untouched, chef's home asserted off in the photo-removal test, F2 pin.
- Counts are in the PR checks (see the CI run on the PR head). Local, no Docker: lint, typecheck, prettier, `npm test` (165 unit tests) and `npm run build` pass.
- Open for the Tester to re-verify: the F3 migration needs a fresh `supabase start` so the policies are dropped (CI does this); tell me if you want the HTTP-level 409 for the give-up path (it is covered at library level, and the mapping is the shared `ApiFailure` -> `errorResponse`).

## What the next agent needs
- Decisions applied: failed re-upload goes to pending (Planner); the kitchen reset also covers `failed` and photo removal; the first acknowledgement time is kept; an 11th kitchen photo is 409 `INVALID_STATE`; every chef route repairs missing rows; lost races retry up to 12 times then 409 `INVALID_STATE`.
- Error mapping to test: 401 no session; 403 customer, admin, or a folder that is not the caller's; 404 unregistered or never-uploaded object; 409 `APPLICATION_INCOMPLETE` (with `error.missing`) / `INVALID_STATE`; 422 with `fields` (nested keys `kitchenAddress.line|city|postalCode`); 400 content type.
- File name patterns the route enforces: `id-<uuid>.<jpg|jpeg|png|pdf>`, `food-handler-<uuid>.<same>`, `kitchen-<uuid>.<jpg|jpeg|png|webp>`, `photo-<uuid>.<same>`, all under `<chefId>/`.
- Test seam: `registerDocument`, `removeKitchenPhoto`, `patchApplication`, `submitApplication` accept an optional `{ afterRead }` hook (tests only) to change the row between read and write.
- For T-033 (Frontend): code against `docs/api-contract.md` section 5 and `src/lib/api/types.ts` only. Upload first (fresh uuid names), then register.
- For T-035 (admin queue): the admin verdict writes must change `chef_private.updated_at` (the trigger does) so the chef routes' optimistic lock notices them; approve/verify stay conditional on the reviewed paths as the contract says.
