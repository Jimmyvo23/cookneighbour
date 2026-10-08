# Handoff: T-025 Core schema migrations + RLS (test verdict)

From: tester  To: reviewer

## Verdict: PASS

No schema or RLS bug found. All 83 T-027 tests pass against the real local Supabase stack (migrations applied by `supabase start` in CI).

## What changed
- Branch: `feature/T-025-schema-rls` (PR #55) verified through the T-027 suite on `feature/T-027-rls-tests` (PR https://github.com/Jimmyvo23/cookneighbour/pull/56).
- Evidence: CI run https://github.com/Jimmyvo23/cookneighbour/actions/runs/37697131032 , job `ci` green, step "RLS tests": 6 files, 83 tests, 0 failed. All other CI steps (lint, typecheck, prettier, unit, build, Playwright smoke) also green.

## How to verify
Re-run the CI run above, or locally with Docker: see `.team/handoffs/T-027-tester.md`.

## What was checked (all passing)
- Pending and rejected chefs, their dishes and availability: invisible to anon and customers; owner and admin see them. Inactive dishes hidden.
- No cross-user access to bookings, booking days and dishes, intake forms (chef can read before accepting), receipts, messages, booking_addresses (even the chef after acceptance), profile_private, chef_private, free-trial claims and blocks, notifications. Phone and address hashes unreadable by others; owner can read own (control).
- `get_booking_contact`: no rows when requested, declined, non-party, or anon (permission denied); correct data after acceptance for customer_home and chef_home; no hashes or extra columns.
- Escalation: cannot change role, approve self, change rating, review count, chef_home_enabled, police/ID/food-handler/kitchen status, reject reason; cannot insert chefs or chef_private; sign-up metadata cannot make admin; admin can approve (control).
- Forgery: clients cannot insert or update bookings, days, addresses, intake, receipts, claims, blocks, profile_private hashes, notifications beyond `read_at`.
- Messages, reviews (completed only, role and subject checks, rating cache, private chef-to-customer reviews), reports: allowed and denied cases.
- Double booking blocked, freed by cancel and decline, held by completed, no-show and accepted; past date, 4th day, repeated date, unapproved chef, chef-home rules, travel fee on chef-home, non-customer and self booking all rejected.
- Free trial: unique per customer, phone hash and address hash; released claims free them; held and consumed block; new account with same phone blocked.
- Storage: chef-documents readable by admin only, write only in own folder; receipts readable by parties and admin, uploaded only by the booking's chef, non-uuid folders refused; public photo buckets write own folder only.
- Catalog check: RLS enabled on all public tables; anon and authenticated grants match the design.

## Re-test after review fixes (commit e6b0aab): PASS
CI run https://github.com/Jimmyvo23/cookneighbour/actions/runs/37699321934 (PR #56, merged with e6b0aab): job `ci` green, RLS step 8 files, 107 tests, 0 failed. No bug found; no BLOCK.
- B1: user created without display_name (and blank) gets 'New user'; email local part not stored; explicit name kept.
- B2: foreign path, other chef's folder, `..`, prefix lookalike and bare filename rejected (23514) for chef, admin and server; own folder allowed. Verified ID or food-handler status resets to pending when the chef changes the file; kitchen photos or address change resets kitchen check and turns chef_home_enabled off (chef-home booking then blocked until admin re-enables; chef cannot re-enable). Admin and server changes do not reset. Unrelated edits do not reset.
- P1: anon lists nothing in any bucket; non-owners list nothing in profile-photos/dish-photos; owner and admin can; public URLs for profile and dish photos still return 200.
- P2: kitchen-photos private (public URL not 200); owner, admin, and customer of accepted/completed chef_home booking can read; requested, declined, customer_home-only, other customers, other chefs, anon cannot.
- P3: customer cannot upload to chef-documents, kitchen-photos, dish-photos; can upload own profile photo (not into others' folders); chef can in own folder only.
- P4: created_at, id, author_display_name, status, admin_note, resolved_at refused on insert (42501); bogus report category rejected (22P02); all five categories accepted; default 'other'.
- Exact snapshots of table, column and function privileges for anon and authenticated match the migrations. DB_URL localhost guard added.

## Known gaps or risks
- Observations, not bugs: `requested` bookings hold a chef's date with no expiry (already an open item); a customer can pass the dishes insert policy but the foreign key to `chefs` stops it (code 23503); chef-private documents are not readable by the owning chef (design: admin only).
- Not covered: see T-027 handoff.

## What the next agent needs
Reviewer can read the tests in `tests/rls/` on PR #56 as the executable spec of `docs/data-model.md`.
