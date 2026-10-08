-- T-028 auth backend. Routes become the only writers of profiles, chefs and chef_private
-- (API contract section 2, decision B2 option a). Applied after review; do not edit once applied.

-- 1. Clients can no longer UPDATE these tables. Routes write with the service role after their own
--    checks (whitelisted columns, server clock, rate bounds, path ownership, MOCK reset rules).
--    The guard triggers stay as a second line of defence for any other non-admin writer.
revoke update on public.profiles, public.chefs, public.chef_private from authenticated;
drop policy profiles_update_own on public.profiles;
drop policy chefs_update_own on public.chefs;
drop policy chefs_update_admin on public.chefs;
drop policy chef_private_update_own on public.chef_private;
drop policy chef_private_update_admin on public.chef_private;

-- 2. Stored photo paths must sit in the owner's own folder "<owner id>/..." (no "..").
--    A check constraint applies to every writer, including the server.
alter table public.chefs add constraint chefs_photo_path_own_folder
  check (photo_path is null
         or (left(photo_path, 37) = profile_id::text || '/' and photo_path not like '%..%'));
alter table public.dishes add constraint dishes_photo_path_own_folder
  check (photo_path is null
         or (left(photo_path, 37) = chef_id::text || '/' and photo_path not like '%..%'));

-- 3. A verified phone number (by hash) belongs to one account only (contract section 8).
create unique index profile_private_phone_hash_verified
  on public.profile_private (phone_hash) where phone_verified;
