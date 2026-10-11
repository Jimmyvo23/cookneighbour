# Handoff: T-042 Reviewer (written by the Planner from the Reviewer's report; the Reviewer is read-only)

**Verdict:** APPROVE (PR #95, head 4c8010e; CI run 38102274738 green; local lint/typecheck/prettier and 1513 unit tests pass). No HIGH or MEDIUM findings.

## Sound
Grants (writers service-role only, SECURITY INVOKER, `search_path = ''`); service-role reads only after role checks; races (one transaction, unique index, per-customer advisory lock, FOR SHARE/FOR UPDATE, conditional expiry); privacy (`get_booking_contact`, notifications carry dates only, best-effort contact guard documented); lazy expiry (D-19); contract v1.4 §7A matches code, T-063 shapes marked PROPOSED; MOCK honesty; scope within WO-4b.

## Findings (all LOW)
1. **Public date helpers too open** — `20261011100100_booking_api.sql:354-380`, grants `:423-426`. `chef_booked_dates` accepts any range (whole booking history to anon); `chefs_booked_on` returns pending/rejected chef ids. Fix: join `chefs` with `status = 'approved'`, clamp to tomorrow (Toronto) .. today + 180; RLS tests for past date and rejected chef. **Planner: fix before merge (migration not yet on hosted).**
2. **Accept does not lock or fully re-check the chef** — `answer_booking :249-253`: no `FOR SHARE`; `chef_home` accept does not re-check `chef_home_enabled`. Carry-in to T-063.
3. **Stale request can still raise DOUBLE_BOOKED** in a millisecond window — `bookings.ts:500-501`. Optional; covered by the WO-7 cron.
4. **Lazy-expiry gaps** — (a) `messages_insert_party` allows messages on a stale request (WO-5: check `expires_at`); (b) a stale free-trial request from account A blocks B at the same address until swept (WO-7 cron).
5. **Stale comment** — `src/app/api/bookings/[id]/decline/route.ts:6` says "optional reason" (contradicts D-34). **Planner: fix before merge.**

## Notes
- `findContactDetails` false positive on dotted dates and 7+ digit runs is accepted and pinned. Street addresses: open question for Jimmy; README known limit.

## Later tasks
- T-063: finding 2; D-33 completion + 24 h auto-complete; D-22 reject cascade; D-26 cooked marker; `findContactDetails` on cancel reasons.
- WO-5: finding 4a; `findContactDetails` on chat before acceptance; notifications read route.
- WO-7: scheduled `expire_stale_bookings(null)` (findings 3, 4b).
- T-062: mock adapter still lists today, no `firstBookableDay`; stale e2e-mock wording "booked days are not removed".
- T-043: `wouldExpireAt`, under-48 h late-cancel warning, "addresses after acceptance".
- README: contact-details filter is best effort; D-35 no extra rate limit.
