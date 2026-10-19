# Handoff: T-046 Messaging backend (Reviewer)

From: reviewer  To: planner

## Verdict
APPROVE. PR #171, head abb510a. PR comment: https://github.com/Jimmyvo23/cookneighbour/pull/171#issuecomment-6275031692
CI run 39305138139 green on abb510a (checks, e2e-mock, supabase, ci). Local on the head: lint, typecheck, prettier clean; npm test 2152 passed + 3 expected fails.
Handoffs reviewed: .team/handoffs/T-046-backend.md (rounds 1-2), .team/handoffs/T-046-tester.md.

## Findings (none blocking)
- LOW-1 docs/api-contract.md:581 says Realtime has no automated test; tests/rls/messaging-realtime.test.ts exists and passed in 4 CI runs. Contract rule says fix mismatches in the same PR: fix before merge if cheap, else in the Planner notes PR.
- NIT-1 src/lib/mocks/mock-messages.ts:67-87,145-147: MOCK accepts unknown/repeated query params, gives 201 for a clientId reused on another booking (real: 409 message_id_reused), and does not hide stale requests. List these in the header or match the real routes (matters for T-047).
- NIT-2 src/lib/domain/messages.ts:62: length counts UTF-16 units, the DB counts code points; emoji-only text caps at about 1000. Stricter than the DB, so safe.
- NIT-3 tests/api/messaging-edge.test.ts:280 test name ends in "?" but asserts 409; :377-379 check guarded by if (status===200), assert the status instead; tests/rls/messaging-realtime.test.ts:150-167 count-based after-hide check could fail wrongly on a late event (low risk).
- INFO for T-047: after a 409 frozen/chat_hidden on a retry, refetch and match by clientId (choice 3). Oldest-first paging means walking all pages (choice 7). For T-048: admin chat view needs a route or RLS read (choice 10).

## Checked
- Migration 20261021100000_messaging.sql: insert policy dropped; table and column insert grants revoked; no update/delete grant; both functions security definer with search_path ''; send_message service_role only; booking_chat_open returns true only for a party or the admin (round 2).
- Race of a send against accept/decline/cancel/freeze: FOR SHARE vs FOR UPDATE. If the status change commits first, the send sees the new status (chat_hidden or frozen). If the send locks first, the message lands just before the hide (correct order, admin still reads it). No leak, no deadlock. Contact guard cannot be bypassed by a race.
- Rules D-93 to D-96: open, hidden, frozen and stale statuses; duplicate clientId and retries after a state change; keyset paging with strict cursor decode; rate limit before the 404.
- A-33: notification is fixed text with no message text, name, phone or address.
- D-95: admin reads all chats through RLS and cannot send.
- Older tests engagement, hardening P4, visibility, global-setup: not weakened.
- New tests honest; the Realtime test checks negatives only after a positive control.
- 409/422 texts honest and neutral; MOCK greeting labelled "(MOCK message)".
- Scope within WO-5a; no secrets; no paid services.

## Builder choices
All 12 (11 from round 1 + round-2 blank-body refusal) acceptable as written. Jimmy may confirm 3 (strict state wins over a retry), 6 (30 per 60 s) and 10 (admin 403).

## Next
Planner: merge per D-42 (update-branch, green ci). Optionally take LOW-1 and the NITs first. After merge Jimmy runs `npx supabase db push --linked` for 20261021100000_messaging.sql.

## Round 3 confirm (head 7c56eee)
APPROVE stands. CI run 39308438863 green on 7c56eee (checks, e2e-mock, supabase, ci). PR comment: https://github.com/Jimmyvo23/cookneighbour/pull/171#issuecomment-6275434041. Diff abb510a..7c56eee touches only the contract, the MOCK and its tests, two test files and two handoffs; the migration and server/route code are unchanged. LOW-1 fixed (contract 7C names the Realtime test). NIT-1 fixed: the MOCK now gives 422 on unknown or repeated params, 409 message_id_reused across bookings and hides stale requests; 3 new mock tests. NIT-3 fixed: test renamed, cursor check asserts 200 with no if, Realtime after-hide uses not.toContain(marker). NIT-2 accepted as is. INFO: the round-3 mock test sends to the id named FROZEN, which is not frozen in that session; correct but the name could mislead. No new findings.
