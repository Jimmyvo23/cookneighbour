# Handoff: T-063 Booking changes API

From: tester  To: reviewer

## Verdict
PASS (no blocking bugs). CI `ci` green on head 2d08d47 (run 38154138151): unit 56 files, RLS 12 files, API 21 files (incl. new booking-changes and booking-changes-extra), lint, typecheck, prettier, build. Locally: lint, typecheck, prettier --check, unit tests (1550 passed, 3 expected fail), build all pass.

## Checked
- Cancel timing (on_time, late at under 48 h), D-26 (cooked then cancel consumes, second trial blocked; before cooking releases, trial reusable), chef and customer no-show (consume vs release), missed pickup (propose, decline, re-propose, deadline, 0-day shelf life, missed), parallel cancels, cancel vs accept race, reject cascade (requested cancelled by system and claim released, accepted flagged, finished untouched), N3 kitchen_in_use, accept re-check of chef's home, unauthorized access (stranger 404, admin 403, anonymous 401, wrong content type 400), contact details in cancel reason.
- SQL review of `supabase/migrations/20261011200000_booking_changes.sql`: lock order is chef then booking (answer_booking, admin_reject_chef); change_booking and sweep lock bookings only, so no cycle. All new functions SECURITY INVOKER, search_path empty, execute revoked from public/anon/authenticated and granted to service_role; new tables have RLS on, select-only policies. Unique partial index backstops parallel proposals. No defects found.

## Bugs
None blocking. Observations (design, not defects; decision for Jimmy/Planner):
1. Medium: D-33 auto-completion (`sweep_booking_changes`, migration lines 392-399) does not require any day to be cooked. If a chef never shows and nobody reports within a day after the last visit, the booking becomes `completed`, which consumes the customer's free trial (A-16) and opens reviews, although nothing was cooked. Manual completion does require all days cooked (line 260), so the two paths differ. Option: auto-complete only when every active day is cooked, otherwise leave `accepted`/flag for admin. Not covered by a test on purpose (would lock in the behaviour).
2. Low: chef can mark `complete` while a chef's-home pickup window is still open (migration line 259-273), which removes "pickup missed" (needs `accepted`). Only voids `proposed` proposals, leaves `accepted` ones. Chef-only trust, same as Q-C.
3. Low: `pickup_missed` and no-show are chef's word alone (builder Q-B, Q-C already open).

## Tests added
- `tests/api/booking-changes-extra.test.ts` (6 tests, passed in CI): customer no-show consumes trial and a second free booking is 409 FREE_TRIAL_USED; chef no-show releases trial and it can be used again; chef cancel after a cooked day consumes (builder assumption 7 / Q-A); cooked before the visit date is 409 too_early and a cancel then releases; email and phone in a chef's cancel reason are 422 CONTACT_DETAILS_NOT_ALLOWED and nothing saved; reject cascade leaves a flagged booking's claim held and releases a cancelled request's claim.
- Existing builder tests (unit, API, RLS) reviewed and judged adequate for the suggested focus.

## Open notes
- Local API/RLS runs were not possible (no Docker); CI results above are the evidence.
- Observation 1 should be decided before WO-5 (reviews rely on `completed`).
