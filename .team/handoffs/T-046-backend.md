# Handoff: T-046 Messaging backend

From: backend  To: tester

## What changed
- Branch: `feature/T-046-messaging-backend`
- Pull request: see the PR titled "T-046: Messaging backend" (closes #170)
- Migration: `supabase/migrations/20261021100000_messaging.sql` (NOT pushed to hosted; the Planner asks Jimmy after merge)
- API contract: `docs/api-contract.md` **v1.15**, new section 7C (also the summary table, notification type `new_message`, section 11). `docs/data-model.md` updated for the closed insert path.
- Files added: `src/app/api/bookings/[id]/messages/route.ts`, `src/lib/server/messages.ts`, `src/lib/domain/messages.ts` (+ test), `src/lib/mocks/mock-messages.ts` (+ test), `tests/rls/messaging.test.ts`, `tests/api/messaging.test.ts`.
- Files changed: `src/lib/api/types.ts` (MessageView, MessageList, SendMessageRequest, MessageRefusalReason), `src/lib/server/booking-views.ts` (`encodeListCursor` exported), `src/lib/mocks/mock-bookings.ts` and `mock-adapter.ts` (route the chat to the MOCK, `messages` state, hook `messagesRateLimited`), `tests/rls/engagement.test.ts`, `hardening.test.ts`, `visibility.test.ts` (direct insert is gone; privilege snapshots updated), `tests/rls/global-setup.ts` (requested fixtures get a far expiry so their chat stays readable on a reused database).

What the migration does:
- Drops `messages_insert_party` and the client insert grant (table and column). Sending is API only.
- New `messages.client_id` with a unique index on `(sender_id, client_id)` (retry guard, T-075 INFO).
- New `booking_chat_open(booking)` (executable by `authenticated`); `messages_select_party` now needs party AND chat open (D-94): requested not past expiry, accepted, completed. Declined, cancelled, expired, both no-shows and a stale request are hidden, so Realtime stops streaming them. `messages_select_admin` is unchanged (D-95, A-34).
- New `send_message(booking, sender, client_id, body)`, security definer, `search_path = ''`, execute for `service_role` only. Locks the booking `FOR SHARE`. Order of checks: not a party -> `not_found`; hidden or stale -> `chat_hidden`; frozen -> `frozen` (D-93); client id (duplicate returns the first row, same id with another text or booking -> `message_id_reused`). Writes the message and the `new_message` notification for the other party in one transaction (D-96). The notification has no text, name, phone or address (A-33).

## How to verify
- Local (done, all green): `npm run lint`, `npm run typecheck`, `npx prettier --check .`, `npm test` (2152 passed, 3 expected fails as before).
- SQL logic was checked in pglite with stub tables (ok, duplicate, reuse, stranger, all hidden statuses, stale, frozen, notification text, empty body). It cannot test RLS, grants or races.
- RLS and API tests run only in CI (no Docker here): `npm run test:rls`, `npm run test:api`.
- Contract section 7C lists every refusal and the Realtime subscription (channel, `booking_id` filter, RLS applies).

## Known gaps or risks
- **No Realtime subscriber test.** It needs the live Realtime service and a timing window I cannot make reliable (and could not try without Docker). The policy it depends on is tested by selects in `tests/rls/messaging.test.ts` (open and hidden statuses, stale request, strangers, anon, admin). Tester: if you want one, a subscribe-then-send-then-wait test with a generous timeout is possible but may flake.
- Rate limit is the placeholder in-memory limiter (section 9), per server process.
- `findContactDetails` does not catch street addresses (Q-23, still open, out of scope per the Work Order).
- The made-up RLS test data uses far-future visit dates (700 to 1000 days) so it cannot collide with other files.
- The SQL, RLS and API tests have not run yet (CI will be the first run); I read them against the existing helpers but a first-run helper mistake is possible.
- Pre-existing tests I had to change because the direct insert is gone: `engagement.test.ts` (messages block now asserts direct inserts are refused), `hardening.test.ts` P4 (every messages insert is 42501), `visibility.test.ts` (column snapshot loses the three messages insert columns; function snapshot gains `booking_chat_open`).

## Builder choices (Jimmy to confirm)
1. **Hidden chat answers 409 `INVALID_STATE` with `reason: chat_hidden` on GET and POST**, not 404 and not an empty page. The caller is a party and already knows the status, so nothing new leaks; the UI gets a clear reason. The RLS select (REST and Realtime) returns no rows.
2. **A stale `requested` booking counts as hidden** in the policy and in `send_message` (the routes also run the lazy sweep first, so the booking becomes `expired`).
3. **Strict state wins over a retry:** a retry of a saved message into a booking that is now frozen or hidden gets 409, not the old row. A retry in an unchanged state returns the first row with 200 (a new message is 201).
4. **`clientId` is required** (lower-case UUID), unique per sender; reuse with other text or booking is 409 `message_id_reused`.
5. **Body rules:** trimmed, 1 to 2000 characters, line breaks and tabs allowed (chat is multi-line), other control characters and lone surrogates refused. Unknown body keys are 422.
6. **Rate limit:** 30 messages per user per 60 seconds (no number was given; the project limiter, key per user).
7. **List defaults:** `limit` default 20, max 50 (the house default), oldest first, cursor after the last item. Unknown query parameters are 422. A UI that wants the latest messages follows `nextCursor` to the end and then uses Realtime.
8. **Notification wording:** type `new_message`, title "You have a new message", body "A new message arrived on one of your bookings. Open the booking to read it." One row per message (D-96), no sender name.
9. **`created_at` uses `clock_timestamp()`**, so the page cursor is less likely to skip a message that commits late.
10. **The admin gets 403 on both routes** (house rule for party routes). The admin reads chats through RLS only; there is no admin chat route yet.
11. **Mock:** the first read of an empty chat adds one made-up greeting from the other party (labelled MOCK) so the UI has content; cursor is an index.

## What the Tester should probe
- Direct insert from a browser client, as self and as someone else, on every status (RLS tests cover it; also try the REST endpoint with a user token and the `rpc/send_message` endpoint with user and anon tokens).
- Read as: stranger, the other booking's chef or customer, anon, admin; each hidden status; a stale request before and after the sweep; Realtime if feasible.
- Race: two sends with the same `clientId` at once (one row, one notification); a send while an accept, decline or cancel runs (the `FOR SHARE` lock takes turns with their `FOR UPDATE`); a send while a freeze flag is inserted.
- Contact guard: phone, email, link, spaced digits, ISO dates (allowed), before and after acceptance, both senders.
- Notification: one per message, to the other party only, no text anywhere in title or body; none for a refused or duplicate send.
- Paging: more than one page, ties on `created_at`, a message arriving between pages, invalid or tampered cursor, limit bounds.
- Body edges: 2000 vs 2001 characters after trimming, only spaces, emoji, lone surrogate, NUL, `\r\n`.
- The privilege snapshots in `tests/rls/visibility.test.ts` (nothing else was granted by accident).
- MOCK adapter: `src/lib/mocks/mock-messages.ts` follows the same pure rules; try the frozen and hidden cases from the UI side once T-047 exists.
