# Work Order WO-5b: Chat UI (T-047)

Tasks: T-047 (Jimmy chose it 2026-10-19, D-100; WO approved for Frontend, Tester and Reviewer, D-101). Builds on T-046 (merged 964b0da, migration on hosted).

## Inputs (all decided already)

- CLAUDE.md 6.8: in-app chat per booking over Supabase Realtime; no phone numbers or addresses before acceptance.
- Contract 7C (v1.15): `GET` and `POST /api/bookings/:id/messages`, refusal codes, Realtime subscription snippet; MOCK adapter `src/lib/mocks/mock-messages.ts`.
- D-93: a frozen chat is read-only. D-94: chats of declined, cancelled, expired and no-show bookings are hidden; completed stays open. D-95: admin reads only (no admin chat UI in this task).
- D-63: put "Chat stays open." back into the contact-window text (`CONTACT_RULE`, `CONTACT_LOCKED_TEXT` in `src/lib/booking/changes.ts`) and flip the 4 `not.toContain` assertions.
- T-046 carry-ins: after a 409 `frozen` or `chat_hidden` on a retry, refetch and match by `clientId` before showing "not sent" (choice 3); paging is oldest first, so walk `nextCursor` to the end, then go live (choice 7).
- Impeccable is the design skill for Frontend (D-43, T-068).

## Plan per agent

| Agent | Task | Plan (100 words or fewer) | Effort | Risk |
|---|---|---|---|---|
| frontend | T-047 | A chat section on the customer booking page and the chef booking page, mobile first. Load the history (walk the pages), subscribe to Realtime with the signed-in browser client (unsubscribe on leave, reload after reconnect), send with a `clientId`, show pending, sent and failed states, and allow retry. Show the 422 contact-guard text, the 429 rate-limit text, read-only for frozen, nothing for hidden. MOCK mode uses the mock adapter (no Realtime). D-63 text restored. Unit tests and mock e2e at 375 px with axe. | M–L | See below |
| tester | T-047 checks | Each booking status (open, frozen, hidden, completed), send states and retry, contact-guard and rate-limit messages, focus and live-region behaviour, 375 px with axe; a real-route e2e if feasible on the CI stack. | M | Realtime timing in e2e |
| reviewer | T-047 review | Accessibility, honesty of texts, privacy (nothing shown for hidden chats, no leaks in errors), the browser client uses only the publishable key and the user's session, plan compliance. | S–M | Low |

## Main risk: the browser Realtime client

The app has **no browser Supabase client** today; every Supabase call runs on the server. Realtime needs a browser client that carries the user's session. If the current auth cookies make that impossible without changing auth (for example httpOnly cookies the browser cannot read), Frontend **stops and reports** before changing auth. The Planner then brings options to Jimmy (a small auth change, or polling as a labelled fallback). Realtime is a CLAUDE.md 6.8 requirement, so polling is not chosen silently.

## Left out

Unread badges and a notification list (the notification read route is in T-048), the admin chat view (T-048), attachments, editing or deleting messages, typing indicators.

## Decision

Decide ids `WO-5b-frontend`, `WO-5b-tester`, `WO-5b-reviewer`.
