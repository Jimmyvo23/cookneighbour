-- T-035 admin chef-queue API. Three functions that make an admin decision ONE transaction.
-- Applied after review; do not edit once applied. It only adds functions: no table, column, policy
-- or row changes, so it is safe on hosted data.
--
-- Why functions: "approve" has to be true for several tables at the moment it is written (chefs,
-- chef_private, profile_private, dishes and the stored files), and the REST API cannot lock or
-- compare across tables in one statement. Without this, a file swapped, a dish deactivated or a
-- check changed between the admin's read and the write could still be approved (T-026 note, T-031
-- R2). Each function takes row locks on the chef's `chefs` and `chef_private` rows, re-reads
-- everything under those locks, decides, writes and adds the notification, all in one transaction.
--
-- They are SECURITY INVOKER (no definer rights): they run with the privileges of the caller, and
-- only service_role may call them. The route (src/lib/server/admin-chefs.ts) checks
-- profiles.role = 'admin' first and only then creates the service-role client. EXECUTE is revoked
-- from public, anon and authenticated, so a signed-in browser cannot call them over the REST API.
--
-- MOCK: ID, food-handler and kitchen "verified" statuses are simulated outcomes recorded by an
-- admin; nothing here checks a real document. The completeness rules below mirror computeMissing()
-- in src/lib/domain/chef-application.ts (same item names, same order) and add "the stored file
-- really exists" (storage.objects). A test compares both lists.
--
-- Results are jsonb: { result: 'ok' | 'not_found' | 'invalid_state' | 'incomplete' | 'unverified'
-- | 'stale' | 'not_offered', ... }.

-- ---------------------------------------------------------------------------
-- Approve: pending -> approved, only if complete, files exist and both MOCK checks are verified
-- ---------------------------------------------------------------------------
create function public.admin_approve_chef(p_chef_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c public.chefs%rowtype;
  p public.chef_private%rowtype;
  phone_ok boolean;
  dish_n integer;
  kitchen_n integer;
  addr_ok boolean;
  missing text[] := '{}';
  unverified text[] := '{}';
begin
  -- Lock order is always chefs, then chef_private. NO KEY UPDATE still blocks every other
  -- writer of these rows but does not block foreign-key checks (a chef adding a dish).
  select * into c from public.chefs where profile_id = p_chef_id for no key update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  select * into p from public.chef_private where chef_id = p_chef_id for no key update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  if c.status <> 'pending' then
    return jsonb_build_object('result', 'invalid_state', 'status', c.status);
  end if;

  select pp.phone_verified into phone_ok from public.profile_private pp where pp.profile_id = p_chef_id;
  phone_ok := coalesce(phone_ok, false); -- MOCK SMS verification

  -- The sample menu: active dishes whose photo file exists. Share-locked so a dish cannot be
  -- changed under us before this transaction ends.
  perform 1 from public.dishes d
    where d.chef_id = p_chef_id and d.is_active and d.photo_path is not null
    for share;
  select count(*) into dish_n from public.dishes d
    where d.chef_id = p_chef_id and d.is_active and d.photo_path is not null
      and exists (select 1 from storage.objects o where o.bucket_id = 'dish-photos' and o.name = d.photo_path);

  if btrim(c.display_name) = '' or btrim(c.display_name) = 'New user' then missing := array_append(missing, 'displayName'); end if;
  if c.bio is null or btrim(c.bio) = '' then missing := array_append(missing, 'bio'); end if;
  if c.photo_path is null
     or not exists (select 1 from storage.objects o where o.bucket_id = 'profile-photos' and o.name = c.photo_path)
  then missing := array_append(missing, 'photo'); end if;
  if cardinality(c.cuisines) = 0 then missing := array_append(missing, 'cuisines'); end if;
  if cardinality(c.languages) = 0 then missing := array_append(missing, 'languages'); end if;
  if c.hourly_rate_cents is null then missing := array_append(missing, 'hourlyRate'); end if;
  if c.service_postal_prefix is null then missing := array_append(missing, 'servicePostalPrefix'); end if;
  if cardinality(c.location_options) = 0 then missing := array_append(missing, 'locationOptions'); end if;
  if p.id_document_path is null
     or not exists (select 1 from storage.objects o where o.bucket_id = 'chef-documents' and o.name = p.id_document_path)
  then missing := array_append(missing, 'idDocument'); end if;
  if p.food_handler_path is null
     or not exists (select 1 from storage.objects o where o.bucket_id = 'chef-documents' and o.name = p.food_handler_path)
  then missing := array_append(missing, 'foodHandler'); end if;
  if p.allergen_ack_at is null then missing := array_append(missing, 'allergenAcknowledgement'); end if;
  if not phone_ok then missing := array_append(missing, 'phoneVerified'); end if;
  if dish_n < 1 then missing := array_append(missing, 'sampleDish'); end if;
  if 'chef_home'::public.location_type = any (c.location_options) then
    addr_ok := coalesce(p.kitchen_address_line, '') <> '' and coalesce(p.kitchen_city, '') <> ''
               and coalesce(p.kitchen_postal_code, '') <> '';
    select count(*) into kitchen_n from unnest(p.kitchen_photo_paths) k
      where exists (select 1 from storage.objects o where o.bucket_id = 'kitchen-photos' and o.name = k);
    if not addr_ok then missing := array_append(missing, 'kitchenAddress'); end if;
    if kitchen_n = 0 then missing := array_append(missing, 'kitchenPhotos'); end if;
    if p.kitchen_hygiene_ack_at is null then missing := array_append(missing, 'kitchenHygieneAcknowledgement'); end if;
  end if;

  if cardinality(missing) > 0 then
    return jsonb_build_object('result', 'incomplete', 'missing', to_jsonb(missing));
  end if;

  -- MOCK checks must still be 'verified' now, on the files stored now.
  if p.id_check_status <> 'verified' then unverified := array_append(unverified, 'idCheck'); end if;
  if p.food_handler_status <> 'verified' then unverified := array_append(unverified, 'foodHandlerCheck'); end if;
  if cardinality(unverified) > 0 then
    return jsonb_build_object('result', 'unverified', 'unverified', to_jsonb(unverified));
  end if;

  update public.chef_private set reject_reason = null where chef_id = p_chef_id; -- bumps updated_at
  update public.chefs set status = 'approved' where profile_id = p_chef_id;
  insert into public.notifications (user_id, type, title, body)
  values (p_chef_id, 'chef_approved', 'Your chef application was approved',
          'Customers can now find you in search. In this prototype the ID and certificate checks are MOCK.');
  return jsonb_build_object('result', 'ok');
end;
$$;

-- ---------------------------------------------------------------------------
-- Reject: pending or approved -> rejected, with the reason shown to the chef
-- ---------------------------------------------------------------------------
create function public.admin_reject_chef(p_chef_id uuid, p_reason text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c public.chefs%rowtype;
begin
  select * into c from public.chefs where profile_id = p_chef_id for no key update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  perform 1 from public.chef_private where chef_id = p_chef_id for no key update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  if c.status not in ('pending', 'approved') then
    return jsonb_build_object('result', 'invalid_state', 'status', c.status);
  end if;

  update public.chef_private set reject_reason = p_reason where chef_id = p_chef_id;
  update public.chefs set status = 'rejected' where profile_id = p_chef_id;
  insert into public.notifications (user_id, type, title, body)
  values (p_chef_id, 'chef_rejected', 'Your chef application was not approved', p_reason);
  return jsonb_build_object('result', 'ok');
end;
$$;

-- ---------------------------------------------------------------------------
-- Kitchen review (MOCK): the admin approves or rejects the kitchen they viewed
-- ---------------------------------------------------------------------------
-- p_photos and p_address are what the admin viewed. If either differs from what is stored now
-- (photos compared as sets), nothing is written ('stale', B1). p_address is null when no kitchen
-- address was stored when the admin looked.
create function public.admin_review_kitchen(
  p_chef_id uuid, p_decision text, p_note text, p_photos text[], p_address jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c public.chefs%rowtype;
  p public.chef_private%rowtype;
  addr_ok boolean;
  no_address boolean := p_address is null or jsonb_typeof(p_address) = 'null';
  kitchen_n integer;
  missing text[] := '{}';
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject' using errcode = '22023';
  end if;
  select * into c from public.chefs where profile_id = p_chef_id for no key update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  select * into p from public.chef_private where chef_id = p_chef_id for no key update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  addr_ok := coalesce(p.kitchen_address_line, '') <> '' and coalesce(p.kitchen_city, '') <> ''
             and coalesce(p.kitchen_postal_code, '') <> '';

  -- B1: what the admin viewed must still be what is stored.
  if not (coalesce(p_photos, '{}') @> p.kitchen_photo_paths and coalesce(p_photos, '{}') <@ p.kitchen_photo_paths) then
    return jsonb_build_object('result', 'stale');
  end if;
  if no_address then
    if addr_ok then return jsonb_build_object('result', 'stale'); end if;
  else
    if not addr_ok
       or p_address ->> 'line' is distinct from p.kitchen_address_line
       or p_address ->> 'city' is distinct from p.kitchen_city
       or p_address ->> 'postalCode' is distinct from p.kitchen_postal_code
    then return jsonb_build_object('result', 'stale'); end if;
  end if;

  if p_decision = 'approve' then
    if not ('chef_home'::public.location_type = any (c.location_options)) then
      return jsonb_build_object('result', 'not_offered');
    end if;
    select count(*) into kitchen_n from unnest(p.kitchen_photo_paths) k
      where exists (select 1 from storage.objects o where o.bucket_id = 'kitchen-photos' and o.name = k);
    if not addr_ok then missing := array_append(missing, 'kitchenAddress'); end if;
    if kitchen_n = 0 then missing := array_append(missing, 'kitchenPhotos'); end if;
    if p.kitchen_hygiene_ack_at is null then missing := array_append(missing, 'kitchenHygieneAcknowledgement'); end if;
    if cardinality(missing) > 0 then
      return jsonb_build_object('result', 'incomplete', 'missing', to_jsonb(missing));
    end if;
    update public.chef_private set kitchen_status = 'verified' where chef_id = p_chef_id; -- MOCK
    update public.chefs set chef_home_enabled = true where profile_id = p_chef_id;
    insert into public.notifications (user_id, type, title, body)
    values (p_chef_id, 'kitchen_approved', 'Your kitchen was approved',
            coalesce(p_note, 'Customers can now book you at your home. In this prototype the kitchen review is MOCK.'));
  else
    update public.chef_private set kitchen_status = 'failed' where chef_id = p_chef_id; -- MOCK
    update public.chefs set chef_home_enabled = false where profile_id = p_chef_id;
    insert into public.notifications (user_id, type, title, body)
    values (p_chef_id, 'kitchen_rejected', 'Your kitchen was not approved', p_note);
  end if;
  return jsonb_build_object('result', 'ok');
end;
$$;

-- Only the server (service role) may call these. The route checks profiles.role = 'admin' first.
revoke execute on function public.admin_approve_chef(uuid) from public, anon, authenticated;
revoke execute on function public.admin_reject_chef(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_review_kitchen(uuid, text, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.admin_approve_chef(uuid) to service_role;
grant execute on function public.admin_reject_chef(uuid, text) to service_role;
grant execute on function public.admin_review_kitchen(uuid, text, text, text[], jsonb) to service_role;
