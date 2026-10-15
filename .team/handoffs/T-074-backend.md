# Handoff: T-074 Backend follow-ups from T-065

From: backend  To: tester

## What changed
- Branch: `feature/T-074-kitchen-followups`
- Pull request: see PR "T-074" (Closes #128)
- Migration (NOT pushed to hosted; Planner asks Jimmy): `supabase/migrations/20261016100000_kitchen_followups.sql`
  - D-58: `can_view_kitchen_photos` now calls `booking_contact_open`, so the storage policy `kitchen_photos_select_customer` hides kitchen photos from 00:00 Toronto on last visit day + 8 (and at once for cancelled, per D-56). Server-side enforcement, no UI involved.
  - D-59: `answer_booking` returns `kitchen_address_missing` when a chef's-home accept finds no complete kitchen address (line, city, postal). Nothing changes; decline still works. Checked after `chef_home_not_enabled`.
  - L1: `set_chef_kitchen_address` gets `p_chef_columns jsonb` (whitelisted chefs columns, unknown key raises) and writes the chefs row in the same transaction as chef_private and the chef's-home switch-off. The route no longer does a second write for a kitchen change.
  - N1 chef lock is now `for no key update` (still conflicts with `answer_booking`'s `for share`). N2 explicit `revoke all` on `booking_kitchen_addresses`. N4 indentation fixed in `answer_booking`. N5 retention note as a table comment and in `docs/data-model.md`. Lock order is in the migration header (chefs, chef_private, bookings).
  - The wrong comment in 20261015100000 ("default privileges already strip new functions") is corrected in the new header; the old file is not edited.
- Code: `src/lib/server/chef-application.ts` (passes chefs columns into the RPC; N3 assert: throws if the plan holds a chef_private column the RPC does not write), `src/lib/server/bookings.ts` (409 `INVALID_STATE`, `reason: kitchen_address_missing`).
- Tests: `tests/rls/kitchen-followups.test.ts`, `tests/api/kitchen-followups.test.ts`; `tests/api/booking-helpers.ts` `bookableChef` now saves a kitchen address when `homeEnabled` (option `noKitchenAddress` to skip), otherwise every chef's-home fixture would hit D-59.
- Docs: `docs/api-contract.md` v1.10, `docs/data-model.md`, `docs/domain-rules.md`.

## How to verify
- Local: `npm run lint && npm run typecheck && npx prettier --check . && npm test` (pass; 1949 + 3 expected fail). The migration was also loaded in PGlite and `answer_booking` and `set_chef_kitchen_address` were called with plain SQL.
- DB tests run only in CI (no Docker). New cases: kitchen photo download as the customer inside and past the window, completed, cancelled, requested, customer-home, other customer; accept refused with each of line/city/postal missing, decline still works; L1 atomic rollback (invalid rate rolls back the address), refused change leaves chefs columns, whitelist; API accept 409 with reason, PATCH saves everything together, kitchen_in_use PATCH saves nothing.

## Known gaps or risks
- `kitchen_address_missing` cannot occur in the real app today (an admin approves a kitchen only with an address, and the address cannot be cleared). It is a safety net, so only fixtures hit it.
- Window test for photos uses dates around today; it moves visit dates after insert (insert refuses past dates).
- Hosted DB does not have either T-065 or T-074 migration yet.

## What the next agent needs
- Frontend (D-59 refusal): the accept call returns 409 `INVALID_STATE` with `error.reason = "kitchen_address_missing"` and a ready human `error.message`. Show that message on the chef's booking view next to the Decline button (like `chef_home_not_enabled`). Add the reason to `src/lib/booking/changes.ts` (`changeErrorText`) and to the mock adapter (`mock-booking-changes.ts`) as needed. Tell the chef that adding an address switches chef's home off until an admin checks it again (D-21), so declining is the practical option.
- Frontend (D-58): after the cut-off the customer's kitchen photo requests fail (storage returns not found). Hide the kitchen photos block when `contact` is null for an accepted, completed or no-show chef's-home booking; no new API field.
- Tester: boundary equals the contact boundary (00:00 Toronto, last day + 8); the same DST tests in `contact-privacy-tester.test.ts` cover `booking_contact_ends_at`.

## Questions for Jimmy
None blocking. For information: snapshot rows are never deleted after the window (N5); a retention job would be a later decision.
