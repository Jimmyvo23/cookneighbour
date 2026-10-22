# Handoff: T-102 Security hardening LOW-3 to LOW-7

From: tester  To: reviewer

## What changed
- Branch: `feature/T-102-hardening`, PR #207, tested on head 1ff26c4. No app code touched.
- New test files (all added by Tester):
  - `tests/rls/t102-tester-name-parity.test.ts` (LOW-3): the SQL function `display_name_problem()` against the app rules (`hasUnsafeText`, `hasNoVisibleText`, `findContactDetails`, trimmed length 1 to 80 UTF-16 units). Edge tables (80 vs 81, emoji, decomposed Vietnamese, bidi, ZWSP/WJ/BOM, ZWNJ/ZWJ allowed, invisible-only, false positives such as "Lan 1985" and "Chef Anna B.", phone/email/URL incl. full-width and look-alike dashes), 2000 seeded random mixes, EVERY Unicode code point alone and as `a<cp>b`, and real Auth sign-ups (good name keeps role and trimmed name; each bad class fails and leaves no profile).
  - `tests/rls/t102-tester-storage.test.ts` (LOW-5): no UPDATE/DELETE/ALL policy mentions the two buckets; insert policies need `is_chef` and the uid folder; owner re-upload with and without upsert, delete, move, copy-over refused with the file unchanged; other chef, admin, anon, customer refused; folder tricks (upper case uid, no folder, uid not first, `..`); pending and rejected chefs can still upload a profile photo; the real browser helper `uploadChefFile` uploads profile and dish photos twice to new paths and both load from the public URL; the service role can still delete.
  - `src/app/api/auth/t102-tester-limits.test.ts` (LOW-4, LOW-6): on `VERCEL=1` a spoofed `x-forwarded-for` never picks the bucket (login and sign-up), `x-real-ip` fallback, shared "unknown" bucket; email-only limits independent of IP, case and whitespace normalised, refused calls never reach Auth, invalid requests do not spend the email allowance; sign-up chef-row failure logs label and code only.
  - `src/app/api/me/t102-tester-no-db-message-in-logs.test.ts` (LOW-6): scripted fake database, 14 cases over `/api/me`, `/api/me/phone`, `/api/me/phone/verify`, `/api/me/address`, `/api/me/intake`; every console method is spied; neither the log nor the body holds the DB message or key value; the label with the code is logged.
  - `src/lib/server/t102-tester-pepper.test.ts` (LOW-7): 31 throws and 32 passes for production, development, staging, empty and unset NODE_ENV; value never in the message; trim; the e2e placeholder pepper is at least 32 characters.

## How to verify
- `npm run lint`, `npm run typecheck`, `npm test` (3086 pass, 3 expected fail).
- `npx supabase start` (or `db reset`), export the keys (`set -a; eval "$(npx supabase status -o env)"; set +a`), then `npm run test:rls` (31 files, 454 pass, 2 expected fail) and `npm run test:api`.
- `npm run db:seed -- --local` twice and `--verify`: seed loads under the new trigger (12 chefs, 3 customers, ok).
- Migration `20261027100000` applies cleanly after `20261026100000` (`supabase db reset`, all migrations applied, seed.sql loaded). T-101's branch has no supabase changes so far; `20261026110000` would sort before it and nothing in it conflicts as far as the current T-101 diff shows.

## Known gaps or risks
Findings (none blocks the task; both are tracked by `it.fails` tests that turn red when fixed, then remove `.fails`):
- F-1 (Low) SQL looser than the app: a web address glued to a non-ASCII letter or digit, e.g. `李x.ca`, `x.ca٤١٦`, passes the trigger but is refused by the app. Cause: JavaScript `\b` is ASCII-only, Postgres `\m`/`\M` are Unicode-aware, in `display_name_problem` (migration, the URL regex line). Only reachable by a direct Auth sign-up (the route refuses first). Fix idea: use `(^|[^a-z0-9_])` style guards in SQL.
- F-2 (Low) App looser than SQL: a display name that is only U+0085 passes the route (`trim()` and `hasNoVisibleText` do not treat NEL as blank) but the trigger refuses it, so the user gets a generic 500 from sign-up instead of a 422. Cause: `src/lib/domain/text-fold.ts` `hasNoVisibleText`/JS trim versus Postgres `\s`. The every-code-point check found no other mismatch in either direction (apart from F-1).
- F-3 (Low, scope) LOW-6 is closed only for the routes the builder listed. Other private-data code still logs the DB message: `src/lib/server/free-trial.ts` (lines 103, 117, 168, 270, 293, 303, 350 to 403; claims hold phone and address hashes), `src/lib/server/chef-application.ts` (lines 114 to 131, 320 to 346, chef_private), `src/lib/server/caller.ts:26` (every route). The builder disclosed this (gap 6). `free_trial_claims` unique violations are the most likely to carry hash values. Reviewer to decide if it belongs in this PR.
- Test environment note: the local database collects chefs across runs; after about 800 approved chefs `tests/api/search.test.ts` "everything the unfiltered list returns is approved in the database" gets `data: null` from a too-long `.in(...)` URL. It failed in my full run (844 approved chefs by then) and in a rerun on the same data; it is not related to this PR (no chefs created by new tests), but CI result for this test is worth reading. Fresh `db reset` gives a clean start for RLS; the API run alone still creates many chefs.
- Builder choices 1 to 7 in the backend handoff stay unconfirmed by Jimmy.

## What the next agent needs
- Hosted steps remain Jimmy's (password minimum 8 on hosted, check `HASH_PEPPER` length on Vercel, `db push --linked` after merge); nothing was run against hosted.
- I ran `npx supabase db reset` on the shared local stack (container `supabase_db_CookNeighbour`); any other worktree using it should expect an empty database.
