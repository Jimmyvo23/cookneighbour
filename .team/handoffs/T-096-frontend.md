# Handoff: T-096 Guard useChat Retry against stale answers

From: frontend  To: tester

## What changed
- Branch: `feature/T-096-chat-retry-guard`
- Pull request: see PR "T-096: Guard useChat Retry against stale answers"
- Files: `src/components/chat/useChat.ts`, new `src/components/chat/ChatSection.t096.test.tsx`, this handoff.
- `useChat`: one `settle()` runs every phase-settling load (first, late, Retry). An `epoch` ref (bumped on unmount and on booking change) stops older loads writing anything, including the hidden/closed write in `loadAll`. Rules: hidden/closed always win over a later ok; ok moves loading/error to ready (T-092 kept); a failure only counts while phase is still loading, so it cannot bring the error box back over messages. `reload` only sets "loading" when phase is "error". Removed the duplicated "Events are best effort" comment.

## How to verify
`npx vitest run src/components/chat` (105 pass). The two new race tests fail on the old `useChat.ts` and pass now. Full suite 2916 pass; lint, tsc, prettier clean.

## Known gaps or risks
- Builder choice (unconfirmed): I used "phase-based" rules rather than a strict "latest request wins" counter, because a strict counter would leave the first load's ok ignored if the late load is slow, or let a late failure beat an earlier success.
- Builder choice (unconfirmed): `loadAll` called from `post` is also epoch-guarded (no write after unmount).

## What the next agent needs
Tests use the T-089 fake `connect` with gated fetches (retry = first gate, late load = second).
