# Handoff: T-065 Contact privacy (tester)

From: tester  To: reviewer

## Verdict: PASS (no blocking bugs)

## What I checked
- Local: lint, typecheck, prettier, `npm test` all pass (1931 passed, 3 expected fail).
- CI (RLS + API suites on local Supabase): green on the head with my added tests (run 38676244773).
- Snapshot: accept copies the kitchen address in the accept transaction under the chef share lock; later address changes do not alter what the customer sees (RLS + API tests); customer-home accept and decline create no snapshot (added); backfill is SQL-only, not testable in CI (reviewed by reading: only chef_home accepted/completed/no-show with a full address).
- N3: `set_chef_kitchen_address` locks chef then chef_private, conflict check, `kitchen_in_use`, resets kitchen check, turns chef's home off; 4-round accept-vs-change race checks the invariant (cannot force interleaving; lock order read as correct).
- D-52/D-56: boundary 00:00 Toronto on last day + 8 tested to the second; added the four DST cases (ends on and spans fall-back 2026-11-01, spring-forward 2027-03-14), multi-day uses the last day, booking with no days. The four statuses open, requested/declined/expired/cancelled never. `visible_until` equals `booking_contact_ends_at`; no rows means null in the API. No TS date helper exists (SQL is the single source), so there is no second rule to drift.
- Security: new functions have `search_path = ''`; `booking_contact_ends_at`, `booking_contact_open`, `set_chef_kitchen_address` revoked from public/anon/authenticated, granted to service_role; `get_booking_contact` revoked from anon; snapshot table RLS on, no grant/policy (direct reads return nothing for anon, customer, chef). Added: stranger and other chef get no contact, anon denied, helper functions and `answer_booking` not callable from browser roles.

## Tests added
`tests/rls/contact-privacy-tester.test.ts` (DST x4, multi-day, no-days, stranger/anon, visible_until match, customer-home no snapshot, decline no snapshot, grants).

## Notes (not bugs)
- Low: in `mutate`, the kitchen RPC commits before the `chefs` column update, so a failure in the second write leaves the address changed without the other fields (needs a DB error; unlikely). Refused/stale PATCH saves nothing, as the contract now states.
- Low: `kitchen_in_use` counts only status `accepted`; an accepted booking whose visit dates are long past blocks until the lazy sweep completes it (sweep runs first in patchApplication, so fine).
- Info: kitchen photos still use status only (backend open question 1); backfilled snapshots use the current address.

## Bugs
None.
