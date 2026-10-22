# Handoff: T-102 Security hardening LOW-3 to LOW-7

From: backend  To: tester

## What changed
- Branch: `feature/T-102-hardening`
- Pull request: see the PR for this branch
- Files:
  - Migration `supabase/migrations/20261027100000_security_hardening_low3_low5.sql`: `display_name_problem()` (no browser execute), new `handle_new_user`, insert-only owner policies for `profile-photos` and `dish-photos`, chef-only insert on `profile-photos`.
  - `supabase/config.toml`: `minimum_password_length = 8` (local).
  - `src/lib/api/request.ts` (`clientIp`), `src/app/api/auth/login/route.ts`, `src/app/api/auth/signup/route.ts` (email-only keys, contact filter on the name).
  - `src/lib/api/errors.ts` (`dbFailure`) and its use in `src/app/api/me/*` routes, `src/lib/server/me.ts`, sign-up chef rows.
  - `src/lib/server/pepper.ts` (32 character minimum outside `NODE_ENV=test`), `.env.example`, `playwright.config.ts` (e2e placeholder pepper lengthened to 33 characters).
  - Tests: `src/lib/api/request.test.ts`, `src/app/api/auth/{login,signup}/route.test.ts`, `src/lib/server/pepper.test.ts`, `tests/rls/t102-hardening.test.ts` (new), `tests/rls/storage-hardening.test.ts` (old "owner-writable" decision test replaced).
  - Docs: `docs/api-contract.md` body sections (rule 9, sign-up, section 9, old note 10), `docs/data-model.md` (Storage table, new "Auth trigger" section). The `Status:` version line is NOT touched.

## How to verify
- `npm run lint`, `npm run typecheck`, `npm test` (3054 pass locally).
- Local stack: `npx supabase stop && npx supabase start` (config change needs a restart), `eval "$(npx supabase status -o env)"`, then `npm run test:rls` (29 files, 347 pass) and `npm run test:api` (46 files, 857 pass).

## Known gaps or risks
- Builder choices (not literally in the spec; Jimmy has not confirmed):
  1. A display name that breaks a rule makes the whole sign-up FAIL (error 22023) instead of being replaced by "New user". The app route validates first, so normal users see a 422 on `displayName`; only direct Auth callers get Supabase's generic "Database error saving new user".
  2. The sign-up ROUTE now also refuses contact details (phone, email, web address) in the display name, so it matches the trigger. The old app rules had no contact filter on names. The browser form check (`displayNameProblem`) was not changed (UI side; the server field error shows on the name field).
  3. `clientIp`: on Vercel (`VERCEL` set) only `x-vercel-forwarded-for`, then `x-real-ip`, are read, never `x-forwarded-for`. Off Vercel it keeps reading `x-forwarded-for` (tests and e2e depend on it; documented as not safe for the open internet).
  4. Email-only limits: login 20 per 15 min per email, sign-up 10 per hour per email. Side effect: anyone who knows an email can use up its login allowance (lock-out nuisance).
  5. Owner delete on the two photo buckets is also gone (insert-only), not only update. `public_photos_select_*` stay. No admin delete policy added (the service role is what routes use).
  6. `dbFailure` is applied to `/api/me`, `/api/me/phone`, `/api/me/phone/verify`, `/api/me/address`, `/api/me/intake`, `src/lib/server/me.ts` and the sign-up chef rows. Other routes (chef application, bookings, admin) still log messages; they were not named in the finding.
  7. e2e placeholder pepper in `playwright.config.ts` lengthened (CI workflow itself holds no pepper). The seed script's local fallback pepper `local-dev-pepper` is unchanged (seed does not use `getHashPepper`).
- Known limits: Postgres `\s` vs JavaScript `trim()` differ on a few exotic spaces; contact filter is best effort; the filter runs at sign-up only (`PATCH /api/me` unchanged); limiter is still in memory per instance; chefs can still upload unlimited new photos (no review of changed photos, not decided).
- A deployed `HASH_PEPPER` shorter than 32 characters will make phone and address routes return 500 after this ships. Jimmy must check the Vercel value first (see below).

## What the next agent needs (hosted steps for Jimmy; Backend did NOT touch hosted, D-161)
1. Supabase dashboard, hosted project: Authentication > Sign In / Providers (or Policies > Password) > set "Minimum password length" to 8 and save. Optionally turn on "Prevent use of leaked passwords" (may need a paid plan; skip if it does).
2. Vercel project > Settings > Environment Variables: check `HASH_PEPPER` is at least 32 characters. If it is shorter, changing it invalidates every stored phone and address hash (free-trial checks and seeded hashes), so decide that before deploying; do not change it silently.
3. After merge, apply the migration on hosted: `npx supabase db push --linked` from the main folder (Jimmy runs it), then `npx supabase migration list --linked`.
4. Tester ideas: direct `POST /auth/v1/signup` with a 7-character password and with a name like "Call 416 555 0199" (both must fail); chef and customer storage uploads and overwrites on `profile-photos` and `dish-photos`.

## Round 1 (Tester PASS with 3 LOWs; all three fixed)
- **F-1** SQL looser than the app: the URL test in `display_name_problem` (same migration file `20261027100000`, not on hosted yet) now uses ASCII boundaries instead of `\m`/`\M`: `(^|[^a-zA-Z0-9_])` before and `($|[^a-zA-Z0-9_])` after, plus the JavaScript quirk that `\b` sits before a hyphen only after a word character. `李x.ca` and `x.ca٤١٦` are refused now. Found while testing: the first fix attempt let `(416)-.com` through as in the app only by accident of the quirk, so the quirk is replicated on purpose; the 2000-name random parity test passes.
- **F-2** App looser than SQL: `hasNoVisibleText` (`src/lib/domain/text-fold.ts`) now also removes U+0085 before the trim. A name of only U+0085 is a 422 `displayName` "Enter at least one visible character." (browser form uses the same helper, so it shows the same message). Tests: `text-visible.test.ts`, `signup/route.test.ts`.
- **F-3** LOW-6 widened: `dbFailure` now used in `src/lib/server/free-trial.ts` (all lookups, claim insert/update, the block log line), `src/lib/server/chef-application.ts` (loaders, row repair, kitchen address, chefs/chef_private update, status update) and `src/lib/server/caller.ts`. The unique-violation message in `holdFreeTrial` is still read to tell which index failed (logic), but never logged or thrown. New test `src/lib/server/t102-no-db-message-in-logs.test.ts` spies on all console methods. Other routes (bookings, admin, groceries, messages...) still log messages; not part of this round.
- The Tester's `it.fails` tests for F-1 and F-2 are plain `it` now (comments updated); the skip-lists for the two gaps in the parity tests were removed.
- Local results after `supabase db reset`: lint and typecheck clean, unit 3092 pass (3 expected fail), RLS 31 files 456 pass, API 46 files 857 pass.
