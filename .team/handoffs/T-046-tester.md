# Handoff: T-046 Messaging backend (Tester round)

From: tester  To: reviewer

## What changed
- Branch: `feature/T-046-messaging-backend`, PR #171. Builder head tested: fc0a282 (CI green). Tester head: 269188a.
- Tests added only (no product code): `tests/rls/messaging-edge.test.ts`, `tests/rls/messaging-realtime.test.ts`, `tests/api/messaging-edge.test.ts`.

## Result: PASS (no HIGH or MED findings)
CI on Tester head 269188a: green (checks, e2e-mock, supabase RLS + API, ci), run 39302553338. The Realtime test passed in 3 of 3 CI runs (79e6fb0, a742b94, 269188a).

## 1. Old tests Backend changed (diff against main)
- `engagement.test.ts`: the three direct-insert success cases became "refused for every sender" and a check that nothing was saved. Needed (insert is gone). The stranger/anon/admin/edit/delete checks are untouched. The old "declined closed, completed open" insert test now asserts refusal for both; the open/closed read rules moved to `messaging.test.ts`. Not weakened.
- `hardening.test.ts` P4: the created_at/id column refusals are now covered by "no insert works at all" (also with `client_id`). Slightly less specific (a column-level grant is no longer the reason) but strictly stronger on the behaviour; the whole-table revoke is also pinned by `visibility.test.ts`.
- `visibility.test.ts`: removed the three `messages.* insert` column entries (the grant is gone on purpose) and added `booking_chat_open` to the authenticated function list. `send_message` is correctly NOT in the list. Only these lines changed.
- `global-setup.ts`: gives the two requested fixtures a 2099 expiry so their chat stays readable (D-94 stale rule); `engagement` "admin reads messages" and `privacy` "messages: parties only" depend on this. Does not touch other fixtures.

## 2. Privacy core: proven
- Direct insert, upsert, update and delete refused for customer, chef, admin, stranger and anon, on an OPEN chat (rls/messaging-edge).
- `send_message` rpc: 42501 for authenticated (party and admin) and anon.
- Reads: stranger, other booking's chef and customer, anon get no rows; hidden statuses give no rows to both parties and 409 `chat_hidden` through the API; a chat turns hidden at the moment the booking status changes (declined, cancelled, no_show_chef, expired); the admin still reads; admin POST/GET are 403.

## 3. Edges: proven
Frozen then unfrozen (resolved_at), hidden beats frozen, not-a-party beats everything, stale request (raw RLS and route, boundary -1s/+60s), contact guard (9 phone/link/email forms, both senders, allowed after acceptance and when completed, 422 text does not echo the number), retry (200 same row, differing outer whitespace, parallel x5 gives one row and one notification, after freeze/hidden gives the new 409, other text 409, other booking 409 `message_id_reused` for a sender who is a party of both), rate limit (per user, chef unaffected, 429 before 404), 2000/2001 after trim, whitespace-only (9 kinds), control chars (BEL, ESC, DEL, VT, FF, NUL, lone surrogates), emoji, paging (7 rows with identical created_at, microsecond cursor, injected/foreign/tampered cursors), notifications (other party only, one per message, no text/name/id, none for refused sends).

## 4. Realtime: test included (`tests/rls/messaging-realtime.test.ts`)
Customer, chef and admin receive a live insert; a stranger, an unrelated chef and anon receive nothing; after the booking is declined a later insert reaches only the admin. Anti-flake design: negatives are only asserted after a positive control proved events flow (polling re-send loop, 20 s caps); anon may be refused at subscribe time (accepted). See the CI note in the final report for how many runs it passed.

## 5. Contract 7C vs code: matches
Codes, check order (401, 403, 429, 400, 404, sweep, 422 shape, 422 contact, DB 409s) and the Realtime snippet match the code. Only differences: NIT-1 below.

## Findings
- LOW-1 `booking_chat_open(uuid)` (migration line 48 to 58) is security definer and executable by `authenticated` without a party check, so any signed-in user can ask "is booking X open" for a booking id they guessed (returns true/false only; ids are random UUIDs). Suggest `and is_booking_party(p_booking) or is_admin()` inside, or leave and note it. Not exploitable in practice.
- LOW-2 `findContactDetails("order 20261031")` is reported as a phone (any 8+ digit run). False positive on requested bookings; message is refused with a generic text. Pre-existing helper, not T-046.
- NIT-1 Contract 7C says "booking of the caller (404), lazy sweep"; code (`src/lib/server/messages.ts` loadStatus, line ~40) sweeps first and then looks up. No visible difference.
- NIT-2 `send_message` (migration line 78) accepts a whitespace-only or untrimmed body; only the route trims. Safe because the function is service-role only.
- INFO Contact evasion by spelled-out text ("me AT example DOT com") and street addresses is documented in 7C (Q-23).

## How to verify
`npm run test:rls` and `npm run test:api` need the local Supabase (CI only on this Mac). Locally: `npm run lint`, `npx tsc --noEmit`, `npx prettier --check tests`.

## Known gaps or risks
- Realtime negatives cannot prove "never"; they prove "nothing arrived within the window after events were flowing".
- Races of send against accept/decline (FOR SHARE vs FOR UPDATE) were not tested; only same-clientId parallel sends.

## What the next agent needs
Nothing blocks the merge from the Tester side.
