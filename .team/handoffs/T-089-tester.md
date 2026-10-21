# Handoff: T-089 Tester

From: tester  To: reviewer

## Verdict
PASS. No blocking bugs.

## What was checked
- refusal.tsx: empty, spaces, tab, newlines, CRLF, NBSP and mixed whitespace-only text give only the status sentence. Normal text, text ending in . ! ?, and trailing spaces/tabs/newlines/NBSP are unchanged (one full stop). Leading whitespace is kept as before.
- useChat.ts: flag is set when the first load starts. A Realtime row during the first GET shows once (also with a repeated event and with both GETs returning it). A message missing from the stale first GET but present in the second load is shown once even when the first GET answers last. Repeated "live" statuses cause no loop: one late load, then one load per drop. No extra load while the channel never joins.
- Changed Tester test (expects 2 loads): correct. The approved fix says a join after the first load starts must load again; the extra load is safe because mergeServer dedupes by id and it runs once only (everLive).

## Findings
- LOW (info, not a regression, not fixed): if the first GET fails and the channel then joins, the late load succeeds in the background but the load-error box stays and the messages stay hidden until the person presses the retry button. Pinned in a test. Same as before T-089.
- Note: in real use the channel normally joins after the first GET starts, so most chats now do two loads on open (intended by the fix).

## Tests added
- src/components/chat/ChatSection.t089.tester.test.tsx (5 tests)
- src/components/refusal.test.tsx (+9 cases in a new describe)

## Results
lint, typecheck, prettier clean. npm test: 2394 passed, 4 expected fail. test:e2e:mock t047-chat: 33 passed.
