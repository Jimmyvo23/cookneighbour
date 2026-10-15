# Handoff: T-065 Contact privacy (reviewer)

From: reviewer  To: planner
Verdict: **APPROVE** on head 13282a9. PR comment: https://github.com/Jimmyvo23/cookneighbour/pull/124#issuecomment-6184246256

## Verified
- `answer_booking` = 20261011200000 body + only the snapshot block (one `declare` line, lines 172-185); grants kept.
- `get_booking_contact` = core_rls body with `booking_contact_open` and kitchen address from `booking_kitchen_addresses`; adds `visible_until`; SECURITY DEFINER, `search_path = ''`; revoked from public/anon (cc07696), granted to authenticated.
- New helpers and `set_chef_kitchen_address`: `search_path = ''`, SECURITY INVOKER, service_role only. `booking_kitchen_addresses` RLS on, no policy. RPC is the only kitchen-address write path.
- Lock order chef -> chef_private -> booking, same as admin functions; no cycle with `answer_booking` (chef FOR SHARE, booking FOR UPDATE).
- Cut-off `(max(visit_date) + 8)::timestamp at time zone 'America/Toronto'` (migration:60): local midnight, DST-safe; Tester's 4 DST cases cover it. D-56: cancelled/declined/expired/requested never show contact. Backfill (migration:40) documented limit.
- Local lint, typecheck, prettier, `npm test` (1931 passed, 3 expected fail); CI green.

## LOW
- L1 `src/lib/server/chef-application.ts:279-310`: kitchen RPC commits before the `chefs` column update (two transactions). Safe state on failure, retry idempotent. Optional fix: pass the `chefs` columns into the function.
- L2 `contactVisibleUntil` (`src/lib/api/types.ts:733`, `booking-views.ts:226`): beyond the WO, small and documented (v1.9). Acceptable subject to Jimmy.
- L3 UI: after the cut-off the pages say "... is not shown for this booking" (`BookingDetailView.tsx:291,306`, `ChefBookingView.tsx:492,506`); no D-52 explanation, no "Visible until". Frontend task needed.
- L4 `20261007221002_core_rls.sql:124-135` `can_view_kitchen_photos` is status-only (no time limit). Not in D-52's wording. Jimmy question.

## NIT
- N1 migration:225 `for update` on chefs; admin functions use `for no key update`.
- N2 migration:36 add explicit `revoke all on public.booking_kitchen_addresses from anon, authenticated;`; comment at migration:252 contradicts migration:124.
- N3 `chef-application.ts:278,311`: `!kitchen` skips the generic `chef_private` write; assert `privColumns` keys are a subset of the RPC's six.
- N4 migration:181 indentation.
- N5 snapshot rows kept after the window or a cancel (no client access); consider retention later.

## After merge
Migration `20261015100000_contact_privacy.sql` not on hosted; ask Jimmy before `supabase db push --linked`.
