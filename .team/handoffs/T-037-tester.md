# Handoff: T-037 Domain rules (tester)

From: tester  To: planner

## Verdict: PASS (no blocking findings; 1 test-helper flake fixed, 4 notes for the Planner/Reviewer)

Head tested: 9fd8153 (builder d857282 + my 2 test commits). CI: run 37880516220 on head 9fd8153, ci job PASS (RLS, API and Playwright steps included), 10m29s.

## What I checked
- Read every file in src/lib/domain for T-037 against A-6, A-7, A-9, A-13..A-17, CLAUDE.md 6.4-6.6, 10. All rules match their assumptions exactly.
- Local: lint clean, typecheck clean, `npm test` 686/686 pass (595 builder + 91 mine in `src/lib/domain/t037-tester.test.ts`), `npm run build` exits 0.
- My tests: independent BigInt oracle over 400 random bookings (labour, ingredients, travel, fee, total all equal; rounding half up once per day); A-13 travel per day (74.04 -> 74 x3, 25 m -> 1.5 -> 2), whole-metre only; A-14 fee on labour only, 0 on free trial, per-day rounding (3 days x 1c), not in total; huge / 0 / NaN / fractional rates throw RangeError; A-15 both sides of the boundary (10%->15% table, $5 floor, 3333/3400); A-6 exact second in summer, spring-forward (03-08 and 03-09) and fall-back (11-01, 11-02) weekends; A-7 month/year/leap ends, 0 and 7 days; A-16 all 8 events; A-17 (all allergens, case, blank, inactive, no dishes); D-15 today / day 180 / day 181 / yesterday; service radius exactly the radius vs one metre less; chef's-home matrix (offered x enabled x status); 6 h limit exact 360 vs 365, per day; quantity 0, -1, 1.5, NaN, Infinity, 11; malformed requests do not throw; phone N11/NANP valid and invalid cases; postal D F I O Q U anywhere, W/Z first, W/Z allowed in positions 3 and 5; allergenList dedupe-before-limit (14 distinct + retyped ok, 15 distinct refused), ALLERGENS_RAW_MAX 50 / 51; api-contract wording; every postal literal and phone literal in scripts/seed-data.ts plus every prefix in supabase/seed.sql.

## Findings
1. MEDIUM (fixed, test helper) `tests/api/harness.ts:61` `newPhone()` built exchange `2` + 2 random digits, so 1 call in 100 produced an N11 exchange (e.g. +1647 211 xxxx) that the new phone rule rejects: a ~1% flake per call in tests/api/auth.test.ts (runs in CI). The builder fixed three other helpers but not this one. I fixed it (map "11" to "22") and pinned it in the gap test. Other helpers checked and fine: `tests/api/chef-helpers.ts uniquePhone`, `tests/rls/helpers.ts fakePhone` (555 exchange, inserted directly), `e2e/helpers/local-chef.ts`, `e2e/auth-real.spec.ts`, `e2e/chef-application-real.spec.ts` (all skip n%100==11), `e2e-mock` (416 555 0123), fixed postal literals (L5B 1A1).
2. LOW `src/lib/domain/receipt.ts:33` tolerance is rounded half up before a strict compare, so for an estimate of 3350 (15% = 502.50) a 503 difference is not flagged although 503 > 502.5. Off by at most half a cent; I did not pin it. Suggest leaving it or comparing in hundredths.
3. LOW (note) `src/lib/domain/bookingIntake.ts:25` the intake only requires the fields to be strings, so empty allergies and dietary notes pass. CLAUDE.md says the form is mandatory; whether "nothing" must be typed explicitly is a product decision (not invented by me). Ask Jimmy if needed (WO-4b).
4. LOW (note) `src/lib/domain/pricing.ts` sums are not checked for safe-integer overflow across days; per-day values throw first for huge inputs, and real inputs are tiny (rate <= any DB limit), so no practical risk.
5. INFO (as requested) `src/lib/domain/config.ts:32` `MAX_DISH_QUANTITY = 10` is a builder placeholder that is not in PLAN.md; it is labelled ASSUMPTION in code and handoff. Needs Jimmy's decision or a PLAN assumption number before WO-4b uses it. Tested at 10 ok, 11 refused.
6. INFO the DB check regex for postal codes is still shape-only (builder noted); seed prefixes and codes are all valid under the new letter rules.

## Not covered here (agreed out of scope for T-037)
Chef/customer no-show handling, pick-up time (T-042/WO-4b); duplicate phone and second free trial (T-038).

## Counts
Unit tests 686 passed / 0 failed (36 files). I added 91 tests and changed one helper file. No application code touched.
