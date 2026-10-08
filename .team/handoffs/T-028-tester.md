# Handoff: T-028 Auth backend (tester verification)

From: tester  To: reviewer

**Verdict: PASS** (no blocking defects; non-blocking findings listed below)

## What changed
- Branch: `feature/T-028-auth-backend` (head 8599be4), PR #61 (Closes #16), mergeable/CLEAN.
- I changed nothing in the PR. Verified in a fresh clone; no tests added or pushed.

## How to verify (what I ran and saw)
1. CI `ci` on #61 (run 37709962986): green. Log: unit 8 files / 63 tests; RLS 8 files / 105 tests; `test:api` 1 file / 29 tests; seed twice (idempotent) then `--verify` ("verify ok: 12 chefs, 1 approved Vietnamese in Mississauga, 31 dishes"); Playwright 1 passed; build lists all 7 API routes + Proxy.
2. Fresh clone: `npm ci`, lint, typecheck, `prettier --check .`, `npm test` (63 passed), `npm run build`, `npm run test:e2e` (1 passed): all pass. (test:rls and test:api need Docker; verified from the CI log, not locally.)
3. Contract conformance (read code against docs/api-contract.md sections 1-4, 8, 9): methods, paths, status and error codes match: signup 201/409 EMAIL_IN_USE/409 INVALID_STATE/422/429; login 401 INVALID_CREDENTIALS single message; logout 200 even without session; GET/PATCH /api/me; phone submit 422/409 PHONE_IN_USE/429; verify 409 PHONE_NOT_SUBMITTED, 422 non-6-digit, race 23505 -> PHONE_IN_USE, MOCK_SMS_ENABLED false -> 500; address 422 incl. "Not a GTA postal code.". Section 2 rules: identity via `getUser()` (no `getSession` anywhere in src), role read from `profiles.role`, key whitelists with `rejectUnknownKeys`, exact content type check (also on login/logout; tests cover `application/json-evil`, `jsonx`, text/plain, missing, charset OK), `no-store` on all responses, explicit column lists, hashes/full phone/tokens never selected. Tests assert: content type matrix, unknown keys and `admin` role, no tokens/hashes in bodies, masked phone not containing the full number, stored hash equals `phoneHash(p, PEPPER)`, rate limits (signup 11th, login, phone 6th, verify 11th), PHONE_IN_USE with unverified-holder control.
4. Domain tests reviewed against A-2/A-3 and section 10 (see edge-case list below).
5. Migration `20261008004229_auth_backend.sql`: it is the only migration file added; the three applied ones are untouched. Revokes UPDATE on profiles/chefs/chef_private from authenticated and drops the 5 update policies; photo-path own-folder checks on chefs and dishes; partial unique index on verified `phone_hash`. Real tests: hardening B2 asserts 42501 for chef client updates on all three tables, then checks the row is unchanged; escalation test shows admin session refused (42501) with a service-role allowed control; unique index test has forbidden (23505) plus allowed controls; privilege snapshot tests (tables, columns, functions) in visibility.test.ts pass in CI.
6. Secrets: grep of built `.next/static` and `.next/server/app` for `HASH_PEPPER`, `sb_secret`, `SUPABASE_SECRET_KEY`, test pepper: no matches. Pepper only in `server-only` modules; API tests use fixed `api-test-pepper`. Only logging is `console.error` of the error message in `handle()`; the one message seen (missing env var) names the variable, not a value. No request bodies logged.
7. Proxy (`npm run build && npm start`): with no Supabase env, `/` returns 200 (proxy skips); logout with text/plain returns 400 JSON; `/api/me` returns generic 500 INTERNAL (not a crash; log names the missing variable). With dummy env (URL 127.0.0.1:1, bogus key and garbage auth cookie): `/` 200, `/api/me` 401 UNAUTHENTICATED; no crash.
8. Hash compatibility: `scripts/seed.ts` imports `phoneColumns`/`addressColumns` from `src/lib/domain/private-rows.ts`; `src/lib/seed-data.test.ts` "seed and app compute identical hashes" exists and passes.
9. Hosted-apply risk: the migration adds only revoke/drop policy/add check/create unique index. It applies cleanly to a DB with the CI seed (CI applies migrations, then seeds, twice). Seed sets no `photo_path`, and seeded verified phones are unique. Hosted risk remains only for pre-existing rows that violate the checks (photo_path outside own folder, duplicate verified phone hashes); the hosted DB should be queried before applying (cheap `select count(*)` for each) or confirmed empty. Policy names dropped exist in core_rls (tests pass after drop).

## Known gaps or risks (all non-blocking)
- No test for `MOCK_SMS_ENABLED = false` (route should 500 and not verify); constant is hard-coded true, so low risk.
- No test that a tampered JWT `user_metadata.role` is ignored (code reads `profiles.role`, correct, but not asserted).
- Response `Content-Type` and `Cache-Control: no-store` headers are not asserted in API tests (code uses `Response.json` + NO_STORE everywhere).
- `src/proxy.ts` has no automated test (builder disclosed; I checked manually as in item 7). Recommend a Playwright case later.
- Trigger `chef_private_reset_checks` is now dead for clients and untested; future chef routes (T-031) must apply N1 and need route tests.
- `/api/me` without Supabase env returns generic 500 (acceptable; misconfiguration).
- Rate limits are in-memory per process (disclosed; placeholder).

## What the next agent needs
Missing edge cases for phone/address unit tests (suggested to add; none pushed). Probed behaviour on the branch:
- Phone: `"((416)) 555 0101"` is accepted (lax punctuation); `"416 911 0101"` and `"411-411-4111"` accepted (N11 exchange/area code not rejected by NANP rule); trailing newline accepted (trimmed, fine); full-width digits rejected (fine); `"+(416)5550101"` and `"+1 +416 555 0101"` rejected (fine). Add tests pinning the intended behaviour for: N11 codes, repeated parentheses, `+` with 10 digits, `+1` with 9 or 11 digits, `00` international prefix, tabs, very long input.
- Postal: the shape regex accepts letters never used in Canadian codes (D, F, I, O, Q, U in any position; W, Z first), e.g. `D0D 0D0`, `W1A1A1` normalize successfully. The `postal_prefixes` whitelist still rejects non-GTA, so impact is low. Add tests for NBSP and `_` (already behave), lowercase+newline, and non-GTA-but-valid-shape (`V6B 1A1`) at the route level.
- Address A-2 evasion gaps (accepted limits, document in README): `"5-100 Main St"` hashes differently from `"Unit 5, 100 Main St"`; accents are replaced by a space (`Bélair` becomes `b lair` and differs from `Belair`); unit before vs after the street (`Unit 5 100 Main` vs `100 Main Unit 5`) differ. Consider adding tests that document these as known limits.
- Section 10 coverage: "duplicate phone" (PHONE_IN_USE, race) and "malformed phone" and "non-GTA postal code" (route 422) are covered; "same address on a new account" is a WO-4 concern (address_hash stored, comparison later).

Reviewer notes: confirm hosted pre-apply check (item 9) is made part of the apply step; confirm README documents A-2 limits.
