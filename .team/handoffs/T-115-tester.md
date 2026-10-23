# Handoff: T-115 Midnight-safe bookings API date test

From: tester  To: reviewer

## What changed
- Branch: `feature/T-115-midnight-date-test`
- Pull request: see PR "T-115: Midnight-safe bookings API date test" (Closes #224)
- Files: `tests/support/midnight.ts` (new, `retryIfDayRolled`), `tests/support/midnight.test.ts` (new, fake-clock unit tests), `tests/api/bookings.test.ts` (two tests wrapped), `vitest.config.mts` (include `tests/support/**/*.test.ts` so the unit test runs locally), WO file, this handoff. No app code.

Root cause (run 39897551788 attempt 1, 04:11 UTC = 00:11 Toronto): `bookableChef({ticked:[0,1,2,3]})` ticked 22..25 Oct while Toronto was still 22 Oct; the API's "today" was then 23 Oct, so bookableDates was [24,25]; `day(1..3)` was recomputed after midnight as [24,25,26]. Log: "expected [ '2026-10-24', '2026-10-25' ] to deeply equal [ ..., '2026-10-26' ]" at bookings.test.ts:1453.

Fix: `retryIfDayRolled(body)` runs the body; if it throws AND the Toronto date changed during the run, it runs the body once more from scratch (new chef, new day). A failure on a steady date is rethrown at once, and a failure that repeats after the roll is still rethrown. Assertions are untouched.

## How to verify
- `npx vitest run` : 3204 passed, 3 expected fail (includes the 5 new tests in tests/support/midnight.test.ts, one reproduces the flake with a fixed clock across 03:59/04:00 UTC).
- `npm run lint`, `npm run typecheck` : clean.
- API tests run only in CI (no Docker locally).

## Known gaps or risks
- The retry cannot be exercised for real at midnight locally; proof is the fake-clock unit test plus the log analysis.
- A roll during the retry itself (minutes later) is not covered; that needs a second midnight.
- Siblings with the same pattern (ticked offset relative to `day()` and an exact list from the public API), NOT changed: `tests/api/bookings.test.ts` "D-27 today is refused" (~line 259, ticked [0,1,2]) and ~277 (ticked [1,2,3]); the D-22 test (ticked [2,3,4], `DATE_BOOKED` dates ~1490); tests at ~1522, ~1539, ~1597; `tests/api/bookings-tester.test.ts:278`; `tests/api/search.test.ts:607` (`bookableDates` toEqual `inside`). Wrapped as identical: the "expired request ... does not hide the date" test (ticked [2,3], exact bookableDates list).
- Builder choice: unit test lives in `tests/support` with a one-line vitest include change, because the API config needs local Supabase.

## What the next agent needs
Confirm assertions are unchanged (diff is indentation plus the wrapper). Consider a follow-up to wrap the listed siblings.
