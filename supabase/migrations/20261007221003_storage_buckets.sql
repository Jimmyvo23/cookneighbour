-- T-025 storage buckets and policies.
-- Path convention: <owner user id>/<file> for chef-documents and the photo buckets,
-- <booking id>/<file> for receipts. RLS is already enabled on storage.objects by Supabase.
--   chef-documents  private. A chef uploads (insert only); only admin can read or delete. MOCK verification.
--   kitchen-photos  private. Chef (own folder) uploads, reads, replaces, deletes; admin reads and deletes;
--                   the customer of an accepted/completed chef_home booking with that chef reads.
--   profile-photos, dish-photos  public URLs work for everyone (no listing). Only the folder owner and
--                   admin can list/select through the API. profile-photos: any user writes own folder.
--                   dish-photos: only users with role chef write own folder.
--   receipts        private. Chef of the booking uploads; both booking parties and admin read.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('chef-documents', 'chef-documents', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf']),
  ('profile-photos', 'profile-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('dish-photos', 'dish-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('kitchen-photos', 'kitchen-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

-- chef-documents (chefs only)
create policy chef_documents_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chef-documents'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select public.is_chef()));
create policy chef_documents_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'chef-documents' and (select public.is_admin()));
create policy chef_documents_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'chef-documents' and (select public.is_admin()));

-- kitchen-photos (private, chefs only write)
create policy kitchen_photos_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'kitchen-photos'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select public.is_chef()));
create policy kitchen_photos_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'kitchen-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy kitchen_photos_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'kitchen-photos' and (select public.is_admin()));
create policy kitchen_photos_select_customer on storage.objects
  for select to authenticated
  using (bucket_id = 'kitchen-photos'
         and public.can_view_kitchen_photos(public.storage_folder_uuid(name)));
create policy kitchen_photos_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'kitchen-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'kitchen-photos'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select public.is_chef()));
create policy kitchen_photos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'kitchen-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy kitchen_photos_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'kitchen-photos' and (select public.is_admin()));

-- public photo buckets: no anon listing. Public URLs do not go through these policies.
create policy public_photos_select_own on storage.objects
  for select to authenticated
  using (bucket_id in ('profile-photos', 'dish-photos')
         and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy public_photos_select_admin on storage.objects
  for select to authenticated
  using (bucket_id in ('profile-photos', 'dish-photos') and (select public.is_admin()));

create policy profile_photos_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-photos'
              and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy profile_photos_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy profile_photos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy dish_photos_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dish-photos'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select public.is_chef()));
create policy dish_photos_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'dish-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'dish-photos'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select public.is_chef()));
create policy dish_photos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'dish-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- receipts
create policy receipts_select_party on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and public.is_booking_party(public.storage_booking_id(name)));
create policy receipts_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (select public.is_admin()));
create policy receipts_insert_chef on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_booking_chef(public.storage_booking_id(name)));
