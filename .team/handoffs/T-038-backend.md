# Handoff: T-038 Free-trial rules

From: backend  To: tester

## What changed
- Branch: `feature/T-038-free-trial`
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/87 (closes #26)
- Files:
  - `src/lib/domain/freeTrial.ts` (+ `freeTrial.test.ts`): pure `evaluateFreeTrial` (blocked by a held or consumed claim with the same customer, phone hash or address hash; reason order customer, phone, address) and `transitionFreeTrial` (only `held` moves; asks `freeTrialEffect` from T-037, no second copy of the A-16 table; repeats are no-ops, opposite outcomes are `invalid`).
  - `src/lib/server/free-trial.ts` (+ `free-trial.test.ts`): `checkFreeTrialEligibility(customerId)`, `holdFreeTrial(customerId, bookingId)`, `applyFreeTrialEvent(bookingId, event)`. Optional `{ db, pepper }` for tests.
  - `src/lib/api/errors.ts`, `src/lib/api/types.ts`: new codes `FREE_TRIAL_USED` and `ADDRESS_NOT_SET` (both 409).
  - `tests/api/free-trial.test.ts`: DB-backed tests (CI).
  - `docs/domain-rules.md`, `docs/api-contract.md` (section 11A, notes for T-042).

## Design for the atomic hold
- No migration. The hold is ONE `INSERT` into `free_trial_claims`. The existing partial unique indexes (`free_trial_one_per_customer`, `_phone`, `_address`, where `state <> 'released'`) are the lock, so two parallel holds cannot both win; the loser gets Postgres `23505`, mapped by the index name in the message to a generic 409 `FREE_TRIAL_USED`. If the name is missing the rules are re-evaluated; an unknown unique violation is a 500 on purpose.
- `booking_id` is unique too: a retry for the same booking returns the existing held claim (idempotent); a claim already decided for that booking is 409 `INVALID_STATE`.
- State changes: read the state, ask `transitionFreeTrial`, then `UPDATE ... WHERE booking_id = ? AND state = 'held'`. If zero rows changed (a race), re-read and judge again: same outcome is a no-op, opposite is 409 `INVALID_STATE`.
- Identity: `customerId` must come from `requireCaller()`. The functions use the service role, so they check the profile is a `customer` (403), the booking is that customer's own (404, same as missing) and `requested` (409). Hashes are computed on the server from the stored, re-normalized phone and address with `HASH_PEPPER`; no client hash is an input.
- Privacy: the customer only gets "The free first booking is not available." The real rule (customer, phone, address) goes to `free_trial_blocks` (admin read only), on a hold attempt only (not on the advisory check). No hash, phone or address is logged or returned.
- Clean errors (T-037 follow-up): stored phone refused by the stricter rule (N11) or missing phone = 409 `PHONE_NOT_SUBMITTED`; unverified = 409 `PHONE_NOT_VERIFIED`; missing or invalid stored address/postal = 409 `ADDRESS_NOT_SET`; never a 500.

## How to verify
- Local (no Docker on this machine): `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all pass. `npm test` = 780 passed (12 pure rule tests, 12 logic tests with an in-memory client that enforces the same three indexes).
- CI run 38023312892 on head c258e7e: green. unit 780, RLS 118, API 369 (about 21 of them new, in `tests/api/free-trial.test.ts`). The first CI run (ec9a4c5) failed on two of my own test bugs (message wording, parallel sign-ups sharing one cookie jar); fixed.
- API tests cover: eligible then held with server-made hashes; same customer twice; same phone new account (the second account cannot verify it, D-11; after the first account moves on, the claim hash still blocks); same address new account and new phone, also written differently ("St." vs "Street"); unrelated customers unaffected; idempotent retry; someone else's booking 404, chef 403, non-`requested` booking 409; stored N11 phone, null phone, unverified phone, null address, bad postal code all 409 for check and hold; each A-16 outcome (declined, expired, no_show_chef, cancelled release and free the customer and the same address; completed and no_show_customer consume and keep blocking); accepted keeps the hold; opposite outcome 409; booking without a claim is a no-op; clients cannot update claims (RLS); parallel holds (5 bookings, one customer; two accounts same address; retries of one booking); parallel completed vs cancelled (5 rounds); same outcome twice at once.

## Known gaps or risks
- Claim and booking are two writes (booking row first, then hold). If the hold fails, T-042 must not leave a free-trial booking (see contract 11A). A single SQL function doing both would be atomic; left for T-042 if wanted.
- `bookings.is_free_trial` is not set by the hold (T-042's job).
- `cancelled` always releases (A-16 as written). A 3-day booking cancelled after day 1 was cooked would release the trial; flagged in `docs/domain-rules.md` as a question for WO-4b / Jimmy.
- Eligibility "no" still tells the customer something (that the trial is unavailable) but not why. Block log rows repeat on every blocked hold attempt (no de-duplication).
- Hosted `free_trial_claims` and `free_trial_blocks` unchanged; no `db push` needed.
- Parallel tests prove one winner against local Postgres; they cannot be run on this machine (no Docker), only in CI.

## What the next agent needs
- Tester: try a stored phone with letters/another country code via service update (the DB check only allows `+1` plus 10 digits); two hold calls with the same booking from two customers; hold then `applyFreeTrialEvent` with `requested`; check `free_trial_blocks` has no hash/phone data; run `tests/api/free-trial.test.ts` repeatedly (it uses random phones, streets and dates; the chef is shared).
- T-042: call order and error mapping in `docs/api-contract.md` section 11A. Call `applyFreeTrialEvent` on every status change, and with `"expired"` when a request times out (Q-11). `freeTrialEffect` in `cancellation.ts` is the only place the outcome table lives.
