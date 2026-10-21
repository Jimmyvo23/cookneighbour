# Work Order WO-T094-T092: Live chat delivery and late-load fixes

Tasks: T-094 and T-092 (frontend). Branch `feature/T-094-live-chat-fix`, worktree `../CookNeighbour-wt-T094`, based on `main` at `c5d172d`. The `e2e/demo-path-real.spec.ts` part of T-094 waits until T-050 (PR #190) merges; then the branch merges `origin/main`.

Runs beside WO-T093-T095 (backend, separate files) during Jimmy's 1-hour parallel window (2026-10-21).

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| frontend | T-094 + T-092 | Test first. T-094 (B-1, MED): give each subscription a unique Realtime topic in `src/lib/chat/realtime.ts` so an overlapping remount cannot close the topic the new mount uses; unit test with a fake client that, like `@supabase/ssr`, is a singleton and reuses channels by topic, with two overlapping mounts. After #190 merges: set `REALTIME_IS_KNOWN_BROKEN = false`, add Reviewer L-1 (annotate if the live check passes while the flag is true) and L-2 (local-host guard on the spec's service-role client). T-092: the late load in `useChat` updates `phase` (`error` -> `ready`); the first load sets `ready`/`error` only while `phase` is `loading`. | M | The topic name must still match the Realtime authorization rules, or the channel is refused |
| tester | T-094 + T-092 checks | Overlapping mounts and remounts deliver live messages; the real-stack e2e live step passes in CI; failed first load then join clears the error box; a late `hidden` answer is not overwritten; no duplicate messages or extra loads. | M | Realtime only runs in CI (no Docker locally) |
| reviewer | T-094 + T-092 review | Realtime authorization still limits each topic to the booking's two parties, no leaks of other bookings' messages, honest test flags, accessibility of the error box. | S | Low |

## Rules it builds on
D-131 (WO-T050-T089), T-050 Reviewer comment 6319621250 (B-1, L-1, L-2), T-089 Tester and Reviewer LOWs (D-138).

## Left out
Chat UI redesign, notifications, T-052 accessibility pass.

## Decision
Decide ids `WO-T094-frontend`, `WO-T094-tester`, `WO-T094-reviewer`.
