-- T-031 tester finding F3 (Planner decision). Applied after review; do not edit once applied.
--
-- A chef could overwrite an already verified kitchen photo in place: with the same object name and
-- upsert (or delete, then insert) the picture changes while the stored path stays the same, so the
-- N1 reset (which only watches path changes) never fires and `kitchen_status` stays `verified` and
-- `chef_home_enabled` stays true over a different image. CLAUDE.md 6.7 requires admin review of the
-- kitchen photos before the chef's-home option is enabled.
--
-- Fix: the chef can only INSERT new kitchen-photo objects (and read their own). They have no update
-- and no delete policy any more. A new file means a new path, which the chef routes treat as a
-- kitchen change (check back to pending, chef's home off). Removing a photo goes through
-- DELETE /api/chef/application/documents, which deletes the object with the service role after
-- the checks. The admin delete policy and the owner / admin / customer read policies stay.
--
-- chef-documents is already insert-only for chefs. profile-photos and dish-photos keep their owner
-- update and delete policies on purpose: no verified MOCK check depends on those files (see
-- docs/data-model.md, Storage).
drop policy kitchen_photos_update_own on storage.objects;
drop policy kitchen_photos_delete_own on storage.objects;
