# Handoff: T-096 Guard useChat Retry against stale answers (Tester)

From: tester  To: reviewer

## What changed
- Branch: `feature/T-096-chat-retry-guard`, tested head 62fbba4.
- Added `src/components/chat/ChatSection.t096.tester.test.tsx` (22 tests). No app code touched.

## What I checked
- First vs late load, all 8 ok/fail/hidden combos with the late answer first, plus both "first answers first" orders: ends hidden, ready or error as the rules say; never stuck on loading.
- Retry plus late load both in flight, both fail: error box, and a further Retry still works. Retry failing then Retry working. Retry answering hidden.
- `reload` on the hook while ready (no flash to loading, a failure keeps ready) and while the first load is in flight.
- Booking id change mid-load: old ok, old hidden and old failure write nothing to the new booking. Unmount mid-load and mid-send: no console error.
- Send path: new message shows; frozen refusal still reloads.
- Against the old `useChat.ts` 4 of the new tests fail (switch x2, reload x2); the 2 builder race tests also fail there.

## Results
- `npx vitest run`: 2938 passed, 3 expected-fail (older). `npm run lint`, `tsc --noEmit`, `prettier --check src e2e` clean.
- No bugs found. PASS.

## Known gaps or risks
- INFO: a second `hidden` answer after `closed` would turn the "closed" notice into "hidden" (`loadAll` uses `wasOpen = phase === "ready"`). I could not reach it: a hidden answer closes the channel and removes the composer, so no later load runs. Older code, not from this PR.
- The builder's phase rules (not strict latest-wins) stay an unconfirmed builder choice; every ordering above ends in a sensible state.
- Reviewer L-1 and L-2 from PR #194 are both fixed by this PR.

## What the next agent needs
Tests use gated fetches (one gate per GET, in call order).
