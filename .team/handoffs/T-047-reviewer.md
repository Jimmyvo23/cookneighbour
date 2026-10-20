# Handoff: T-047 Chat UI (Reviewer)

From: reviewer  To: planner (then frontend)

## What changed
- Nothing (Reviewer is read-only). Reviewed PR #174, branch `feature/T-047-chat-ui`, head f7e1eea, against main.
- Read: `.team/handoffs/T-047-frontend.md` (rounds 1 and 2), `.team/handoffs/T-047-tester.md` (PASS with findings + re-check), WO-5b, contract 7C, CLAUDE.md 6.8 and 11, lessons-learned.
- Verdict posted as a PR comment: REQUEST CHANGES (https://github.com/Jimmyvo23/cookneighbour/pull/174#issuecomment-6280455887).

## How to verify
- CI on f7e1eea: green (run 39346504163: checks, e2e-mock, supabase, ci).
- Local: lint, typecheck, prettier clean; `npm test` 2278 passed + 3 expected-fail (older files, not T-047).

## Findings
MEDIUM (blocking)
- M-1. A chat that becomes hidden while it is open disappears silently, the typed text is lost and focus falls to <body>.
  - Code: `useChat.ts:237-238` (a 409 chat_hidden on send or retry returns kind "ok"), `useChat.ts:106-111` (the reload after a reconnect finds it hidden), `ChatSection.tsx:114` (return null) and `ChatSection.tsx:131-132` (ask("box") for a box that no longer exists).
  - Realistic case: the chef declines a request while the customer is typing. Nothing is announced, and the page still shows "Requested" because it does not refetch.
  - This is the lessons-learned section 3 bug class "Accessibility after errors". No test checks focus on this path.
  - Fix: an `onClosed` callback from ChatSection; both pages reload the booking and move focus to a page notice or the status; whether a one-line "The chat for this booking is closed." may show is Jimmy's call (D-105: yes); add tests that activeElement is not body after chat_hidden on send, on retry and on the reconnect reload.
LOW (same round)
- L-1 `ChatSection.tsx:339-350`: a sent bubble's time is read twice by screen readers (sr-only span plus the visible <p>, which is not aria-hidden for sent bubbles).
- L-2 `useChat.ts:57` with `ChatSection.tsx:170-175`: `live` starts as "paused", so a first connect can briefly show "Live updates are paused. Trying to reconnect...". That is untrue; add a "connecting" state.
- L-3 `realtime.ts:53-61` with `useChat.ts:128-175`: connect resolves before the channel is joined. A message inserted between the history GET and the join is missed until the next reconnect. Fix: reload once if the first SUBSCRIBED arrives after the first load.
- L-4 `useChat.ts:129`: onRow does not check `cancelled`, so a late old-channel event after a bookingId change can merge into the new list. Add `if (cancelled) return;`.
- NOTE: the comments on the former it.fails tests in ChatSection.tester.test.tsx still describe the old bugs.

## Checked and passing
- Browser client: publishable key plus the cookie session only (getSession, realtime.setAuth). supabase-js still forwards TOKEN_REFRESHED. The client module is lazy-imported and never loaded in MOCK mode.
- Hidden chats: nothing is fetched or subscribed (ChatSection returns null before useChat runs). The Tester's e2e confirms no /messages request.
- Error texts: the contact-guard text is the server constant and never echoes the typed details.
- Contact texts: chatStaysOpen makes "Chat stays open." true for every status (frozen and no-show drop it). CONTACT_LOCKED_TEXT without the sentence is correct under D-94.
- useChat: subscribe before load; walks the cursor; dedupes by id, then clientId; reloads after a reconnect (not on the first connect); unsubscribes on unmount; refetches by clientId after a 409; Retry hidden when read only.
- Accessibility: labels and aria-describedby; polite live region with keyed spans; one focus owner; role="alert" only while an error shows (OK, because focus always moves to it); 375 px with no sideways scroll; axe runs 12 times in the builder's e2e and 6 in the Tester's.
- Older-test edits weaken nothing: the allergy one-shot flag, the testkit GET fallback, the ChefEndSections selectors only, and the messagesFailNext one-shot 500.
- Plan compliance: no backend, SQL or route changes, no unread badges, no admin chat. Size is within the WO (mostly tests).

## Design choices for Jimmy
1. Enter inserts a new line: accept.
2. Counter instead of maxLength: accept.
3. Failed history load as a role="status" block with retry: accept.
4. List scrolls inside the card and sticks to the newest message: accept.
5. chat_hidden on send removes the chat: DO NOT accept as written (M-1).
6. CONTACT_ENDED_TEXT and CONTACT_LOCKED_TEXT handling through chatStaysOpen: accept.
7. Neutral frozen note and the focus rules: accept.

## Known gaps or risks
- No real-browser Realtime e2e. Moving it to T-050 is acceptable for merge (RLS Realtime is covered by tests/rls/messaging-realtime.test.ts, the hook by a fake channel, and the cookie is readable). The browser-to-cookie-session connect is still unproven: T-050 or a manual two-browser check on a real stack must happen before demo sign-off.

## What the next agent needs
- Frontend: fix M-1 and L-1 to L-4 in one round, with tests.
- Tester: re-check focus and the page refetch on chat_hidden (send, retry, reconnect), then the LOW items.
- Reviewer: re-review after that, then post APPROVE if clean.

## Round 2 re-review (881db6f)
Verdict: APPROVE (https://github.com/Jimmyvo23/cookneighbour/pull/174#issuecomment-6281274124). CI green on 881db6f (run 39352877609: checks, e2e-mock, supabase, ci); local lint, typecheck and prettier clean; `npm test` 2300 passed + 3 expected-fail (older file, not T-047). Fixed: M-1 per D-105 (an open chat that becomes hidden shows "The chat for this booking is closed." as role=status, focused on mount; onClosed triggers one quiet refresh that keeps `Ready` mounted; a chat hidden on page load stays silent), L-1 (time aria-hidden), L-2 (`connecting` state, no note), L-4 (onRow checks `cancelled`), test comments. One focus owner holds (ChatPanel unmounts inside loadAll, so its later focus requests do nothing). role=status plus focus is sound for this one-sentence notice. The refresh cannot loop (fires only on ready to closed; closedFor stops a remount; the page's seq guard drops stale refreshes). Scope unchanged: no backend or SQL. L-3 mostly fixed. Remaining LOW, not blocking, for T-050: `late` uses firstLoadDone, so a first SUBSCRIBED that arrives during the first GET can still miss a message from that gap; set the flag when the load starts. The real-browser Realtime e2e stays in T-050 and must run before demo sign-off.
