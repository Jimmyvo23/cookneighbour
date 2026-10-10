-- T-061 (D-21): two admin rules changed. This is a NEW migration; 20261010120000 is not edited.
-- It only replaces two functions (create or replace keeps their owner and grants; the grants are
-- repeated below so this file reads on its own). No table, column, policy or row changes.
--
--   admin_reject_chef:     also sets chefs.chef_home_enabled = false (D-21d). Re-approving the
--                          chef later does not bring chef's home back; the kitchen is reviewed again.
--   admin_review_kitchen:  refuses a chef whose status is not pending or approved with
--                          { result: 'invalid_state', status } (D-21b). The route answers 409.
--
-- Everything else in both functions is identical to 20261010120000; a unit test compares the
-- bodies so the two files cannot drift apart. MOCK: the kitchen review is a simulated outcome.

create or replace function public.admin_reject_chef(p_chef_id uuid, p_reason text) returns jsonb
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
  -- D-21(d): a rejected chef is not bookable at their own home until an admin approves the kitchen again.
  update public.chefs set status = 'rejected', chef_home_enabled = false where profile_id = p_chef_id;
  insert into public.notifications (user_id, type, title, body)
  values (p_chef_id, 'chef_rejected', 'Your chef application was not approved', p_reason);
  return jsonb_build_object('result', 'ok');
end;
$$;

create or replace function public.admin_review_kitchen(
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

  -- D-21(b): the kitchen of a rejected chef is not reviewed.
  if c.status not in ('pending', 'approved') then
    return jsonb_build_object('result', 'invalid_state', 'status', c.status);
  end if;

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

revoke execute on function public.admin_reject_chef(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_review_kitchen(uuid, text, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.admin_reject_chef(uuid, text) to service_role;
grant execute on function public.admin_review_kitchen(uuid, text, text, text[], jsonb) to service_role;
