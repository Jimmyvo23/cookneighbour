-- T-025 storage buckets and policies.
-- Path convention: <owner user id>/<file> for chef-documents and the photo buckets,
-- <booking id>/<file> for receipts. RLS is already enabled on storage.objects by Supabase.
--   chef-documents  private. Chef uploads (insert only); only admin can read or delete. MOCK verification.
--   profile-photos, dish-photos, kitchen-photos  public read; the owner (first folder = own uid) writes.
--   receipts        private. Chef of the booking uploads; both booking parties and admin read.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('chef-documents', 'chef-documents', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf']),
  ('profile-photos', 'profile-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('dish-photos', 'dish-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('kitchen-photos', 'kitchen-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

-- chef-documents
create policy chef_documents_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chef-documents'
              and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy chef_documents_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'chef-documents' and (select public.is_admin()));
create policy chef_documents_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'chef-documents' and (select public.is_admin()));

-- public photo buckets
create policy public_photos_select on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('profile-photos', 'dish-photos', 'kitchen-photos'));
create policy public_photos_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id in ('profile-photos', 'dish-photos', 'kitchen-photos')
              and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy public_photos_update_own on storage.objects
  for update to authenticated
  using (bucket_id in ('profile-photos', 'dish-photos', 'kitchen-photos')
         and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id in ('profile-photos', 'dish-photos', 'kitchen-photos')
              and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy public_photos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id in ('profile-photos', 'dish-photos', 'kitchen-photos')
         and (storage.foldername(name))[1] = (select auth.uid())::text);

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
