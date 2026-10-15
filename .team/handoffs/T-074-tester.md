# Handoff: T-074 Backend follow-ups from T-065 (tester)

From: tester  To: reviewer
Verdict: **PASS** (no bugs found). Head tested: c67ed0d (builder head ed8f419 plus my tests only). CI `ci` green on c67ed0d (run 38750565264): unit 76 files, RLS 18 files, API 29 files, all passed.

## Verified
- D-58 (server side, storage policy via `can_view_kitchen_photos` -> `booking_contact_open`): boundary at last day +7 open / +8 shut (Toronto midnight; DST cases are the T-065 ones on `booking_contact_ends_at`, which the new function uses); accepted, completed, both no-shows show; requested, declined, expired, cancelled never; customer-home booking never; another customer, a customer of a different chef, anon never; chef keeps own photos; multi-day uses LAST day; older booking shut + newer open = visible; booking with no days = hidden. Real storage downloads, not only the RPC.
- D-59: refused for each of line, city, postal missing; booking stays `requested`, no snapshot, decline works; order: not_approved and expired and invalid_state before it, `chef_home_not_enabled` before it; customer-home accept needs no address; fixing the address then accepting works; API is 409 `INVALID_STATE` with `reason: kitchen_address_missing` and the contract's message text (matches `docs/api-contract.md` v1.10 word for word).
- L1: one transaction (rollback on bad rate, bad `location_options`, unknown key mixed with good ones writes nothing); `conflict` and `kitchen_in_use` leave chefs columns alone; whitelist rejects status, rating_avg, chef_home_enabled, display_name; null params behave like `{}`; JSON null clears; not_found; anon and authenticated cannot execute the function.
- N1 (no key update, still conflicts with `for share`: read in the migration, not testable without concurrency), N2 (clients cannot read or write `booking_kitchen_addresses`), N3 (assert in `chef-application.ts`, read), N4 and N5 (read; comment and `docs/data-model.md`).
- Regressions: local lint, typecheck, prettier, `npm test` (1949 passed, 3 expected fail); T-065 fixtures updated correctly (the old no-address accept now expects `kitchen_address_missing`; `bookableChef` saves an address). Other API tests that set `chef_home_enabled` directly do not accept a chef's-home booking without an address (all CI green).

## Tests added (CI green)
- `tests/rls/kitchen-followups-tester.test.ts` (23 tests): status matrix, window shape, D-59 order, N2 and grants, L1 extras.
- `tests/api/kitchen-followups-tester.test.ts` (7 tests): D-59 order and scope, customer view after refusal, retry after fixing, kitchen PATCH edges (no kitchen field, same PATCH twice, invalid postal code saves nothing).
- Per lessons section 3: unique chef names/tags, far or relative dates; no shared exact-list dates.

## Bugs
None blocking.
- Observation (LOW, not reachable today): `answer_booking` checks `is null` only, so an empty-string address line or city would count as "saved". The PATCH validators and admin flow do not produce empty strings, so this is a hardening idea, not a defect. Not tested because the spec does not say.
- Not testable here: the DST edge for photos at the real clock (the function uses `now()`); covered through `booking_contact_ends_at` and `booking_contact_open(p_at)` in the T-065 tests.

## Next
Reviewer. Migration `20261016100000_kitchen_followups.sql` (and T-065's) is not on hosted; Planner asks Jimmy before `supabase db push --linked`. Frontend follow-up for the D-59 message and D-58 hidden photo block is in the builder handoff.
