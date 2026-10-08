# Handoff: T-033 Chef onboarding and profile UI

From: frontend  To: tester

## What changed
- Branch: `feature/T-033-chef-onboarding-ui`
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/70 (Closes #21)
- New page `/chef/apply`: `src/app/chef/apply/page.tsx` (server guard inside Suspense) and `src/lib/server/page-guard.ts` (`requireChefPage`: session from getUser, role from profiles.role, `connection()` first so it never runs at build time; redirect to /login or /; skipped only in MOCK API mode, where no server session exists).
- UI: `src/components/chef/ChefApplicationView.tsx` (status panel, display name, profile and service area, profile photo, ID and Food Handler uploads, kitchen address / photos / hygiene acknowledgement shown only when "my home" is chosen, allergen acknowledgement, submit) and `src/components/chef/parts.tsx` (section hook that moves focus to the first invalid field or the error message, alert, notice, textarea, checkbox).
- Helpers: `src/lib/chef/upload.ts` (file rules per bucket, fresh lower-case `<uid>/<prefix>-<uuid>.<ext>`, `upsert: false`, safe error text), `src/lib/chef/form.ts` (form validation reuses the server's own pure `parseUpdateBody`, missing-item labels, status view, `describeError` for 401/403/404/409/422).
- Flow changes: `src/lib/auth/route-guard.ts` (`/chef/*` client layer, `landingPath`), `AuthForms.tsx` (chefs land on /chef/apply after log-in and address), `AccountBar.tsx` ("Chef application" link for chefs).
- MOCK adapter: `src/lib/mocks/mock-adapter.ts` now serves PATCH /api/me and the chef application routes using the real pure rules. Magic names for demos: "with dish" (has a sample dish), "rejected", "approved"; log-in email starting `chef` gives a demo chef. All labelled MOCK in the file header.
- Tests: unit `src/lib/chef/*.test.ts`, `src/lib/mocks/mock-adapter.test.ts`, `src/lib/server/page-guard.test.ts`, route-guard tests; Playwright mock `e2e-mock/chef-application-mock.spec.ts` (6 tests); Playwright real routes `e2e/chef-application-real.spec.ts` (4 tests, CI only).
- New dev dependency: `@axe-core/playwright` (free). `playwright.config.ts` skips the real spec when no Supabase stack is present.

## How to verify
- Local, no Docker: `npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run build` (232 unit tests; build works without env), `npm run test:e2e:mock` (12 pass), `npm run test:e2e` (smoke only).
- With a stack: `supabase start`, `set -a; eval "$(supabase status -o env)"; set +a; npm run test:e2e` (11 pass in CI).
- CI on PR #70 is green: unit 232, RLS 111, API 207, Playwright real-route 11, mock 12.
- By hand (real): sign up as chef, verify phone, address, you land on /chef/apply. Fill the profile, upload files, check Storage for `<uid>/id-<uuid>.png` names, upload again and see a new name.

## Known gaps or risks
- Submit cannot succeed in the real app until T-034 adds a dish editor: `sampleDish` stays in the missing list and the UI says the editor is not available yet. The real e2e inserts one dish with the local service role (test fixture).
- "Submitted" is inferred: pending chef with the ID or food-handler check out of `not_started`. The API has no submitted flag. A failed check that is re-uploaded goes to pending without submit, so the label can say "submitted" slightly early.
- No profile photo preview (public bucket URL not used yet). The UI says "A profile photo is saved."
- Draft wording for the allergen and hygiene statements is mine, not reviewed by Jimmy or any legal source. Please confirm or replace.
- The page guard redirect is streamed (meta refresh, HTTP 200) because the page uses Suspense with cacheComponents; no private content is sent. A real 307 would need a non-prerendered route.
- Orphan files: if registration fails after upload, the file stays (chef cannot delete it). The UI tells the chef to choose the file and try again (new name).
- Display name is edited through PATCH /api/me; I did not verify in CI that `chefs.display_name` follows immediately (the UI reloads the application after saving).
- Real-route specs depend on the local Supabase fixture dish insert (dishes columns as in core_schema).

## What the next agent needs
- Try by hand: keyboard-only through every section (Tab, Enter, Space); upload a .gif, an empty file, a file over 5 MB (photos) or 10 MB (documents); upload and cancel; remove then add kitchen photos; 11th kitchen photo (409); submit twice; edit after submit; open /chef/apply as customer, admin, signed out, and in a second tab after log-out; 375px width; dark mode contrast.
- Check that every check status has a MOCK badge (ID, certificate, kitchen when chef's home is chosen, police) and that wording matches what happens.
- Lessons-learned section 3 self-check: ids from the client (none; paths are built from the signed-in user id from /api/me), overwrite (uuid names, upsert false), privacy (only own data), false promises (reworded), focus after errors (tested in both suites), shared text validation (server rules reused), MOCK labels, server guard.
- T-034 will add dishes and availability; remove the "dish editor not available yet" wording when it lands.

## Round 2 (tester FAIL: F1, F3)
- **F1 fixed (client side only).** New `displayNameProblem` in `src/lib/validation/auth.ts` (1 to 80 characters, `hasUnsafeText` from `src/lib/domain/chef-application.ts`). Used by the chef page name form (field error plus focus on the field), by `validateSignUp` (sign-up form) and by the mock `PATCH /api/me`. Unit tests added in `src/lib/validation/auth.test.ts` (236 unit tests now). I did not touch `src/app/api/me/route.ts`, the sign-up route or `src/lib/api/validate.ts`: the server gap is T-059 (issue #71, Backend). Until then the real server still accepts such names if the UI is bypassed.
- `test.fail()` removed from the "display name rejects control characters" test in `e2e-mock/chef-application-edge-mock.spec.ts`; it now passes. I also changed its locator to `getByRole("textbox", { name: "Display name" })` (the section heading shares the label text, so `getByLabel` matched two elements).
- **F3 fixed.** After "Remove kitchen photo" succeeds, focus moves to the "Kitchen photos" heading (`tabIndex=-1`, set in an effect after the list re-renders), and the existing status message "Kitchen photo N removed." announces it. Asserted in `e2e-mock/chef-application-mock.spec.ts`.
- Local: lint, typecheck, `prettier --check .`, `npm test` (236), `npm run build`, `npm run test:e2e:mock` (18 pass) all green. CI result is in the PR.
