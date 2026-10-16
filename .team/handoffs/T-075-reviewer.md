APPROVE (Reviewer, T-075, head 901b515)

The change matches PLAN.md row T-075 and D-69: one timeout for every `apiFetch` call, with a clear message. There is no scope creep: 6 code/test files plus two handoffs, and no server, schema or RLS changes.

## What I checked myself
- `npm run lint`, `npm run typecheck`, `npx prettier --check .`: all clean.
- `npm test`: 85 files, 2040 passed + 3 expected fail (same as the Tester).
- Mock e2e `admin-t036-tester-mock` "link retry" with `--repeat-each 5`: 5/5 passed. Both fake-clock specs (`admin-mock`, `admin-t036-tester-mock`) with `--repeat-each 3`: 87/87 passed.
- I did not run the full mock e2e suite or the API/RLS suites (no Docker). I relied on the builder and Tester for those, and on CI.

## Race, abort and leaks (src/lib/api/client.ts:84-134)
- The order is correct. In the timer callback, `reject(TIMEOUT)` runs before `controller.abort()` (client.ts:89-96), so the race is already settled before the AbortError from fetch or the body read can arrive. A real fetch reports TIMEOUT, not NETWORK. The test "real-style fetch that rejects with AbortError" covers this.
- No leaked timer. `clearTimeout` runs in `finally` (client.ts:133) on every path: success, contract error, non-JSON error, NETWORK and TIMEOUT. The tests check `vi.getTimerCount() === 0` for each one.
- No unhandled rejection:
  - The losing `work` promise has `.catch(() => {})` (client.ts:130).
  - `timedOut` can only reject while the timer is still running, and `Promise.race` always has a handler attached to it.
  - If `work` wins, `timedOut` stays pending forever with no references, so it is garbage-collected.
  - The "late answer" test listens on `process` and confirms there is nothing unhandled.
- One timer covers the dynamic mock import, the fetch and `res.json()`, which is what the plan asked for. The race is still needed because the mock adapter, injected `fetchImpl` and body reads ignore the signal. The comment at client.ts:100-101 explains this correctly.
- The abort only fires after the timeout, so a request that succeeds is never cancelled.

## Copy
- GET: "The server took too long to answer. Please try again." (client.ts:55). Honest.
- Writes: "...Your change may or may not have gone through. Check before you try again." (client.ts:57-58). Honest. It does not promise that nothing was saved, and there is no automatic retry. The tests check that the message does not say "nothing was saved". No MOCK label is needed: this is transport wording, not a mocked feature.

## Callers
- Only three callers switch on the error code, and all three now include TIMEOUT: `SearchView.tsx:123`, `lib/booking/changes.ts:61` and `lib/admin/queue.ts:155`. Both NETWORK and TIMEOUT return `err.message`, so the wording comes only from client.ts.
- No caller checks `status === 0` (grep found none). Every other caller shows `err.message`.
- The focus-on-error code was not touched, and the error still comes through the same `ApiClientError` path.

## Is 20 s right? Is any caller long-running?
- 20 s fits the 15-20 s range. File uploads go straight to Storage through `lib/chef/upload` (`uploadForChef`, `browserUploader`), not through `apiFetch`. `apiFetch` only sends the JSON that registers the file path, so I found no long-running caller.
- I found no other code in `src` that uses AbortSignal, so nothing conflicts with the new signal.

## e2e change (e2e-mock/admin-t036-tester-mock.spec.ts:309-313)
- This is a real fix, not a weaker test. Under Playwright's fake clock, the mock adapter's work runs partly in real time (dynamic import, `setTimeout(150)` registered late), so a large jump can fire the 20 s timeout before the mock's 404 arrives. That pushes the next 30 s retry one step later. The 30 s retry interval is a client rule, so the timeout in this PR does not break it.
- The checks that matter are unchanged: 6 to 9 tries in 4 minutes, no stacking, the notice goes away on recovery, no calls for 3 minutes afterwards, then exactly one renewal. The only thing that changed is that recovery may now take up to 62 s of fake time instead of 31 s.

## Findings
- LOW, e2e-mock/admin-t036-tester-mock.spec.ts:309: the edit makes the one known case pass. The underlying problem is that any future mock e2e test that jumps the fake clock past 20 s while a mock call is still running can get TIMEOUT instead of the mock's answer. Only the two admin specs use `page.clock` today, and both passed 87/87 on repeat. Suggestion: add one line to `docs/lessons-learned.md` (for example, "with page.clock, jumps of 20 s or more can trip the apiFetch timeout on in-flight mock calls; use runFor in small steps or allow one extra retry step"). This does not block.
- INFO, client.ts:57: after a timed-out write, the user is told to check before trying again. A blind retry of `POST /api/bookings` is still protected on the server by the existing double-booking rules (DATE_BOOKED / chef double-booked). Other writes, such as messages and reviews, have no idempotency key, so a retry could create a duplicate. That is acceptable for a prototype, and the copy is honest about it. It could become a T-048 hardening note.
- NIT, client.ts:126-127: `let res: Response; let data: unknown;` above the `try` shadow the `res`/`data` names inside `exchange`. The code is correct, just a little hard to read.
- NIT, PLAN.md:177 suggests `AbortSignal.timeout` as an example. Using AbortController plus a race is the better choice here because it also covers the mock and the body read. Not a deviation.
- INFO: the red `ci` (`tests/rls/booking-api.test.ts:191`, T-079 / #141) cannot come from this PR. The PR does not touch `tests/`, `src/app/api`, `src/lib/server`, migrations or seed data, and `apiFetch` is browser-side only. The Tester's diagnosis (shared CI DB, `chefs_booked_on` with no per-chef filter, so prefer `toContain`) is a good place to start for T-079.

## Handoffs reviewed
- `.team/handoffs/T-075-frontend.md`
- `.team/handoffs/T-075-tester.md` (PASS)

Neither handoff makes a false claim. One small mismatch: the builder says "23 callers" and I counted 20 non-test files that import `apiFetch`. Some files may contain more than one call site, so this does not matter.

