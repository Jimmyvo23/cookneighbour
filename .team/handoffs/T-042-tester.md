# Handoff: T-042 Booking API: create, answer, expire

From: tester  To: reviewer

## What changed
- Branch: `feature/T-042-booking-api`; PR https://github.com/Jimmyvo23/cookneighbour/pull/95
- Verdict: **PASS**. No production code edited. No bugs found that block.
- Added `tests/api/bookings-tester.test.ts` (37 cases incl. repeats; commits pushed to the branch):
  - Races repeated: 5 rounds of 4 overlapping 2-day requests on one chef (no date double-booked, each loser leaves no booking); 4 rounds of 6 parallel creates from one customer (exactly 3, D-28); 5 rounds of the free trial claimed in parallel by two accounts at one address (exactly one claim); 5 rounds of accept vs decline (one answer, claim matches, one answer note).
  - Atomicity: a refused trial on a 3-day request leaves no booking, days, note; non-trial booking has `is_free_trial` false and no claim; a double-booked loser who asked for the trial keeps the trial.
  - Notifications (requested, accepted, declined, expired, both sides) contain no phone, address, name, intake text or user id.
  - D-19 expiry = min(72 h, 00:00 Toronto day 1) for first visit in 2, 3, 4, 6 days; multi-day request uses its earliest day.
  - Expiry from plain reads: a customer GET expires it, frees the date, releases the trial; decline of a stale request refused; an accepted booking never expires.
  - Malformed input gives 4xx not 500: impossible date, date with time, numeric/null date, no days, no dishes, quantity 0/-1/1.5/1000.
- CI run 38099585434 on the final commit: **success** (lint, typecheck, prettier, unit, build, RLS, API, seed, Playwright real and mock all green). An earlier run (38099097619) failed only on two mistakes in my own new test (wrong intake field names, and the decline reason, which is meant for the customer); fixed in the tests.
- Local: lint, typecheck, unit (1457 pass, 3 expected fail) green. API and RLS only in CI (no Docker).

## How to verify
- `gh pr checks 95`; `gh run view 38099585434`.
- Locally `npm run lint && npm run typecheck && npm test`.
- The existing builder tests (bookings.test.ts 1502 lines, booking-api RLS) already cover: double booking, trial via same address/new account, D-23, D-27, D-28, D-22 DATE_BOOKED, D-31, hidden-chef identical 404, service area, chef's home, RLS on functions, address/phone hidden until accept. I read them and found them sound; I did not duplicate them.

## Known gaps or risks
- Races ran 5 rounds each in one CI run; no flake seen in either CI run (508/509 then all pass). The run to run flake rate is not measured beyond that.
- Not tested by me: a direct browser (anon-key) read of another customer's booking row via PostgREST (covered by the builder's tests/rls files, not re-run by me beyond CI green).
- Observation (Low, not a bug against spec): the chef's free-text decline reason is copied into the customer's notification body, so a chef could type a phone number or address there before acceptance. The spec says addresses/phones are hidden until accepted; consider a note or a filter in a later task (T-063/WO-5).
- Observation (Low): `completed` is set by nothing yet (backend already flagged); `expires_at` is lazy (no scheduler) until WO-7.
- Observation: mock adapter still lists today as bookable and the e2e-mock wording is stale (T-062/T-043), as backend noted.
- No secrets found in the diff; payment/ID wording unchanged. MOCK labels not applicable to the API itself (fee is shown, platformFeeCollected false is asserted).

## What the next agent needs
- Reviewer: focus on the decline-reason privacy point above, the lazy expiry design, service-role reads in estimate/create (after the role check), and the contract v1.4 wording.
- Do not commit this file from the branch: the Planner commits Tester handoffs.
