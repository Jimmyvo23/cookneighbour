# Handoff: T-065 Contact privacy (kitchen snapshot, D-52, D-56)

From: backend  To: tester

## What changed
- Branch: `feature/T-065-contact-privacy`
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/124 (Closes #122)
- Migration (NOT pushed to hosted; Planner asks Jimmy): `supabase/migrations/20261015100000_contact_privacy.sql`
  - Table `booking_kitchen_addresses` (RLS on, no grant, no policy). Backfilled for already accepted/completed/no-show chef's-home bookings with the chef's current address (earlier addresses cannot be recovered).
  - `answer_booking`: the 20261011200000 body (newest) plus the snapshot insert, under the chef share lock.
  - `set_chef_kitchen_address(...)`: locks chef, then chef_private; checks `updated_at` (conflict), checks an accepted chef's-home booking (kitchen_in_use), writes the address, resets the MOCK kitchen check, switches chef's home off. service_role only.
  - `booking_contact_ends_at(booking)` = 00:00 Toronto on (last visit day + 8). `booking_contact_open(booking, status, at)`.
  - `get_booking_contact` dropped and recreated: new column `visible_until`; chef_home address comes from the snapshot; returns no rows once the window ends. `booking_contact_unlocked(status)` is unchanged (still used by kitchen-photo access).
- Code: `src/lib/server/chef-application.ts` (`mutate` calls the RPC for a kitchen-address change; the old count pre-check is gone, the lazy sweep stays), `src/lib/server/booking-views.ts` and `src/lib/api/types.ts` (new optional `contactVisibleUntil`).
- Tests: `tests/rls/contact-privacy.test.ts`, `tests/api/contact-privacy.test.ts`.
- Docs: `docs/api-contract.md` v1.9, `docs/data-model.md`, `docs/domain-rules.md`.

## How to verify
- Local: `npm run lint && npm run typecheck && npx prettier --check . && npm test` (all pass; DB tests do not run locally, no Docker).
- CI runs the RLS and API suites against local Supabase. New cases: snapshot survives a kitchen move; window to the second (DST-safe); each of the four statuses and both parties at last day +7 / +8; requested/declined/expired/cancelled never show contact; set_chef_kitchen_address server-only, conflict, kitchen_in_use, and a 4-round concurrent accept-vs-change race.

## Known gaps or risks
- Backfilled snapshots use the chef's address as of the migration.
- `can_view_kitchen_photos` still uses status only (no 7-day cut-off): see open question 1.
- The race test cannot force the interleaving; it checks the invariant over 4 rounds.
- Local DB tests were not run (CI only).

## What the next agent needs
- Frontend: after the cut-off the API returns `contact: null`, `cookingPlace: null` (chef view always; customer view for chef_home) and `contactVisibleUntil: null` while status is still accepted/completed/no_show. Copy must change: the pre-existing "contact details stay visible after the visit" wording should say "Phone numbers and addresses are hidden 7 days after the last visit day; chat stays open", and a booking with status accepted/completed/no-show and `contact: null` must show "Contact details are hidden now" instead of "not shared yet". Use `contactVisibleUntil` (ISO, show in Toronto time) for "Visible until ...". Cancelled bookings: contact hides at once (as before). The customer still sees their own cooking address.
- Tester: boundary is 00:00 Toronto on last day + 8; API tests move dates with `shiftDays`.

## Assumptions
1. "Last visit day" = max `booking_days.visit_date` (cancelled bookings are excluded anyway).
2. Added `contactVisibleUntil` to BookingDetail (not in the Work Order) so the UI can say when contact hides; optional in the type.
3. `declined` and `expired` are treated like `cancelled` (never shown), as today.

## Open questions
1. Kitchen photos (`can_view_kitchen_photos`) are not contact details in D-52; should they also stop after 7 days?
2. Snapshot is the chef's address at accept time; if a chef's-home booking is accepted with chef_private address missing, accept answers `chef_home_not_enabled`. Fine?
3. Does the 7-day window need a notification when contact hides? Not built.
