# Handoff: T-047 Chat UI

From: frontend  To: tester

## What changed
- Branch: `feature/T-047-chat-ui`
- Pull request: see the PR for issue #173 ("T-047: Chat UI")
- Stop condition checked first: the browser client works with the existing auth cookies, so no auth change was needed. `@supabase/ssr` writes the session cookies (`sb-<ref>-auth-token`, chunked) with `httpOnly: false` (library default, `node_modules/@supabase/ssr/dist/main/utils/constants.js`); `src/lib/supabase/server.ts` and `src/proxy.ts` pass the library's cookie options through unchanged, and the login route sets cookies only through that server client. `src/lib/supabase/client.ts` (`createBrowserClient`, publishable key) already existed and reads them. Not verified live: I could not open a real hosted Realtime connection from this machine (see risks).
- Files added:
  - `src/lib/chat/state.ts` (+test): pure list state, merge by `id` then `clientId`, pending/failed items, `rowToView`.
  - `src/lib/chat/realtime.ts` (+test): the only Supabase code of the chat. Session from cookies, `realtime.setAuth`, channel `chat:<id>`, filter `booking_id=eq.<id>`, `removeChannel`.
  - `src/components/chat/useChat.ts`: subscribe first, walk `nextCursor`, reload after reconnect, send/retry, 409 refetch-and-match.
  - `src/components/chat/ChatSection.tsx` (+test, 28 tests): the panel.
  - `e2e-mock/t047-chat-mock.spec.ts`: 14 mock e2e at 375 px with axe.
- Files changed: `BookingDetailView.tsx` and `ChefBookingView.tsx` (one `<ChatSection>` each: customer after "Where and who", chef after the answer section), `testkit.tsx` (an unrouted `GET .../messages` answers an empty page), `mock-messages.ts` / `mock-bookings.ts` / `mock-messages.test.ts` (new test hook `messagesFailNext`: next send answers 500 once, so e2e can reach the retry button), `src/lib/booking/changes.ts` + 3 test files (D-63).
- Existing test touched: `e2e-mock/allergy-profile-tester-mock.spec.ts`. Its "break the profile save" hack re-armed on every later write of the MOCK state, and the chat's first read now writes the state (the mock greeting), so a broken `role: chef` got saved. The hack is now one-shot (`__armed`). No assertion changed.
- Impeccable: `detect` on `src/components/chat` found nothing. Helper-agent steps (finish reviewer, documenter) skipped per D-44.

## How to verify
- `npm ci && npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run test:e2e:mock`
- By hand (mock): `NEXT_PUBLIC_API_MOCK=1 npm run dev`, log in as `sam@example.com`, set `sessionStorage` hooks as in `e2e-mock/t047-chat-mock.spec.ts`.
- Real Realtime (needs a hosted or local stack): two browsers, customer and chef of one accepted booking; send from one, the other shows it and the status region reads "New message from <name>: ...".

## Known gaps or risks
- Live Realtime is untested end to end in a browser. Unit tests use a fake channel. A real-route e2e is for the Tester if the CI stack allows.
- **D-63 deviation, please confirm:** "Chat stays open." is back in `CONTACT_RULE` (so also `CONTACT_ENDED_TEXT` and the open-window text) but NOT in `CONTACT_LOCKED_TEXT`. That text is shown for a cancelled booking, and D-94 hides the chat of a cancelled booking, so the sentence would be false. The assertion on `CONTACT_LOCKED_TEXT` now stays `not.toContain`. Related small gap: `CONTACT_ENDED_TEXT` is also shown for a no-show booking (chat hidden) and would say "Chat stays open." there. Fix needs the status in the text, not done (out of scope).
- Ordering of two messages with the same millisecond may differ between Realtime (`Date.parse` drops microseconds) and the server's `(createdAt, id)` order; a reload corrects it.
- A message that hits `chat_hidden` on send makes the whole chat disappear (no "not sent" bubble), as D-94 says nothing may show.
- The booking page itself does not refetch on a chat 409, so a "frozen" note comes from the chat's own state until the page reloads.

## What the next agent needs
- Design choices to confirm (Jimmy):
  1. Failed load of the history is a `role="status"` block with a button, not an alert (so it does not fight other alerts on the page).
  2. Refused text (contact guard, 429, too long) stays in the box and focus goes to the error above the box. A network failure moves the message into the list as a "Not sent" bubble with Retry and Remove, and focus goes to that bubble. After retry success or Remove, focus goes back to the box.
  3. The 2000 limit is a counter plus an error on Send, not a hard `maxLength` (so pasted text is not silently cut).
  4. Enter inserts a new line (no send-on-Enter).
  5. Frozen note uses the contract's neutral text ("This booking is on hold while an admin looks at it, so the chat is read only for now.").
  6. The message list is a scrollable region (`max-h-96`) with `tabindex=0`; it sticks to the newest message unless the reader scrolled up.
- Probe: each status (declined, cancelled, expired, no-show, requested past `expiresAt` = nothing, no request made); frozen via the hook; the same `clientId` on retry (check the POST bodies); the echo of my own message never doubles; a 409 on retry finds the saved message; reconnect reloads once; unmount removes the channel; focus after each error; `aria-live` only for the other party's messages; the MOCK label; no Supabase URL or client in mock mode (the client module is loaded only by the real `connect`); browser console on a real stack.
- Mock hooks: `messagesRateLimited`, `messagesFailNext`, `frozenSeeded`.

## Round 2 (Tester findings)
- **MED-1:** `changes.ts` now has `chatStaysOpen(b)` (accepted or completed, not frozen), `contactOpenText(w, chatOpen = true)` and `contactEndedText(chatOpen)`. Both booking pages pass it, so "Chat stays open." is left out for no-show and frozen bookings. `CONTACT_RULE`, `CONTACT_ENDED_TEXT` and `CONTACT_LOCKED_TEXT` keep their values (the Tester's constants tests still hold). The 8 `it.fails` in `ChatContactText.tester.test.tsx` are plain `it` now, assertions unchanged; I added frozen cases (accepted and completed, open and ended window, both roles).
- **LOW-2:** a failed bubble shows no "Retry sending" once the chat is read only, and `retry` makes no POST then. "Remove message" stays. `it.fails` removed.
- **LOW-3:** the live region keeps its element but its text sits in a `<span>` with a new key per announcement, so two identical messages both change the DOM. `it.fails` removed.
- **LOW-4:** the `testkit.tsx` fallback now matches GET. This made the chat actually render in older page tests, which exposed two things I fixed:
  - the chat textarea came first in `ChefEndSections.test.tsx` and `ChefEndSections.tester.test.tsx` selectors; those selectors now skip `[data-testid="chat-box"]` (selector only, no assertion changed; the textarea has that test id now);
  - the chat's empty error box (`chat-error`) had `role="alert"` all the time and was the first alert on the page. It gets `role="alert"` only while an error shows (the Tester's test that expects the element with empty text still holds).
