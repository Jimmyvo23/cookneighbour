# Handoff: T-094 + T-092 Tester

From: tester  To: reviewer

## Result: PASS (no bugs)

## What I checked
- Topic `chat:<bookingId>:<base36 time>-<counter>`: no `realtime.messages` policies in `supabase/migrations` (grep); delivery is `postgres_changes` with `filter: booking_id=eq.<id>`, and the select policy `messages_select_party` (is_booking_party and booking_chat_open) still limits rows to the two parties (admin policy unchanged). The topic is only a label.
- useChat: late load moves error/loading to ready on ok only; first load acts only while `loading`; late `hidden` is not overwritten; hidden closes the channel.
- Changed T-089 test is the intended T-092 behaviour; no other pinned assertion weakened (diff reviewed: one test rewritten, two added).
- CI run 39646331714 (head 7516012): `demo step 3 (live)` passed (10.1s) with the flag false, so the hard `expect` on both sides and `toHaveCount(1)` (no duplicate) ran. L-2 guard ran and passed on local stack.

## Tests added
`src/components/chat/ChatSection.t094.tester.test.tsx` (4 tests, real `makeConnectChat` on a singleton fake client): StrictMode double mount delivers once and leaves one channel; 4 remounts leave no channel and topics are unique; another booking's row never arrives (filter per booking + page drops wrong booking id); retry button still clears the error box when no late join. Mutation check: with the old fixed topic, 3 of 4 fail.

## Findings (all LOW / info)
- LOW: `useChat.ts` has a duplicated comment ("Events are best effort") in the late-load block. Cosmetic.
- INFO: topic uniqueness uses a module counter plus Date.now; fine for one tab, unique per tab per ms is not needed.
- INFO: `false as boolean` keeps the L-1 branch type-checkable; acceptable.
