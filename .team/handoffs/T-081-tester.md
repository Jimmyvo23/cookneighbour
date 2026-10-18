# Handoff: T-081 Auto-complete a chef's-home booking when every day is picked up

From: tester  To: reviewer

## Verdict: PASS (no HIGH or MED findings)

## What changed
- Branch: `feature/T-081-auto-complete-on-pickup`, PR #160 (issue #159). Builder head 75b60aa; tester commits on top.
- Tests added (test files only, no app code touched):
  - `tests/api/auto-complete-on-pickup-tester.test.ts`: 7 API tests.
  - `tests/rls/booking-changes.test.ts`: +1 test with 6 more cases for `booking_all_picked_up` vs `completesOnPickup` (13 cases with the builder's 7).
  - `e2e-mock/t081-tester-mock.spec.ts`: 2 tests (375 px light and dark).

## Findings (ranked)
- HIGH: none. MED: none.
- LOW-1 `pickedUpSeeded` hook (`src/lib/mocks/mock-booking-changes.ts:389-399`) seeds A05 (one cooked chef's-home day, `accepted`) with every day picked up. The real server can no longer produce that state: the confirm completes it. This is the lessons section 3 "tests fed data the API never sends" class. Affected: `e2e-mock/t071-pickup-confirm-mock.spec.ts:117` (chef sees "Picked up (confirmed by the customer) on", no missed button, on an accepted booking), `e2e-mock/t071-tester-mock.spec.ts:50` (chef 375 px confirmed line), `e2e-mock/t080-reload-after-409-mock.spec.ts` (stale chef "missed" then page shows picked-up). Severity LOW: the assertions are about a UI branch (the confirmed line, hidden missed button) that is still reachable for a MULTI-day booking (day 1 confirmed, day 2 open), and the 409 `pickup_confirmed` in t080 is still reachable the same way. Nothing asserts "accepted + all picked up" as a product behaviour. They only fixture-misrepresent the state, and a future UI change that keys on status could hide a real bug. Recommend (Planner decision): re-seed A05 with a second open day, or keep and comment the hook as a stale-page fixture. The builder left it alone and said so.
- LOW-2 `PLAN.md` A-29 still says auto-completion is unchanged (builder noted; Planner's file).
- INFO-1 `change_booking` answers with the booking loaded AFTER its own change. Two parallel confirms of different days can both reply `completed` (the first one's reply is loaded after the second commits). Correct, but a client must not read the reply of a confirm as "this click completed it".
- INFO-2 Lock order: the new SQL takes no new lock. Confirm: bookings row `for update`, then the day row (as before). Sweep: bookings rows in id order, one at a time. Neither locks chef rows (unchanged from before, so the chef-first rule is not broken). `booking_all_picked_up` is `stable`, reads under the statement snapshot taken after the day update, so it sees the confirm that just ran. The sweep's due test runs before the row lock and does not re-check `booking_all_picked_up` after locking, which is safe because `picked_up_at` and `cooked_at` are never cleared (only not-due to due moves are possible). Frozen, report and cooked checks are re-done under the lock.
- INFO-3 Repeat-confirm shortcut (`change_booking`) sits after the frozen check, so a repeat on a completed booking that is later frozen answers 409 `frozen`. Harmless.
- INFO-4 The mock has no problem-report concept, so the open-report guard is not mirrored there (builder noted).

## Check against the brief
1. API (CI only), all green in CI:
   - parallel confirms of two different last days: both 200, booking completed, 1 `booking_completed` notice each, 2 `pickup_confirmed`, trial `consumed`, exactly one consumed claim; later reads add nothing (new test).
   - same day confirmed twice at once: both 200 `completed`, one notice (new).
   - report open between cooked and confirm: stays accepted, claim `held`; also stays accepted while `reviewing`; after resolve, the next route read completes it, the trial is consumed once, one notice each, repeated reads change nothing (new; the builder's test used the raw RPC which does not apply the claim).
   - repeat confirm after completion: 200, no duplicate notice (builder + new, on both the confirm and sweep paths).
   - missed after completion, deadline long past: 409 `wrong_status` (new). Confirm of an unconfirmed day on a chef-completed booking: 409 `wrong_status` (new).
   - trial consumed exactly once via confirm path, via sweep path (days forced picked up, one read) and via the report-closed path, each counted on `free_trial_claims` (new).
   - `no_day_cooked` flagged booking, chef marks a late day cooked, customer confirms: completes, flag resolved, trial consumed (new).
   - customer's home with `picked_up_at` forced: sweep does not complete it (builder test, passes in CI).
2. TS mirror vs SQL: the builder's 7 cases were good; gaps were cooked-only, picked-without-cooked, a done cancelled day beside an open active day, and 3 days. Added as 6 cases; all agree.
3. Mock e2e: the customer confirms the last day, the page shows Completed, "Picked up on" line stays, the line takes focus, the confirm button and panel are gone, no sideways scroll, axe clean at 375 px light and dark. Passing. `pickedUpSeeded`: see LOW-1.
4. Lint clean, typecheck clean.

## How to verify (results)
- `npm run lint`: clean. `npx tsc --noEmit` and `npm run typecheck`: clean.
- `npx vitest run`: 92 files, 2126 passed, 3 expected fail.
- `npm run test:e2e:mock` (FULL suite, run locally): 270 passed (builder's 267 + t081 spec + my 2).
- CI run 39072974838 on my head (after two test fixes): success. Unit 2126 passed; RLS 20 files, 228 passed; API 35 files, 695 passed; Playwright real routes 43 passed; mock mode 270 passed. (Run 39071931999 on 75b60aa was cancelled by my push. My first push, run 39072190298, failed on two of MY new tests: a wrong assumption that the first parallel reply says `accepted`, and a flag test that needed past eat-by dates. Both were test bugs, not product bugs; fixed.)

## Known gaps or risks
- Race coverage is two parallel requests through the shared harness; true interleavings with the sweep were not forced.
- Hosted migration `20261020100000_auto_complete_on_pickup.sql` is not pushed (Planner asks Jimmy after merge).

## What the next agent needs
- Review focus: LOW-1 decision (mock hook), contract wording for the idempotent repeat 200, PLAN.md A-29 text.
