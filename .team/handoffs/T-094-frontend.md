# Handoff: T-094 + T-092 Live chat delivery fix and useChat late load

From: frontend  To: tester

## What changed
- Branch: `feature/T-094-live-chat-fix`
- Pull request: see the PR for this branch (title "T-094: Live chat delivery and late load (T-092)")
- Files: `src/lib/chat/realtime.ts` (+ test), `src/components/chat/useChat.ts`, `src/components/chat/ChatSection.t089.tester.test.tsx`, `e2e/demo-path-real.spec.ts`.
- T-094: each subscription uses topic `chat:<bookingId>:<unique>`. The browser client is a singleton and returns the same channel for the same topic, so an overlapping remount closed the new mount's channel. Authorization check: the migrations have no Realtime Authorization policies on `realtime.messages`; the `postgres_changes` rows are filtered by row-level security on `public.messages`, so the topic is only a label and a suffix cannot widen access.
- T-092: the late load (channel joined after the first load started) sets `ready` when the phase is `error` or `loading` and it succeeded. The first load sets `ready`/`error` only while the phase is still `loading`, so a late `hidden` is not overwritten.
- e2e (after #190 merged, `origin/main` merged in): `REALTIME_IS_KNOWN_BROKEN = false`; L-1 annotation `REALTIME-FLAG-STALE` if the flag is true and live delivery passes; L-2 the service-role client is built only when `API_URL` host is 127.0.0.1 or localhost.

## How to verify
`npm run lint`, `npx tsc --noEmit`, `npx prettier --check src e2e`, `npx vitest run` (all pass locally). The real-stack e2e live step runs only in CI.

## Known gaps or risks
Realtime was not run locally (no Docker). The existing T-089 test that pinned "error box stays after a late load" was changed to the new behaviour (T-092). The impeccable detect step was not needed (no visual change).

## What the next agent needs
Builder choices, unconfirmed: (1) topic suffix = base36 time + counter; (2) a late successful load also moves `loading` to `ready`; (3) L-2 uses an `expect` (fails the test) rather than skipping; (4) `false as boolean` so the flag stays a typed switch and the L-1 branch type-checks.
