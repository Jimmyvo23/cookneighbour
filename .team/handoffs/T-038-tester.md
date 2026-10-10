# Handoff: T-038 Free-trial rules

From: tester  To: planner (for reviewer)

**Verdict: PASS** on head 9c82ab6 (builder head bae45c7 plus my test commit). No blocking findings; two items need a Jimmy decision.

## What changed
- Branch: `feature/T-038-free-trial`, PR #87. I added tests only (commit 9c82ab6):
  - `src/lib/domain/freeTrial.matrix.test.ts` (26 unit tests): independently written A-16 table checked against `transitionFreeTrial` for all 8 events x 3 states, "only held changes", and a guard that `freeTrial.ts` / `free-trial.ts` hold no status-to-outcome mapping (single source `freeTrialEffect`).
  - `tests/api/free-trial-tester.test.ts` (34 DB tests): all 24 event x state combinations through the real database; identical customer-facing message and extras for the customer, phone and address rules, with the real reason logged; `free_trial_blocks` columns are only id, customer_id, reason, created_at; customer, chef and anon cannot read/insert/update/delete blocks or delete claims; another customer cannot see my claim; parallel holds by two accounts sharing a stored phone (one winner); hold racing with release of the customer's other claim (never two live claims); released booking id cannot be re-held but a new booking can; admin 403 and malformed ids 404; foreign +44 phone refused by the DB check; block log grows per attempt; the advisory check writes no block row.

## How to verify
- Local: `npm run lint`, `npm run typecheck`, `npm run build` clean; `npm test` 780 passed before my tests (806 with them, as CI shows). No Docker here, so DB suites ran only in CI.
- CI run 38024165927, head 9c82ab609b950024455a7863acb1f7a5d9ac9314, green on attempt 1 and again on a re-run (attempt 2): unit 806, RLS 118, API 403 (34 new), Playwright real routes 23, mock 67. All race tests passed both times (no flakiness seen in 2 runs plus the builder's earlier green run on c258e7e).

## Findings
1. **MEDIUM (needs Jimmy, business rule)** `cancelled` always releases (`src/lib/domain/cancellation.ts:97`, A-16; noted `docs/domain-rules.md:27`). Confirmed by test: a held claim plus `cancelled` frees the trial for the customer and for the same phone and address. So a 3-day booking whose day 1 was cooked and then cancelled gives the customer another free trial. The status alone cannot tell. Fix needs a rule (for example consume if any day was completed); that belongs to WO-4b / T-042, not this task.
2. **LOW** Block log is unbounded: every blocked hold attempt inserts a `free_trial_blocks` row, no de-duplication (`src/lib/server/free-trial.ts:~156`, `logBlock`). Test shows 3 attempts = 3 rows. Not a bypass, but a blocked customer (or script) can grow the table and bury real events in the admin list. Suggest T-042 rate-limits the booking route and/or the admin list groups by customer and reason (or a unique-per-day key). The advisory check correctly writes nothing.
3. **LOW/INFO** `free_trial_claims_select_own` (`core_rls.sql:421`) plus a table-wide select grant lets a customer read the `phone_hash` and `address_hash` of their own claim through the data API. They are peppered HMACs of their own data, so no leak of anyone else's, but contract section 2 rule 8 says hashes are never returned. Consider a column-level grant or a view in a later migration; I did not assert it by test.
4. **LOW (docs)** `docs/api-contract.md` 11A is accurate for every call and error I exercised, but does not list that holding a booking whose claim was already released or consumed is 409 `INVALID_STATE` (`free-trial.ts:241`, tested), and that an admin is 403 like a chef. Add a line for T-042.
5. **INFO** Claim and booking are still two writes (builder's own flag, 11A bullet 3). T-042 must handle a failed hold; an atomic SQL function would be safer.
6. **INFO** Customer-facing codes `PHONE_NOT_VERIFIED` / `ADDRESS_NOT_SET` describe only the caller's own state; no rule hint leaks. `PHONE_IN_USE` at phone verify (D-11) does reveal that a number is taken; that predates this task.

## Checked and fine
- Same phone / same address (written differently) / same customer / new account blocked; released allows a new trial; consumed never does.
- Clean 409 for N11 phone, no phone, unverified, missing or invalid address; 403 non-customer; 404 another customer's booking; no 500 path found. Unknown unique violation is a deliberate 500.
- Lost-race re-read: same outcome is a no-op, opposite is 409 (completed vs cancelled x5 rounds; declined+declined+expired).
- Hashes built server-side from stored data; no client hash input; service role used after profile/role/ownership checks; RLS denies client writes (existing escalation test plus mine).

## What the next agent needs
- Reviewer: findings 1 and 2 are for the Planner/Jimmy; the rest are small. Handoff is not committed (D-7).
