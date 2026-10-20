# Handoff: T-051 Section 10 edge-case matrix and gap tests

From: tester  To: reviewer

## What changed
- Branch: `feature/T-051-edge-case-sweep` (from main 5230318)
- Pull request: the PR titled "T-051: Section 10 edge-case matrix and gap tests" (Closes #183)
- Files: `docs/edge-case-matrix.md` (14 rows), `docs/work-orders/WO-6b-edge-case-sweep.md` (committed as asked), `src/lib/domain/edge-cases-t051.test.ts` (unit), `tests/api/edge-cases-t051.test.ts` (API, CI only), this handoff. No product code touched.
- Matrix result: covered 11, added 2, BUG 1, GAP-question 0.

## How to verify
- `npx vitest run src/lib/domain/edge-cases-t051.test.ts` gives 2 passed and 1 expected fail (the `it.fails` for BUG T51-B1).
- `npm run lint`, `npm run typecheck`, `npm test` (full unit suite).
- The two API tests run in CI only (no Docker on the Mac). Check the `ci` gate for `tests/api/edge-cases-t051.test.ts`.
- Reviewer: spot-check the matrix by searching each quoted test title in the repo; every title was grepped by the Tester.

## Known gaps or risks
Bug list, ranked by severity:
1. **T51-B1 (LOW), free-trial address key drops non-ASCII characters.** `addressKey` (src/lib/domain/address.ts, `normalizeAddressLine`) replaces everything outside a-z0-9 with a space. Steps: `addressKey("１００ Fictional Street", "L5B 1A1")` and `addressKey("２００ Fictional Street", "L5B 1A1")` (full-width digits) both give `fictional st|L5B1A1`. Two different homes on one street and postal code share a key, so the second customer's free trial is blocked wrongly; a non-Latin-only street line also collides with any other. Address route validation (`validateAddress`) accepts such input. Fix idea for the builder: normalize with NFKC first (full-width digits become ASCII), and keep or refuse other letters instead of dropping them. Recorded as `it.fails` in `src/lib/domain/edge-cases-t051.test.ts`; when fixed, change it to `it`.

Risks in my own tests:
- The overlapping-days race test (`tests/api/edge-cases-t051.test.ts`) assumes the database never deadlocks when two multi-day requests overlap on one day. If CI shows a 500 or a deadlock error there, that is a real bug (backend), not a test fault.
- I could not run the two API tests locally.

## What the next agent needs
Questions for Jimmy (not decided anywhere in PLAN.md, so no test pins an answer):
- **Q-T51-1.** The pre-acceptance contact filter (D-34, chat and decline reason) does not catch a phone number written in full-width digits. D-34 says best-effort. Fold full-width digits first, or leave?
- **Q-T51-2.** Should the free-trial address key (A-2) also fold accents (Edouard / Édouard) and ignore invisible characters (zero-width space)? Today the same home can get a different key that way, so a second free trial slips through. Also, CLAUDE.md 6.6 wants the README to list the free-trial known limits (cheap SIMs, several addresses); the README does not mention them yet.
- **Q-T51-3.** A chef who cancels inside 48 hours is recorded "late" and nothing else happens (D-20: nothing is charged). Is that the rule for chefs too, or should it have a consequence?

Other notes: real-route Playwright (`e2e/*-real.spec.ts`) was not extended; no RLS tests were added because rows 1, 5, 10, 13 and 14 already have RLS proofs.
