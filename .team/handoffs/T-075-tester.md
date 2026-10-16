# Handoff: T-075 apiFetch timeout (Tester)

From: tester  To: reviewer
Verdict: PASS (no bugs found)

## What was checked
- `src/lib/api/client.ts`: one 20 s timer covers the wait and the body read, on real fetch, injected fetchImpl and the mock adapter. TIMEOUT is its own code (status 0), separate from NETWORK. Reject runs before abort, so an AbortError from a real fetch cannot win and show up as NETWORK. `finally` clears the timer on success, error status, network error and timeout. The losing exchange has `.catch(() => {})`; the timeout promise can only settle while the timer is live, so no dangling rejection either way.
- Messages: GET says "Please try again"; POST/PUT/PATCH/DELETE say "may or may not have gone through. Check before you try again." Honest, no promise either way.
- Callers: only 3 places branch on `NETWORK` (SearchView, booking/changes.ts, admin/queue.ts); all now include TIMEOUT (the two non-search ones are no-ops that return `err.message`, as before). Everything else shows `err.message`; focus code untouched.
- `admin-t036-tester-mock` "link retry" edit: a real fix, not a hidden behaviour change. Under a fake clock `fastForward("04:10")` can run ahead of the mock's real async work, so the failing call ends by the 20 s timeout instead of the mock 404 and the next 30 s retry lands one step later. The second `fastForward("00:31")` is harmless when no timeout happened (recovery already done). The assertions on "6 to 9 tries in 4 minutes" and "no stacking" still pass. User-visible effect in real life: only a request that hangs now fails after 20 s (before: never), then the 30 s retry follows (so about 50 s between tries in that case). Run 18 times in a row (6 x repeat-each 3, 4 workers): 18/18 passed.

## Tests added (src/lib/api/client.test.ts, 15 -> 19 timeout-related tests; file now 23)
- A fetch that rejects with AbortError on abort still gives TIMEOUT (not NETWORK), timer count 0.
- No timeout at limit minus 1 ms; TIMEOUT at the limit.
- Late success and late network failure after a timeout raise no unhandled rejection (process listener).
- Timer cleared on a 500 contract error and on a non-contract 502.

## Results (head before my commit 8d53b72)
- lint clean, typecheck clean, `prettier --check .` clean.
- `npm test`: 85 files, 2040 passed + 3 expected fail (builder: 2036).
- `npm run test:e2e:mock`: 243 passed.
- API/RLS suites not run (no Docker; CI only).

## INFO
- No mock e2e for the timeout itself (needs a 20 s fake-clock jump on a hung mock); unit tests cover the mock path.
- 20 s is the builder's pick in the 15-20 s range; no upload goes through apiFetch.
- A timed-out write is not retried automatically; correct.

## RLS flake: tests/rls/booking-api.test.ts:191 (NOT fixed, not in this PR)
`chefs_booked_on(far(5))` = today+15 (Toronto) returns every APPROVED chef with an active booking_day on that date (expired requests excluded). I read every date use in tests/api and tests/rls and could not find a file that books on today+15. Facts that narrow it:
- Not booking-changes (rls, far(90)), contact-privacy (far = 40+n), receipts (30/60), escalation/storage/booking-rules/global-setup (baseDay = today+40 to +639, plus offsets), flag-freeze (420+/700+ random), kitchen-followups rls (today+5, or moved to the past), kitchen-followups-tester rls (1 to 4, 200+).
- tests/api uses `day(n)` (Toronto today) with offsets mostly 1 to 10; `kitchen-followups-tester.test.ts` books four different chefs on offsets 11, 12, 13, 14 (`homeRequest(11|13|14)`, plus `day(12)`), and `kitchen-followups.test.ts` rls books four chefs on today+5. "Four chefs" matches those four-chef groups, but their dates are not +15 unless a date helper is off by days, which I did not find (`torontoToday` and the rls `todayTo` use the same Toronto formatter).
- Candidate to check by whoever fixes it: the CI database is shared by the api and rls projects that run in parallel, and `chefs_booked_on` has no per-chef filter. Quick probes for next time: on failure print the returned ids and look up their `booking_days` rows and the chef emails (the fixture names show which test file made them). The cheapest robust fix is to assert `toContain(chef.id)` for the chef created in the test (and `not.toContain` for the rejected/pending ones) instead of `toEqual([chef.id])`, or move that test to a date nobody else uses (far(90) is taken; far(120) is free).
- I could not confirm the cause by reading alone. Start of the failure on main at 340dcc4 suggests a test added between 4b6b43f and 340dcc4 (kitchen-followups-tester api/rls, contact-privacy, flag-freeze, saved-intake, groceries).

## Next
Reviewer: look at the race/abort ordering in `apiFetch` and the fake-clock e2e edit.
