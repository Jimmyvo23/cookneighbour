# Work Order WO-5a: Messaging backend (T-046)

Tasks: T-046 (Jimmy chose it 2026-10-19, D-92). T-047 (chat UI) follows as its own task under D-84.

Approval: Jimmy approved Backend, Tester and Reviewer 2026-10-19 (D-97), with his answers to Q-A to Q-D (D-93 to D-96) replacing the recommendations below.

## What exists today (from the foundation migrations)

- Table `messages` (`booking_id`, `sender_id`, `body` 1 to 2000 characters, `created_at`), index on `(booking_id, created_at)`, already in the `supabase_realtime` publication. Realtime applies the select policies to every subscriber.
- RLS: both parties read; the admin reads **every** chat; a party may **insert directly** while the booking is `requested`, `accepted` or `completed`.
- No API route, no contract section, no mock adapter.

**Gap that T-046 must close:** a direct insert from the browser skips every server check, including the CLAUDE.md 6.8 rule that no phone number or address is shared before acceptance. Sending must go through the API only.

## Requirements and carry-ins this task builds on (not new)

- CLAUDE.md 6.8: chat per booking over Supabase Realtime; no phone numbers or addresses before acceptance.
- Carry-ins (PLAN.md T-063 notes): `findContactDetails` on chat before acceptance; no messages on a stale request that should have expired (finding 4a).
- D-52 and D-63: chat stays open after the contact window ends.
- T-075 review: after a timed-out write the user may retry; messages need a duplicate guard.

## Plan per agent

| Agent | Task | Plan (100 words or fewer) | Effort | Risk |
|---|---|---|---|---|
| backend | T-046 | Migration: drop the direct insert policy and grant; add a locked `send_message` function that checks party, booking status, lazy expiry, frozen rule and the client message id (duplicate guard, unique per sender); add read markers for unread counts. Routes: `GET /api/bookings/:id/messages` (paged) and `POST` (rate limited; `findContactDetails` before acceptance; the 422 says why). Contract section, TS mirror, MOCK adapter for the UI, RLS and API tests incl. a Realtime subscriber that must not see another booking's messages. Answers to Q-A to Q-D below decide the rule details. | M–L | Realtime RLS behaviour in CI; the migration needs DBPUSH approval |
| tester | T-046 checks | RLS: strangers, the other booking's party and anonymous users cannot read or subscribe; direct insert refused. API: each status, stale request, frozen, contact guard before and after acceptance, duplicate retry, rate limit, 2000-character limit, paging order. | M | Realtime tests may be slow or flaky in CI |
| reviewer | T-046 review | Privacy (contact guard, admin access), RLS, contract accuracy, honesty of 422 texts, migration safety. | S–M | Low |

## Questions for Jimmy (the rule details depend on them)

- **Q-A Frozen bookings (D-53):** can both parties keep chatting while the admin decides? Recommendation: **yes**. Chat is not a booking change, and they may need to talk.
- **Q-B Ended bookings** (declined, cancelled, expired, no-show): recommendation: **history stays readable, no new messages**. This matches today's RLS.
- **Q-C Admin access:** today the admin can read every chat. Recommendation: **only chats of bookings with a problem report or flag**, which is the minimum data needed for reports (6.9).
- **Q-D New-message alert:** recommendation: **an unread count per booking (read marker), no notification row per message**, to avoid flooding the notifications list. The notification read route stays in T-048.

## Jimmy's answers (2026-10-19)

- **D-93 (Q-A):** a frozen booking's chat is **read-only**: no new messages until the admin decides.
- **D-94 (Q-B):** the chat of a declined, cancelled, expired or no-show booking is **hidden** from both parties. A completed booking's chat stays open (D-52, D-63).
- **D-95 (Q-C):** the admin can read **all** chats (today's policy stays).
- **D-96 (Q-D):** **each message creates a notification row** for the other party.

Planner defaults (assumptions, to confirm with Jimmy):
- **A-33:** the new-message notification never contains the message text, only that a new message arrived on a booking (the existing rule keeps phone numbers, addresses and allergy text out of notifications).
- **A-34:** "hidden" in D-94 applies to the two parties. The admin still reads those chats (D-95).

## Left out

Chat UI (T-047), reviews and reports (T-048), notification read route (T-048), the street-address check in chat (Q-23, still open), attachments and photos in chat, deleting or editing messages.

## Decision

Ask Jimmy per agent: Approve, Reject or Approve with changes, plus Q-A to Q-D. Decide ids `WO-5a-backend`, `WO-5a-tester`, `WO-5a-reviewer`.
