# Handoff: T-025 review — changes requested

From: reviewer (written by planner)  To: backend, then tester

Review: https://github.com/Jimmyvo23/cookneighbour/pull/55#issuecomment-6048393979
The migrations are not merged or applied anywhere yet, so edit the existing migration files in place (no new migration needed).

## Blocking
- B1. `handle_new_user()` falls back to `split_part(email,'@',1)` for display_name. Email local parts are often real names and end up in public `reviews.author_display_name`. Fallback to `'New user'`.
- B2. A chef can set `chef_private.id_document_path` / `food_handler_path` / `kitchen_photo_paths` to another user's files. Require every path to start with `chef_id::text || '/'` (CHECK constraint or guard trigger). Also reset the matching mock check status to `pending` when a document, kitchen photos or kitchen address changes after `verified`.

## Planner decisions (fix in this PR)
- P1. Public photo buckets: remove anon/public listing; listing only for the folder owner and admin (public URLs still work for profile and dish photos).
- P2. Kitchen photos become PRIVATE (reverses the earlier Planner call; decision D-10): readable by the owning chef, admin, and the customer of an accepted/completed chef_home booking with that chef. Update PLAN.md §3 wording in `docs/data-model.md` only; Planner updates PLAN.md.
- P3. Only users with role chef may upload to `chef-documents` and `kitchen-photos` (and dish-photos); any user may upload their own profile photo.
- P4. Column-level insert grants on `messages`, `reviews`, `reports` so clients cannot set `created_at`/ids/server columns; `reports.category` becomes an enum or CHECK list (e.g. safety, food_quality, no_show, payment, other).
- P5. `docs/data-model.md`: add a "Writing a new migration" checklist (default privileges are revoked for tables AND functions: grant explicitly, add RLS, add T-027 tests), and the justification for storing `phone_e164` (shown to the other party after acceptance, §6.8; only via `get_booking_contact`).

## For later tasks (do not do now)
- Server must authorize in code in every API route (T-026/T-028/T-031/T-037/T-038): caller identity, booking state, receipt path prefix, free-trial state transitions, phone verified before claim.
- Phone uniqueness across accounts: decide in T-028.
- Contact details re-lock after completion: open question Q-12.
- Requested-booking expiry and rate limits: WO-4 (Q-11).
- Public reviews expose author_id/booking_id: consider a view later.

## Tester (after backend pushes)
On `feature/T-027-rls-tests` (merge the updated T-025 branch in): regression tests for B1 (signUp without display_name → 'New user', email not exposed) and B2 (foreign path rejected, own path allowed, status reset); tests for P1–P4; add the localhost guard to `DB_URL`; replace the grant spot-check with a full table × role × privilege snapshot.

## Round 2 (re-review of e6b0aab): APPROVED
Review: https://github.com/Jimmyvo23/cookneighbour/pull/55#issuecomment-6048642153
B1, B2, P1–P5 fixed. Backend's extra (kitchen change turns `chef_home_enabled` off) accepted: §6.7 requires admin review before the option is enabled.

Notes for later tasks:
- T-035: admin verify must send the document path the admin reviewed; server rejects if the path changed since (swap-while-pending gap).
- T-031/T-035: decide whether a new upload moves a `failed` check back to `pending`.
- T-031: changing the kitchen address while a chef_home booking is accepted immediately changes what `get_booking_contact` shows that customer; block the change or notify.
- Nit: `storage_folder_uuid` and `storage_booking_id` have identical bodies.
- Storage policies are not in the privilege snapshot (behaviour tests cover them). Realtime delivery untested (WO-5).
