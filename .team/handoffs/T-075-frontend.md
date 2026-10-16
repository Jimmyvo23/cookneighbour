# Handoff: T-075 One timeout for every API call

From: frontend  To: tester

## What changed
- Branch: `feature/T-075-api-timeout`
- Pull request: see PR "Closes #139"
- Files: `src/lib/api/client.ts`, `src/lib/api/client.test.ts`, `src/lib/admin/queue.ts`, `src/lib/booking/changes.ts`, `src/components/search/SearchView.tsx`, `e2e-mock/admin-t036-tester-mock.spec.ts`.
- `apiFetch` now has `API_TIMEOUT_MS = 20_000` (exported). One timer covers waiting for the answer AND reading the body (`res.json()`), through all paths (real fetch, injected `fetchImpl`, mock adapter). On expiry it rejects with `ApiClientError(0, "TIMEOUT", ...)` and calls `AbortController.abort()` (signal passed in `init.signal`, so a real fetch is cancelled). Reject happens before abort so the abort's own error cannot win and be reported as NETWORK. A Promise.race is used (not only the signal) because injected fetches, the mock adapter and body reads ignore the signal. Timer is cleared in `finally`.
- Messages: GET "The server took too long to answer. Please try again."; POST/PUT/PATCH/DELETE "...Your change may or may not have gone through. Check before you try again."
- No per-call override: none of the 23 callers needs one (no uploads go through `apiFetch`), so it was not added.
- Callers that switched on `NETWORK` (`SearchView`, `booking/changes.ts`, `admin/queue.ts`) now list `TIMEOUT` too; all other callers show `err.message`, which is the honest text. Focus-on-error code is untouched.
- `docs/api-contract.md` does not document client error codes (no `NETWORK` there), so it is unchanged.
- Impeccable: no visual change, so `impeccable detect` not run; helper agents skipped per D-44.
- Existing e2e `admin-t036-tester-mock` "link retry" needed a change: under Playwright's fake clock, the clock runs ahead of the mock's real async work, so a failing call could end by the 20 s timeout instead of the mock 404, moving the retry one 30 s step later. `fastForward` fires each due timer once, so the recovery step now jumps `00:31` twice. Passed 3/3 alone and in the full run. Tester please sanity-check this edit.

## How to verify
- `npm run lint`, `npm run typecheck`, `npx prettier --check .` clean.
- `npm test`: 85 files, 2036 passed + 3 expected fails (was 2002 baseline; 15 new in `client.test.ts`: default range, GET message, 4 write methods, signal aborted, hung body, mock path, timer cleared on success/network error, no late timeout).
- `npm run test:e2e:mock`: 243 passed.
- No mock e2e added for the timeout itself (not cheap: it needs a 20 s fake clock jump against a hung mock).

## Known gaps or risks
- 20 s is a guess in the 15-20 s range given; slow uploads of large files are not routed through `apiFetch`, so no impact found.
- A timed-out write may have succeeded; the message says so, no automatic retry is done.

## What the next agent needs
- Reviewer: check the fake-clock e2e edit and the race/abort ordering in `apiFetch`.
