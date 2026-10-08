# Handoff: T-031 Chef onboarding API (Tester)

From: tester  To: reviewer
Round 1 verdict: **PASS** (no blockers). **Round 2 verdict (head ab0007b): PASS, see the end of this file.** 1 likely validation defect, 1 design gap outside this task, 2 small behaviour notes and a list of missing tests, all non-blocking. See "Findings" and "Missing test cases".

## What changed
Nothing in the application. I only verified. Nothing pushed, PR untouched, no test files changed (missing tests are listed below for the builder).
- Branch: `feature/T-031-chef-onboarding-api`, head `c1ee311`, same as the head of the green CI run. Branch is current with main (merge base `aca5996`).
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/67 (Closes #19)
- Files verified: `src/app/api/chef/application/{route,documents/route,submit/route}.ts`, `src/lib/server/{chef-application,storage}.ts`, `src/lib/domain/chef-application.ts` (+ unit tests), `src/lib/api/types.ts`, `docs/api-contract.md`, `docs/data-model.md`, `tests/api/chef-{application,documents,submit,roles}.test.ts`, `tests/api/chef-helpers.ts`.

## How to verify (what I ran)
1. CI: `ci` is green on PR #67, run 37720250209 (head c1ee311). Earlier runs 37719277891 and 37719779496 also green; one run was cancelled (superseded). From the log:
   - unit 13 files, **160** passed (70 are the new domain tests)
   - RLS 8 files, **105** passed (unchanged; no migration in this PR)
   - API 5 files, **180** passed = chef-application 59, chef-documents 47, chef-submit 40, chef-roles 5, auth 29 (29 existing + 151 new, matches the builder)
   - seed twice + verify ok; Playwright real-route **7** passed; mock mode **6** passed
   - No `.skip`/`.only`/`.todo` anywhere in tests. The API step prints no `stderr`, no "unhandled error" and no "storage remove failed", so no hidden 500 happened in the 180 tests. The only two stderr blocks in the whole run are the intentional ones in two older unit tests.
   - Annotations (not this PR): Node 20 deprecation for `supabase/setup-cli@v1`; `ubuntu-latest` moves to Ubuntu 26 on 2026-10-19 (watch the first CI run after that date).
2. Fresh clone of the branch (scratch space, no `.env.local`): `npm ci`, `npm run lint`, `npm run typecheck`, `npx prettier --check .`, `npm test` (13 files, 160 tests), `npm run build` all pass. Build lists `/api/chef/application`, `/documents`, `/submit`. `npm audit --omit=dev`: 0 vulnerabilities (5 high are dev-only and pre-existing; this PR changes no package file).
3. Real Next runtime smoke test (`next start` with throwaway dummy env, Supabase URL unreachable, no secrets): all five handlers answer 401 `UNAUTHENTICATED` JSON with `Cache-Control: no-store` for no cookie, a garbage cookie, a garbage `Authorization` header and a forged unsigned JWT carrying `user_metadata.role=admin`; wrong methods (PUT, GET on /documents) are 405; no 500 anywhere.
4. Ad-hoc probes of the pure rules in the scratch clone (deleted afterwards): a POST with no body and no header has a really absent `content-type` and `requireJson` rejects it; the storage path rule accepts `ID-<UPPERCASE-UUID>.PNG` (case-insensitive regex); `parseUpdateBody({bio:"a\u0000b"})` returns no error; `__proto__` in a JSON body shows up as an own key and is rejected as an unknown field.
5. Secret scan of the PR diff (JWT-like strings, `sb_secret`, service-role strings, passwords): nothing.
6. Not run: the API and RLS suites locally (no Docker on this machine; CI is the evidence), Playwright locally (the PR changes no UI).

## Conformance, route by route (code read + the test that asserts it)
Contract section 5 and section 2 against `src/lib/server/chef-application.ts` and the three route files.
- **Gate (`requireChef`)**: `getUser()` then `profiles.role` from the database (401 / 403), service-role client built after the role check, row repair after the role check. Asserted: 401 and 403 (customer, admin) for all 5 handlers; role check beats the content-type check (customer + text/plain = 403); customers and admins never get chef rows; chef-roles.test.ts first proves the token really carries `role: admin` in user and app metadata, then shows a customer with admin claims is still 403, a customer with chef claims is 403 and gets no rows, a chef with admin claims is still a chef, a real admin with chef metadata is 403.
- **GET**: exact default body asserted with `toEqual`; `missing` order matches the contract (also unit-tested for the empty application); no `hash|phone_e164|updated_at|chef_id|profile_id` and no email in the body; repair of both rows, of one row, two simultaneous first requests, and repair on PATCH.
- **PATCH**: 17 forbidden keys each 422 with `fields.<key>` and the row unchanged (including `updated_at`); all-errors-at-once with the nested `kitchenAddress.*` keys; rate bounds 499/500/20000/20001; location options; non-GTA prefix and non-GTA kitchen postal code; lower-case accepted and normalised; acknowledgements only `true`; server clock stamp and first time kept; validation failure writes nothing; photo path: own folder ok, never uploaded 422, wrong bucket 422, foreign folder 403 even with a valid second field (bio not saved), 11 traversal/odd paths 422.
- **POST documents**: unknown key, bad kind (7 values), bad path (6 values), name/extension not fitting the kind (9 cases), 12 traversal/odd paths, foreign folder 403 for all three kinds whether the object exists or not, never uploaded 404, wrong bucket 404 (both directions), reset matrix, same path again is a no-op, replaced object stays in Storage, 11th photo 409 `INVALID_STATE`, re-registering at the limit still 200.
- **DELETE documents**: other kinds 422, bad paths 422, foreign folder 403 and the victim's photo, registration, kitchen check and chef's home untouched, unregistered 404 and the uploaded object is NOT deleted, registered path removes registration and object and resets, dangling registration can be cleaned up.
- **POST submit**: 409 `APPLICATION_INCOMPLETE` with the exact `error.missing` list for a new chef, with kitchen items added, and for each of the 12 single breakers (displayName placeholder, blank bio, no photo, ..., phone, no active dish) plus dish without photo, another chef's dish, and each kitchen item; 200 with `mock: true`; every starting status for ID, food handler and kitchen (with and without chef's home); police and `chef_home_enabled` untouched; idempotent (the whole `chef_private` row equal including `updated_at`); rejected -> pending with reason cleared and `failed` restarted while `verified` stays; approved -> 409 `INVALID_STATE` even when incomplete; body ignored, `status: approved` in the body ignored.
- **CSRF**: PATCH, POST documents, DELETE documents, POST submit each reject `text/plain`, form, multipart, `application/json-evil` with 400 `BAD_REQUEST`; malformed and non-object JSON 400. (The `null` / "missing" case does not really test a missing header, see Finding 5.)

## Re-verification reset rules (item 5)
Every starting status (`not_started`, `pending`, `verified`, `failed`) is exercised through the real routes for: ID register, food-handler register, kitchen photo add, kitchen photo remove, kitchen address PATCH, and submit. Expected results asserted: `verified` and `failed` -> `pending`, `not_started` and `pending` unchanged; `failed` -> `pending` is explicitly covered (the Planner decision). Kitchen photo add and kitchen address change set `chefs.chef_home_enabled` false for all four statuses (the DB value is read back); photo removal asserts it for `verified`. Changing a document leaves the kitchen, the other document, the police check and chef's home alone, and the reverse; unrelated edits reset nothing. The DB trigger `chef_private_reset_checks` is inert for service-role writes (`auth.uid()` is null, it returns early), so these tests really test the route logic and not the trigger.

**Optimistic-lock tests: deterministic and meaningful.** They use the `afterRead` hook to make a MOCK admin verdict land between the read and the write. Without the lock the first write would succeed with the stale plan and leave the admin's `verified` over a changed file; with the lock the write matches 0 rows, the state is re-read and the plan is rebuilt. The assertions that tell the two apart are `kitchen_status == pending` (photo add, address change, removal), `id_check_status == pending` (ID swap), and `id verified` kept while `food_handler pending` (submit never overwrites). `expect(reads).toBe(2)` pins the single retry. The hook runs on the read side, so there is no timing, sleep or thread race; consecutive `updated_at` values differ by a full database round trip. The four give-up tests (register, PATCH, photo removal, submit) make every attempt lose (`reject_reason` changes each time), assert the `INVALID_STATE` code and that nothing was registered / started / deleted (for removal, the photo and its object are still there). The 6-parallel registration test is a probabilistic detector (an invariant: all 6 stored, all 200), not a deterministic one; fine as a complement. Limits: they call the library functions, so the HTTP 409 mapping of the give-up is not asserted; and the 12-attempt sizing for 10 parallel photos is argued in the contract but only 6 are tested (Missing T9).

## Findings
Severity: B = blocker, S = should fix before the Reviewer closes (cheap), N = note.

1. **S (likely defect, not run: no Docker). A NUL character in `bio` probably gives 500, not 422.** `parseUpdateBody` checks control characters for cuisines, languages and the kitchen address, but `bio` only checks type and length (probe: `parseUpdateBody({bio:"a\u0000b"})` returns `errors: {}`). PostgreSQL cannot store `\u0000` in text (error 22P05, "unsupported Unicode escape sequence"), so PostgREST answers 400 and the route throws -> 500 `INTERNAL`. No leak and no data change, but it breaks the "validate before touching the database" rule (contract section 2, rule 10). Fix: reject `\u0000` (and control characters other than `\n`, `\r`, `\t`) in `bio`. Test to add (it should fail today):
   ```ts
   const r = await chef.b.call(patchApp, { method: "PATCH", body: { bio: "a\u0000b" } });
   expect(r.status).toBe(422); expect(r.body.error.fields.bio).toBeTruthy();
   ```
   Lone surrogates (`\ud800`) in any text field may behave the same; unverified.
2. **N (behaviour). PATCH is not atomic when it gives up with 409.** `mutate` writes `chefs` columns first and the conditional `chef_private` update second. If the second loses 12 races, the request answers 409 "try again" but `bio`, rate and the other `chefs` fields from the same request are already saved (the retry is idempotent, so harm is nil). The give-up test asserts only that the kitchen address was not saved, not what happened to the `chefs` fields. Either document it in the contract or make the test pin it.
3. **S/Planner (design gap, outside T-031's code, but it defeats the reset rule). A chef can overwrite an already verified kitchen photo in place.** `supabase/migrations/20261007221003_storage_buckets.sql` gives the chef `UPDATE` (`kitchen_photos_update_own`) and `DELETE` (`kitchen_photos_delete_own`) on the `kitchen-photos` bucket. With the same object name and `upsert: true` (or delete then insert), the content changes with no API call, so `kitchen_status` stays `verified` and `chef_home_enabled` stays true over a different image. The N1 reset only watches path changes. `chef-documents` is insert-only for the chef, so ID and food-handler files cannot be swapped this way. This is CLAUDE.md 6.7 ("admin reviews them before the option is enabled"). Not tested anywhere (RLS tests only check that another chef cannot overwrite). Needs a Planner decision: drop the chef UPDATE/DELETE policies on `kitchen-photos` in a later migration (the route already deletes with the service role), or record it as an accepted MOCK limit. Not caused by this PR; I did not change anything.
4. **N (MOCK honesty, for the Reviewer).** The contract preamble says responses must say a check is MOCK. Only `POST /submit` carries `mock: true`. `GET`, `PATCH` and the documents routes return `checks` (ID, food handler, kitchen, police) with no machine-readable flag; the label lives in type comments and code comments. This matches the explicit shapes in the contract, so it is not a violation, but T-033 must label every check in the UI, and the contract could say "UI labels, not the JSON".
5. **N (test mislabel).** The "missing content type" case passes `contentType: null` to the harness, but `new Request(url, { method, body: "<string>" })` adds `text/plain;charset=UTF-8` itself (I confirmed it), so the case duplicates `text/plain`. `request.test.ts` has the same pattern (`req(null)` also passes a string body). A truly absent header is rejected by the code (probe), but no test proves it. See Missing T1.
6. **N.** The storage path regex has the `i` flag, so `ID-<UPPERCASE-UUID>.PNG` is accepted (probe). The contract lists lower-case patterns. Harmless (names are exact and the object must exist), but pin the intended behaviour in a unit test or drop the flag.
7. **N (already in the contract, open point 9).** No rate limit on the chef routes; each register call does a Storage `HEAD`. Also open point 6 (an approved chef can clear `bio`/`photoPath`) and 7 (replaced ID/food-handler objects stay in the private bucket). A replaced or cleared profile photo also stays reachable by its public URL in `profile-photos`.
8. **N (pre-existing, T-028).** `requireCaller` turns any `getUser()` error, including a Supabase outage, into 401 `UNAUTHENTICATED`, so an outage looks like a sign-out.

## Missing test cases (none were added; list for the builder, priority order)
- T1 Truly absent `Content-Type`: unit test with `new Request(url, { method: "POST" })` (no body) for `requireJson`; API test calling `submit` with no body and no header (a browser `fetch(url, {method:"POST"})` does exactly this) -> 400 `BAD_REQUEST`. Needs a harness option that really omits the header (no body).
- T2 Kitchen reset while `chef_home` is not offered: PATCH the address / add a photo with `locationOptions: ["customer_home"]` and a verified kitchen with `chef_home_enabled: true` -> check `pending` and chef's home false. Today only photo removal is covered in that situation, and only for the check status (the "removing a photo while the kitchen check is %s" test uses a default chef). This is the "remove chef_home, edit the kitchen, add chef_home back" bypass.
- T3 Contract sentence untested: removing `chef_home` from `locationOptions` does not touch `chef_home_enabled` or the kitchen check (and adding it back needs no admin). No test PATCHes a removal.
- T4 Approved and rejected chefs on the documents routes: registering a new ID / food handler / kitchen photo keeps `status` `approved` (N5) or `rejected`, resets the check. Today only PATCH `bio` is tested for these statuses.
- T5 "No storage call" claims: re-register a stored path whose object was deleted -> 200 (documents and kitchen photo); PATCH `photoPath` equal to the stored one with the object deleted -> 200. Existing tests upload the object first, so a regression that calls `exists` again would pass.
- T6 No leak for a chef with data: use `readyChef`, set a home address with `PUT /api/me/address`, then assert the bodies of GET, PATCH, POST/DELETE documents and submit contain none of the phone digits (full or masked), `address_line`, the email, or `hash`. The current test uses a chef with no phone and no address.
- T7 NUL in `bio` -> 422 (Finding 1; fails today if my reading is right).
- T8 "403 without probing storage": mock `@/lib/server/storage` and assert `objectExists` is not called for a foreign folder on POST, DELETE and PATCH. The current tests only show the same 403 for existing and missing files, which a probing implementation that ignores the result would also pass. (Code order is correct: the path check runs before any storage call.)
- T9 Concurrency at the limit: 10 parallel registrations from an empty list -> all 200; 10 stored + 2 parallel -> exactly 409 for both; also a parallel PATCH acknowledgement plus a registration (different columns, must both survive).
- T10 Route-level `DELETE` with `kind: "kitchen_photo"` and an `id-...` or `photo-...` path of the chef -> 422 and that object is not deleted (unit-covered for the rule, not at the route).
- T11 After the routes run, an anonymous client still cannot read a `pending` or `rejected` chef from `chefs`, including after submit and rejected -> pending (CLAUDE.md section 10, "pending or rejected chefs must never appear in search"). There is no public `/api/chefs` route in this branch, so test at the RLS level.
- T12 Small gaps: assert `chef_home_enabled` false in the four-status photo-removal test; `failed` + re-register the same path stays `failed`; no-op register leaves `updated_at` unchanged; PATCH 409 give-up with `bio` + `kitchenAddress` pins Finding 2; pin the uppercase path decision (Finding 6).

## CLAUDE.md section 10 and 6.7 against chef onboarding
Covered: non-GTA postal codes (service prefix and kitchen address), pending/rejected cannot be made approved by the chef (status and chefHomeEnabled keys are 422, submit ignores the body, rejected only goes to pending), unauthorized access to another chef's files and rows (folder 403, own rows only, role gate), chef's-home only after admin review (chef cannot set `chefHomeEnabled`, any kitchen change switches it off), police check never writable by the chef, ID / food handler / allergen acknowledgement / sample dish with photo / kitchen photos / hygiene acknowledgement all required by `missing`, MOCK phone verified required. Not applicable yet (WO-4/WO-5): double booking, cancellations, receipts, free trial, the accepted-booking kitchen-address change (N3, recorded in the contract, no bookings exist). Untested but applicable: T11 and Finding 3.

## Known gaps or risks
- I did not run the API or RLS suites myself; the evidence is the green CI run on the exact head commit plus code reading. Finding 1 is reasoned from PostgreSQL behaviour, not observed.
- Storage `exists` depends on the HEAD status codes of the Storage API (builder's note); the installed `@supabase/storage-js` 2.117.3 maps 400 and 404 to "missing" and rethrows anything else, which matches the 404 tests in CI.
- The handoff file is not committed (the Planner commits handoffs).

## What the next agent needs
- Reviewer: focus on Findings 1, 3 and 4. 2, 5 to 8 are notes. The builder's own list of risks (updated_at string compare, orphaned ID files, approved chef clearing bio) is accurate; I found nothing the handoff left out except the items above.
- Planner: decide Finding 3 (kitchen photo overwrite) and whether the builder folds Finding 1 and tests T1 to T9 into this PR or a follow-up. If they go into this PR, I will re-verify on request (CI run plus a re-read of the diff).
- T-033 (Frontend): the contract is accurate against the code. Remember Finding 4 (label every check MOCK in the UI), upload with a fresh uuid name and register after, expect nested keys `kitchenAddress.line|city|postalCode`, 409 `APPLICATION_INCOMPLETE` carries `error.missing`, and an 11th kitchen photo is 409.
- T-035 (Admin): the admin verdict writes must change `chef_private.updated_at` (the trigger does); keep the conditional-on-reviewed-paths rule. Finding 3 interacts with the swap-while-pending protection.


---

# Round 2 (re-verification of head ab0007b)

From: tester  To: reviewer
Verdict: **PASS.** Every round-1 finding and every listed missing test is fixed or covered, the tests can fail, and no new defect found. Three small notes below, none blocking.

## What I ran
1. CI: `ci` green on PR #67, run 37722340651, head ab0007b (matches the PR head). Unit **165** (13 files), RLS **111** (8 files; `storage-hardening` 15 tests), API **207** (7 files: chef-documents 60, chef-application 65, chef-submit 40, auth 29, chef-storage-probe 6, chef-roles 5, chef-visibility 2), seed + verify ok, Playwright real-route 7, mock 6. No skipped tests. The only stderr blocks are the two intentional ones in older unit tests; the API and RLS steps print no stderr and no "unhandled error".
2. Fresh checkout of the new head in the scratch clone: `npm ci`, lint, typecheck, `prettier --check .`, `npm test` (165), `npm run build` (the three chef routes listed) all pass.
3. Read every changed file: the migration, the RLS F3 tests, the new and extended API tests, the new unit tests, the source diff of `chef-application.ts`, and the contract and data-model diffs.
4. Mutation tests (unit level, in the scratch clone, reverted after each): every mutation turned a test red.
   - remove the bio control-character check: 2 tests red (F1 bio test and the surrogate test, which also covers bio)
   - lone-surrogate test replaced by `false`: 1 red
   - loosen the control range so NUL is allowed in bio: 1 red
   - restore the `i` flag on the file-name regex: 1 red (the F6 test)
   - `failed` no longer resets to `pending`: 5 red
   - `requireJson` accepts an absent header (`if (!raw)` -> `if (false)`): 2 red (T1 unit tests)
   - submit overwrites `verified`/`pending` checks: 4 red
   - `MAX_KITCHEN_PHOTOS` 10 -> 11: 1 red
   I could not run mutations against the API and RLS suites (no Docker). For those I reasoned from the test bodies what each mutation does: removing the `.eq("updated_at")` lock leaves `verified` over a changed file and the hook-based race tests fail; calling `objectExists` before the path check fails the spy tests (zero calls expected); restoring the two kitchen policies fails the exact `pg_policies` list and the overwrite/delete tests; dropping the route's reset fails the reset matrix. CI is the run evidence.

## F3: kitchen photos insert-only (migration `20261008150000_kitchen_photos_insert_only.sql`)
- Migration drops exactly `kitchen_photos_update_own` and `kitchen_photos_delete_own`. File name sorts after the last migration. Not applied to hosted (Planner applies after review, as before).
- RLS tests ("F3", 6 tests): the exact policy set from `pg_policies` (chef insert; owner, admin and customer read; admin delete), so any extra or missing policy fails; the owner inserts a new name and reads it back; `upload` with `upsert: true`, `update` and a second plain `upload` of the same name are all refused and the stored size stays 4 bytes (the test writes a 9-byte body so a swap would show); the owner's `remove` removes nothing and the file stays; the admin delete still works (1 object removed, then not downloadable); the service role (used by the route's DELETE) still deletes; another chef still cannot write into the folder. All confirmed green in CI. Chef documents were already insert-only.
- Judgement: the fix closes the in-place swap, and the remaining paths (new name = new path = reset) are covered by the route tests. Note: with no delete right, a chef cannot clean up files they uploaded but never registered; those orphans stay until an admin or service-role cleanup, and each upload is up to 5 MB. On a free-tier project that is a storage-quota nuisance, not a security issue; worth one line in the README known limits or a later cleanup task. T-033 should always upload with a fresh name and `upsert: false`.

## F1, F6, F2, F4, F5
- F1: bio rejects NUL and control characters except LF, CR and tab; lone UTF-16 surrogates are refused in bio, cuisines, languages and both kitchen address text fields. Unit tests (including real emoji and accents accepted) and an API test (422, `fields.bio`, row unchanged, multi-line bio saved). Mutations above prove the unit tests bite. The surrogate regex works on code units; I checked the valid pair, high-high-low and low-high cases are handled by the tests.
- F6: `i` flag removed; unit and API tests pin `ID-`, upper-case uuid, `.PNG`, `.JPG`. Contract rule 7 says lower case.
- F2: contract documents that the `chefs` columns may be saved when PATCH returns 409; an API test pins it (bio and rate saved, `chef_home_enabled` off, kitchen address, acknowledgement and kitchen status not saved). Error list in the contract now names 409.
- F4: contract preamble now says only submit carries `mock: true` and the UI must label every check MOCK (T-033, T-036).
- F5: harness option `noBody` really omits the header and body; used on all four state-changing routes (400 `BAD_REQUEST`), plus unit tests with a bare `new Request(url, {method})`.

## T1 to T12 coverage (each read in the test body, not just the title)
| Gap | Covered by | Can fail? |
|---|---|---|
| T1 absent Content-Type | `request.test.ts` (POST, PATCH, DELETE bare); API case on every state-changing route with `noBody` | yes, mutation M5 |
| T2 kitchen reset when chef_home not offered | PATCH address with `["customer_home"]`; photo add with `["customer_home"]`; both assert check pending and `chef_home_enabled` false in the DB | yes (the setup puts `chef_home_enabled: true` and `verified`) |
| T3 remove chef_home / add back | PATCH removal and re-add keep `verified` and `chef_home_enabled`; plus the bypass test: remove, change the kitchen, add back -> pending and off | yes |
| T4 approved and rejected chefs on documents routes | `describe.each(["approved","rejected"])`: ID and food-handler resets, kitchen photo resets and chef's home off, `status` and `rejectReason` unchanged | yes |
| T5 no storage call for stored paths | `chef-storage-probe.test.ts`: object deleted, re-register ID, food handler, kitchen photo and PATCH same `photoPath` all 200 with zero calls; a different missing path still 404 with one call | yes (spy wraps the real function; control test shows the spy sees calls) |
| T6 no leak with real data | readyChef with chef's home, verified phone and a home address; six responses (GET, PATCH, POST documents, submit, DELETE, submit 409) checked for the full number, the last digits, the masked form, email, street, home postal code, `phone_e164`, `address_line`, `hash` | yes |
| T7 NUL in bio | API test (F1) with six bad bios and four other fields | yes |
| T8 foreign path never reaches Storage | spy: zero calls for foreign folders on POST, DELETE and PATCH (existing and ghost files), for malformed paths on all three, and for DELETE | yes |
| T9 concurrency at the limit | 10 parallel from empty (all 200, all stored); 10 stored + 2 parallel (both 409, unchanged); 5 stored + 8 parallel (exactly 5 ok, 3 409, 10 stored); acknowledgement + photo in parallel (both survive). Outcomes are fixed by the invariant, not by timing, and 12 attempts exceed the 9 possible losses for 10 parallel | yes |
| T10 DELETE with another kind's name | id- and photo- names in four buckets, kind `kitchen_photo`: 422 and all four objects still exist, registration unchanged | yes |
| T11 pending/rejected invisible | `chef-visibility.test.ts`: anon and a signed-in customer cannot read the chef row or its dishes in six states (complete, edited, submitted, rejected, rejected then edited, rejected -> pending), `chef_private` closed to anon; control: approved is visible, so the probes can fail | yes |
| T12 smaller gaps | `chef_home_enabled` asserted off in the four-status photo-removal test; `failed` stays `failed` on a same-path re-register for ID, food handler and kitchen, whole row equal including `updated_at`; F2 and F6 pins | yes |

Still only at library level: the HTTP 409 for the give-up path (the mapping is the shared `ApiFailure` -> `errorResponse`, already unit-tested for status codes). The builder offered an HTTP-level test; I do not need it.

## Profile and dish photo buckets left owner-writable (contract open point 10): acceptable
Reasoning: (1) No MOCK check refers to those files, so an in-place overwrite does not invalidate a verdict; the chef can already point the row at any new file with PATCH `photoPath`, even as an approved chef (open point 6), so an overwrite adds no power. (2) Keeping owner delete is useful: it is how a chef removes an old public profile photo, which I flagged in round 1 as staying reachable by URL. (3) The decision is written down in `docs/data-model.md`, the contract and a pinned test (`DECISION: profile-photos and dish-photos stay owner-writable`), so T-032 changes it knowingly. Residual risk, already open and not a T-031 matter: no review of public photo content after approval. I accept it for the prototype.

## Notes (non-blocking)
- N-a: orphan kitchen files cannot be deleted by the chef any more (see F3 judgement). README known-limit candidate.
- N-b: the F3 migration is not applied to the hosted project yet; the API tests rely on CI's fresh `supabase start`. The Planner must apply it with the other migrations.
- N-c: still true from round 1: no rate limit on the chef routes (open point 9); an outage looks like a sign-out (T-028). The kitchen-address-while-accepted-booking case (N3) waits for WO-4.

## What the next agent needs
- Reviewer: findings F1 to F6 and T1 to T12 are closed; the new risk surface is only the migration (two `drop policy` lines) and the extra validation. The privilege snapshot is unaffected (storage policies were never in it).
- Planner: apply `20261008150000_kitchen_photos_insert_only.sql` with the others; add the orphan-upload limit to the README known limits (T-054).
- T-033: upload with a fresh lower-case uuid name and `upsert: false`; label every check MOCK in the UI (JSON carries no flag except submit).
