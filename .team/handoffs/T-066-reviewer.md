# Handoff: T-066 Booking change fixes (reviewer)

From: reviewer  To: planner
Verdict: **APPROVE** on head 4ac7b5d. PR comment: https://github.com/Jimmyvo23/cookneighbour/pull/116#issuecomment-6182277516

## Checked
- CI green; locally lint, typecheck, prettier, `npm test` (71 files, 1852 passed, 3 expected fails).
- Migration `20261014150000_booking_change_fixes.sql`: function bodies diffed against `20261011200000_booking_changes.sql`. `change_booking`: only `complete` voids `('proposed','accepted')` (L2, line 159). `admin_reject_chef`: only the L1 guard (378-379), exact complement of `expire_stale_bookings`. `sweep_booking_changes`: cooked-day guard (290), pickup void on auto-completion (293-298), D-36 flag block (308-329), `flagged` in result.
- Security: SECURITY INVOKER, `search_path = ''`, qualified names; EXECUTE service_role only (411-416). Locking unchanged. Sweep idempotent (status guard; flag PK + `on conflict do nothing`; notices only from inserted rows).
- RLS on booking_flags unchanged (reason check widened only). Flag notice neutral (no names, phone, address).
- TS: `cancellation.ts` `no_show_chef` follows D-26 branch (D-37, single source A-16); `free-trial.ts` reads cooked marker when not passed. Contract v1.7, domain-rules, data-model match. Scope matches T-066.

## Findings (none blocking)
- **LOW-1** (sweep 308-329): chef who first opens the app after completion time gets `no_day_cooked` flag from the lazy sweep before their "cooked" call; marking cooked later completes the booking but the flag and notices stay. Acceptable under D-36 as written. Needs a decision before T-064/T-048 (D-53 freezes flagged bookings). Add to Q-36: "Does completing a `no_day_cooked`-flagged booking clear or resolve the flag?"
- **LOW-2** (sweep 309-319 vs admin_reject_chef 391-396): unordered `booking_flags` inserts can deadlock (40P01 -> 500) in a very unlikely race. Optional `order by b.id`; T-064 or WO-7.
- **NIT-1** `src/lib/server/bookings.ts:108-109`: `sweepExpired` comment lacks the D-36 rule.
- **NIT-2** `src/lib/server/free-trial.ts:345-356`: cooked-marker read now runs for every event without a passed value; cheap, correct.

MOCK honesty: unchanged, free-trial comments still say MOCK / Q-1.

## After merge
Ask Jimmy before `supabase db push --linked` (migration not on hosted). LOW-1 wording into Q-36; LOW-2 and NIT-1 into T-064 or WO-7.
