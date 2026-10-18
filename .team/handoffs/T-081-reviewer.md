APPROVE

Reviewer verdict for T-081 (#159), PR #160, head 69aa4b4. No HIGH or MED findings. Read with `.team/handoffs/T-081-backend.md` and `.team/handoffs/T-081-tester.md`.

Checks run by the Reviewer on 69aa4b4: `npm run lint` clean; `npm run typecheck` clean; `npx prettier --check src docs tests e2e-mock` clean; `npx vitest run` 92 files, 2126 passed, 3 expected fail. CI run 39074733075 on 69aa4b4: success (earlier run 39072974838 on 82203a6 also success).

Scope: matches the Work Order (one migration, the mirror, the mock, the route's free-trial follow, the contract, tests). No growth beyond it.

## Findings

LOW-1 `src/lib/mocks/mock-booking-changes.ts:389-399` (hook docs `src/lib/mocks/mock-bookings.ts:19-20`). Agree with Tester LOW-1. `pickedUpSeeded` seeds A05 (one cooked chef's-home day) as `accepted` with every day picked up. The real server can no longer produce that state: the confirm completes the booking, and the sweep completes it on the next read. `e2e-mock/t080-reload-after-409-mock.spec.ts` now asserts a 409 `pickup_confirmed` that the server can only give for a booking with another day still open, and `t071-pickup-confirm-mock.spec.ts:117` / `t071-tester-mock.spec.ts:50` show the chef an accepted, fully picked-up booking. This is the lessons §3 class "Tests fed data the API never sends" and "A rule change reaching old tests" (update in the same PR). It is not blocking because the UI branches are still reachable on a multi-day booking. Recommendation, in order of preference: (a) re-seed: the hook marks only the FIRST cooked day picked up and A05 (or a new row) gets a second open day, so the state is real; or (b) at least label the hook in both places as "stale-page fixture: the server cannot reach this for a one-day booking since T-081 (D-81)". Planner to choose: a one-commit fix on this branch or a tracked follow-up task.

LOW-2 `docs/api-contract.md:460`. The contract says a repeat confirm answers 200 on "the booking that this confirm completed". The SQL (`20261020100000_auto_complete_on_pickup.sql:131-136`) and the mock (`mock-booking-changes.ts:803-805`) answer 200 `completed` for ANY completed booking where that day is already confirmed, including one the chef completed with "visit done" or the deadline sweep completed. That is harmless (nothing changes, no notice), but the contract should say what the code does: "Repeating a confirm of a day that is already confirmed on a `completed` booking is 200 with `status: "completed"`, no notification." A confirm of an unconfirmed day on a completed booking stays 409 `wrong_status` (tested).

LOW-3 `PLAN.md:73` A-29 still says "Auto-completion is unchanged". Also I could not find D-83 written anywhere in PLAN.md (only D-81 at `PLAN.md:294`, which says "every cooked day", while the built rule is "every active day cooked AND confirmed"). I reviewed against the D-83 wording in the Planner's brief. Planner: record D-83 and update A-29 in the planner-notes PR (Planner's file, not the builder's).

NIT-1 `20261020100000_auto_complete_on_pickup.sql:392-396`. The sweep picks the notice text by re-calling `booking_all_picked_up` and `booking_auto_complete_at` after the update. Correct (the status change does not affect either function), just two extra calls; fine for a prototype.

NIT-2 (existing, not from this PR) the mock `pickup-missed` checks `not_chef_home` before `wrong_status` (`mock-booking-changes.ts:857-858`); the SQL checks status first. Same answer for every reachable state, so only noting it.

INFO-1 SQL. Diffed the new `change_booking` against `20261018100000` and `sweep_booking_changes` against `20261017100000`: only the T-081 lines change. Both stay invoker functions with `set search_path = ''`, fully qualified names, revoked from public/anon/authenticated and granted to service_role only, the same pattern as `booking_is_frozen` and `booking_auto_complete_at` (no `security definer` needed: only the service role calls them). The new `booking_all_picked_up` is `stable`, `search_path = ''`, service role only. No new lock: confirm keeps booking row `for update` then the day row; the sweep locks bookings one at a time in id order; no chef row is locked by either, so the chef-first rule is untouched. In READ COMMITTED each plpgsql statement takes a new snapshot, so a second parallel confirm sees the first one's day after waiting on the booking lock (the Tester's parallel test confirms exactly one completion and one notice each). Completion in the confirm path happens in the same function call (one transaction). Idempotent: the `picked_up_at is null` guard, the `status <> 'accepted'` re-check under the sweep's lock, and the early repeat shortcut.

INFO-2 Free trial consumed once on both paths. Confirm path: the route calls `followClaim` for `pickup_confirm` with `status === "completed"` (`src/lib/server/booking-changes.ts:114-123`); a repeat confirm calls it again but `applyFreeTrialEvent` is a no-op from `consumed` and errors are caught. Sweep path: the sweep's `release` list feeds the existing claim repair. Tester counts exactly one consumed claim on the confirm, sweep and report-closed paths.

INFO-3 The rule. Customer's home: `booking_all_picked_up` is false (location check) and confirm is still 409 `not_chef_home`; a forced `picked_up_at` does not make it due (tested). Frozen: confirm refused 409 `frozen` before the repeat shortcut and the completion; the sweep skips frozen. Side effects equal the existing auto-completion (status, `completed_at`, proposals voided, D-57 flag resolved, `booking_completed` to both parties) plus the confirm's own `pickup_confirmed` to the chef.

INFO-4 TS mirror and mock. `completesOnPickup` (`src/lib/domain/bookingChanges.ts:107-123`) matches the SQL; the RLS suite compares the two on 13 cases. It is used only by the mock (the server trusts the SQL), and the doc comment says so. The mock completes on the last confirm with the same side effects except notices (the mock has none) and the report guard (the mock has no reports; labelled MOCK in the code).

INFO-5 Privacy. Notices go only to the booking's two parties, with no address, phone or other personal data. No new browser-callable function, no RLS change; the privileges snapshot is unchanged and `booking_all_picked_up` is in the server-only list.

INFO-6 Code style matches the surrounding migration and mock (comment headers with T-/D- refs, same jsonb result shapes, same void/flag/notify statements as `complete` and the sweep).

## The builder's three choices (A-30 to A-32)

- A-30 (open or reviewing report blocks completion until closed): sound and NOT really new. D-33 already says auto-completion happens "unless a no-show or problem was reported", and `complete` and the sweep both use this guard. The sweep finishes the booking once the admin closes the report. Send to Jimmy as an FYI to confirm, since D-83 says "right away".
- A-31 (repeat confirm on a completed booking is 200, no second notice): sound. It follows A-27 ("repeating returns the first time") and avoids a confusing error after a double click. No product risk. Contract wording: see LOW-2. Planner default; no need to ask Jimmy beyond the usual confirmation.
- A-32 ("missed" after completion is 409 `wrong_status`): this follows directly from D-81/D-83 (a completed booking cannot become a no-show) and is the same answer every other action gives on a completed booking. No question for Jimmy beyond recording it.

Recommended for Jimmy: A-30 only (FYI/confirm). A-31 and A-32 are consequences of decisions he already made.

Not checked: the hosted database (migration not pushed; needs Jimmy's go after merge, as the handoff says). I did not run Playwright locally; CI ran the real-route and mock suites green.


## Round 2

APPROVE (round 2)

Reviewer re-check of PR #160 at head 64e3120 (`git diff 69aa4b4..64e3120`, "Round 2" section of `.team/handoffs/T-081-backend.md`). No HIGH or MED findings. The commit changes only the mock, one mock spec, one unit test, the contract and the handoff. No migration or server behaviour changed.

Checks run by the Reviewer on 64e3120: lint clean; typecheck clean; `npx vitest run` 92 files, 2127 passed, 3 expected fail; full mock e2e `npm run test:e2e:mock` 270 passed. CI run 39076546694 on 64e3120: completed, success.

## Round 1 findings
- LOW-1 (pickedUpSeeded): FIXED. The status and pickup state is now one the server can produce: `accepted` with day 1 cooked and confirmed, plus an open day (`src/lib/mocks/mock-booking-changes.ts:389-422`). The new unit test (`mock-pickup-confirm.test.ts:277-286`) pins it. The specs still prove what they proved before:
  - `t071-pickup-confirm-mock.spec.ts:117` / `t071-tester-mock.spec.ts:50`: the chef sees the confirmed line, and "Mark pickup missed" stays hidden for the right reason (the only cooked day is confirmed; day 2 is not cooked).
  - `t080-reload-after-409-mock.spec.ts:56-62`: a stale "missed" still gets 409 `pickup_confirmed`. The server gives that answer for this state too, because the open day 2 keeps the booking `accepted`. The page reloads and focus stays on the alert, as before.
- LOW-2 (contract): FIXED. `docs/api-contract.md:460` now says a repeat confirm of an already confirmed day returns 200 `completed` on ANY `completed` booking, and an unconfirmed day on a completed booking stays 409 `wrong_status`. This matches the SQL (`20261020100000_auto_complete_on_pickup.sql:131-141`) and the mock (`mock-booking-changes.ts:805-806`).
- LOW-3 (PLAN.md A-29, record D-83): still open. It is the Planner's file, for the planner-notes PR.
- NIT-1: left alone. Acceptable.

## New findings (non-blocking)
- LOW-4 `e2e-mock/t080-reload-after-409-mock.spec.ts:61`. The edit builds day 2 as `{ ...f, dayNumber: 2, ... }`, so day 2 has the SAME `date`, `pickupDeadlineDate` and dish `eatByDate` as day 1. The server cannot produce that: `booking_days` has `unique (booking_id, visit_date)` (`20261007221001_core_schema.sql:387`), and a day's deadline is its earliest dish eat-by date (`src/lib/server/booking-views.ts:167-168`). The assertions do not depend on the date, so the spec still proves the 409, the reload and the focus. But the fixture still breaks lessons §3. Fix: give day 2 a future date (for example `dayPlus(1)`), with `pickupDeadlineDate` and the dish `eatByDate` values moved to match.
- LOW-5 `src/lib/mocks/mock-booking-changes.ts:408-418`. The hook's added day 2 gets its own date (tomorrow) and `pickupDeadlineDate = date + 2` (this matches pho's 2-day shelf life). But it copies day 1's `dishes`, whose `eatByDate` is day 1's date + 2, which is already in the past. On the real server a day's dish eat-by dates come from that day's own date. The `estimate` also still covers one day. Fix: rebuild the dishes' `eatByDate` from `date2` (`addDays(date2, shelfLifeDays)`) and take the deadline from them, the same way `seedRow` does (`:205-228`). Leaving the estimate alone is acceptable if a comment says so.

Neither changes what any spec proves, so I am not blocking the merge. Both are the realistic-dates part of the original LOW-1, and the fix is a few lines in two places. The Planner decides: one small commit on this branch before merge (my preference, since this is the class lessons §3 tells us to fix in the same PR), or a tracked follow-up.


## Round 3

APPROVE (round 3)

Reviewer re-check of PR #160 at head 48909c8 (`git diff 64e3120..48909c8`, "Round 3" section of `.team/handoffs/T-081-backend.md`). No HIGH, MED or LOW findings left from my side. The commit changes only the mock hook, one mock spec, one unit test and the handoff. No migration, server or contract change.

Checks run by the Reviewer on 48909c8: lint clean; typecheck clean; prettier clean (src, e2e-mock); `npx vitest run` 92 files, 2127 passed, 3 expected fail; mock e2e for the affected specs (t080, both t071 specs, both t081 specs) 17 passed. CI run 39081531834 on 48909c8: success on attempt 2.

## Round 2 findings
- LOW-5 (hook day 2 dates): FIXED. `src/lib/mocks/mock-booking-changes.ts:412-438`.
  - Day 2 is Toronto today + 1 (`today` is `torontoToday(now)`, `:303`).
  - Each dish's `eatByDate` is day 2's date plus that dish's shelf life (`shelfGap`, `:288-294`). `pickupDeadlineDate` is the earliest eat-by date. This is how `seedRow` and the server build them (`booking-views.ts:167-168`).
  - A comment says the estimate still covers the original single day.
  - The unit test (`mock-pickup-confirm.test.ts:286-307`) pins day 2's date, its difference from day 1, every dish eat-by date and the deadline.
- LOW-4 (t080 spec): FIXED. `e2e-mock/t080-reload-after-409-mock.spec.ts:62`. Day 2 now uses `dayPlus(1)` (Toronto), with the deadline and dish eat-by dates moved by the same shelf-life gaps. The two days no longer share a date, so `unique (booking_id, visit_date)` holds. The spec still proves the stale "missed" 409 `pickup_confirmed`, the reload and alert focus.
- LOW-3 (PLAN.md A-29, record D-83): still the Planner's, for the planner-notes PR.

## Notes
- NIT-3 (existing pattern, no action needed for T-081). The hook's day 2 (tomorrow) lands on the same date as A04's accepted day 2 for the same mock chef. The real server forbids that through `booking_days_one_per_chef_date` (`20261007221001_core_schema.sql:390`). The seed already has this pattern: A03 and A06 are both accepted on today - 1 for the same chef. No spec depends on it. If the Planner wants the mock seed to respect per-chef date uniqueness, that is a separate small task.
- INFO-7 CI duration. Run 39081531834 attempt 1 was cancelled at the 25-minute job timeout. Attempt 2 passed in 24m40s, and the earlier runs took 21-24 minutes. The suite is close to the limit, so a slow runner can cancel a good run. The Planner is tracking this; it is not caused by T-081 code.

Final: APPROVE. LOW-1, LOW-2, LOW-4 and LOW-5 are fixed. Only LOW-3 (the Planner's PLAN.md notes) is open. CI is green on 48909c8. The hosted migration push still needs Jimmy's go after merge.
