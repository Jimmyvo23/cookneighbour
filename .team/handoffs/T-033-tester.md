# Handoff: T-033 Chef onboarding and profile UI (Tester)

From: tester  To: frontend

Verdict: **FAIL (one Medium finding, F1; everything else passes).** Head tested: e4d0012 (builder head c9dc892 plus my test commit).

## What changed
- Branch: `feature/T-033-chef-onboarding-ui`; PR https://github.com/Jimmyvo23/cookneighbour/pull/70 (issue #21)
- Files (tests only): `e2e-mock/chef-application-edge-mock.spec.ts` (new, 6 tests), `e2e/chef-application-real.spec.ts` (guard test now also asserts the server-rendered page body "Loading your application" is absent for signed-out and customer; before, "Display name" was never in the SSR output, so the assertion could not catch a broken guard).

## How to verify
- Local (fresh `npm ci`): lint clean, typecheck clean, `prettier --check .` clean, `npm test` 232 passed, `npm run build` ok, `npm run test:e2e:mock` 18 passed (12 builder + 6 mine; one of mine is `test.fail`, see F1).
- CI run 37791933221 on e4d0012: all green. unit 232, RLS 111, API 207, Playwright real-route 11 passed, mock 18 passed. (The run on c9dc892 was cancelled by my push; the earlier green run was a442701.)
- No Docker here, so API, RLS and real-route suites are CI evidence only.

## Findings
- **F1 (Medium, must fix): display name accepts control characters and lone surrogates.** `src/components/chef/ChefApplicationView.tsx` NameSection submit handler (about line 238) checks only `trim()` and length 1 to 80, not the shared `hasUnsafeText` (`src/lib/domain/chef-application.ts:360`). The server does no better: `PATCH /api/me` uses `Fields.string` (`src/lib/api/validate.ts:6-24`), which checks length only. Result: `Mai\u0007Tran` is saved and published as the chef's public name; a lone surrogate would hit the database. This is the "unsafe text input" row of lessons-learned section 3. Frontend fix: validate the name with `hasUnsafeText` before sending and put focus on the field (the mock `PATCH /api/me` in `src/lib/mocks/mock-adapter.ts:~440` should apply the same rule so mock and real agree). Backend gap for the Planner (not frontend scope): `PATCH /api/me` and sign-up should use the same helper (T-028 code). Test: `e2e-mock/chef-application-edge-mock.spec.ts` "display name rejects control characters" is marked `test.fail()` so CI stays green; once fixed, Playwright reports it as an unexpected pass, then delete the `test.fail()` line.
- **F2 (Low, informational): previous client pages stay mounted but hidden** (Next cacheComponents). After sign-up there are three `<h1>` inside `<main>` (two hidden). Axe is clean, but any test or script must use `main:visible`. No action.
- **F3 (Low): focus after "Remove kitchen photo".** After a successful remove the button that had focus disappears, so focus falls to the body. Not an error path, so not a lessons-learned violation; consider moving focus to the section notice. Optional.

## Checks that passed (evidence)
- Contract conformance: paths, bodies and codes match docs/api-contract.md section 5: PATCH `/api/me`, GET/PATCH `/api/chef/application`, POST/DELETE `/documents` with `{kind, path}`, POST `/submit`. 409 `APPLICATION_INCOMPLETE` shows the `missing` list (describeError), 409 `INVALID_STATE` shows the server text (11th photo tested), 422 field errors (including `kitchenAddress.line|city|postalCode`) land on the matching field, 403/404/401 have clear text. The mock adapter reuses the real pure rules (`parseUpdateBody`, `checkStoragePath`, `planPrivateChange`, `planSubmit`) and returns the same status codes and order of checks; known harmless mock differences: GTA test is `^[ML]` instead of the `postal_prefixes` table, storage objects are not probed, and `PATCH /api/me` lacks the unsafe-text rule (F1).
- Lessons section 3:
  - Server guard: `src/lib/server/page-guard.ts` runs `connection()`, then `requireCaller()` (getUser plus `profiles.role`), redirects signed-out to /login and customer/admin to /. Only chefs reach `<ChefApplicationView/>`. The view fetches its data client-side through the API, so the HTML never holds private data anyway. CI real-route test passes with the stronger assertion. The admin case is covered by the unit test of `chefPageRedirect` (role other than chef gives "/"); there is no real-route admin test because no admin fixture exists in that spec.
  - Uploads: `<uid>/<prefix>-<uuid>.<ext>`, lower-case, `upsert: false`, own folder, ids built from `/api/me`, never typed by the user (`src/lib/chef/upload.ts:90-100`, `:116-135`); the real e2e checks a second upload gets a new name.
  - MOCK badge on every check status (ID, certificate, kitchen, police in the status panel and beside each upload); tests count 3 and 4 badges.
  - Privacy and mock text matches code: documents are admin-only, profile photo is public by link, kitchen address not on the public profile, changing kitchen resets chef's home, draft acknowledgement wording labelled.
  - Focus after errors: field errors focus the first invalid field, other errors focus the alert (tests: submit too early, bad rate, wrong type, no file, too large, empty, 11th photo, unticked acknowledgement).
  - Shared helpers: bio, lists, rate, prefix, radius, kitchen address all use `parseUpdateBody` (except the display name, F1).
- Accessibility: axe zero violations on the full page, with every error state visible at 375px in dark mode (my test), with 10 kitchen photos, and in the builder's real-route spec. No horizontal scroll at 375px. Keyboard: every input, button and link inside the visible `main` is reached by Tab in order (my test, kitchen section open); the profile form is fillable and savable with the keyboard only.
- Edge cases (mock, all pass): wrong type (gif, pdf as photo), no file chosen, empty file, photo over 5 MB, document over 10 MB, 11th kitchen photo (409, message, focus, count stays 10), remove then add photo, submit twice (second is an idempotent success, no error), edit after submit (status stays "Submitted"), rejected chef sees reason and "Submit again", approved chef button disabled. Kitchen-address edit resetting chef's home is covered by the API tests (CI) and unit tests of `planPrivateChange`; the UI text states it.
- Not verified by hand: second-tab-after-log-out and real Storage behaviour for a failed registration after upload (reasoned from `UploadControl`: it shows "uploaded but not added, choose the file and try again", new name on retry).

## Builder's known gaps: judgement
- Inferred "submitted" label: **acceptable.** A pending chef only has a check out of `not_started` after submit or an admin action; a failed check re-uploaded returns to pending only for a chef who already submitted. Revisit when T-035 adds admin actions (an admin could set a check on a never-submitted chef); a real `submittedAt` flag would be cleaner.
- Meta-refresh 200 guard: **acceptable.** No private content is in the response and the page redirects; the API is the real protection. A true 307 is a nicety. Note in README.
- Draft acknowledgement wording: **acceptable for the prototype**, already labelled "Draft wording, not legal advice". Jimmy should approve or replace it (open question, not a code fix).
- Orphan files (registration fails after upload, 11th photo): **acceptable**; chefs cannot delete them by design. Already a README known limit (T-054, reviewer R5).
- No profile photo preview, "dish editor not available" wording: acceptable until T-034; remove the wording then.

## What the next agent needs
- Frontend: fix F1 (and optionally F3), delete `test.fail()` in the edge spec, run the full local suite, push, and re-hand to the tester.
- Planner: decide who fixes the `PATCH /api/me` and sign-up unsafe-text gap (backend, T-028 code); suggest a small follow-up task.

## Round 2 (head 6b7410b plus my added test)
Verdict: **PASS.**
- F1 fixed client-side: `displayNameProblem` (`src/lib/validation/auth.ts:21`) uses `hasUnsafeText`, used by the chef name section, the sign-up form (`validateSignUp`) and the mock `PATCH /api/me`. The `test.fail()` was removed and the test now passes. I added a sign-up form test (control character in "Your name": error, field focused, `aria-invalid`, stays on /signup). The server-side gap is tracked in T-059 (PR #72) and is not held against T-033.
- F3 fixed: after "Remove kitchen photo" focus moves to the "Kitchen photos" heading (`tabIndex=-1`); the builder's mock spec asserts it.
- No regressions. Fresh `npm ci`: lint, typecheck, `prettier --check .` and build clean; `npm test` 236 passed; mock Playwright 19 passed (axe, 375px, dark mode and keyboard tests included). CI run 37793629271 on 6b7410b is green (counts below in the final report); the commit that adds my sign-up test only touches `e2e-mock/`.
- Next: reviewer. Remaining Planner items: T-059 (server-side unsafe text), Jimmy to approve the draft acknowledgement wording.
