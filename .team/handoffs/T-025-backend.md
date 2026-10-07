# Handoff: T-025 Core schema migrations + RLS

From: backend  To: tester

## What changed
- Branch: `feature/T-025-schema-rls`
- Pull request: see the PR for Issue #13
- Files: `supabase/migrations/20261007221001_core_schema.sql`, `..221002_core_rls.sql`, `..221003_storage_buckets.sql`, `docs/data-model.md`, this handoff.

## How to verify
- CI `supabase start` applies the migrations; green CI means they apply cleanly.
- Read `docs/data-model.md` (every policy in plain English) and write T-027 tests against it.
- I smoke-tested the migrations on PGlite (Postgres in WASM) with stubbed `auth`/`storage` schemas: they apply, and role-promotion, chef self-approval, double-booking, cancel-releases-date, past date, 4th day, contact reveal before/after accept, stranger access, message/review insert rules and free-trial uniqueness all behaved as documented. That is not the real Supabase stack; the T-027 suite must be the real proof.

## Known gaps or risks
- Not applied to the hosted project (Planner step after review).
- Client writes are deliberately absent for bookings, days, dishes-in-booking, intake, receipts, claims, notifications (insert), profile_private. The server (service role) writes them; API routes must authorize in code.
- `requested` bookings hold the chef's date; there is no expiry rule yet.
- Kitchen photos bucket is public-read as the plan says.
- Extras beyond the table list: `chef_private`, `booking_addresses`, `free_trial_blocks`, buckets `profile-photos`. Reason: keep private data off public rows, admin free-trial block list.

## What the next agent needs
- Contact reveal: `rpc('get_booking_contact', { p_booking })`; no rows before accept or for non-parties.
- Test the guard triggers: client cannot change `profiles.role`, `chefs.status`, `chefs.chef_home_enabled`, rating columns, `chef_private` check statuses.
- Pending/rejected chefs, their dishes and availability must be invisible to anon and other users.
- Bookings that are `declined` or `cancelled` free the date; others block.
- Tables with RLS off: none (verify with a query on `pg_class`).
