-- ---------------------------------------------------------------------------
-- T-074: follow-ups from T-065. New migration; earlier migrations are not edited.
--
--   * D-58: can_view_kitchen_photos follows the D-52 window (booking_contact_open): the customer
--     of a chef's-home booking sees the kitchen photos from acceptance until 00:00 Toronto on
--     (last visit day + 8); a cancelled, declined, expired or requested booking never shows them.
--     Enforced by the storage policy kitchen_photos_select_customer, which calls this function.
--   * D-59: answer_booking refuses to accept a chef's-home booking when the chef has chef's home
--     enabled but no complete kitchen address saved: result 'kitchen_address_missing'. Nothing
--     is changed; the chef can still decline.
--   * T-065 review L1: set_chef_kitchen_address also writes the chefs columns of the same PATCH
--     (p_chef_columns), so the kitchen address, the check reset, the chefs columns and the
--     chef's-home switch-off are ONE transaction.
--   * N1: the chef row is locked FOR NO KEY UPDATE (as the admin functions do), not FOR UPDATE.
--     It still conflicts with answer_booking's FOR SHARE.
--   * N2: explicit revoke on booking_kitchen_addresses. (The comment "the default privileges
--     already strip new functions" in 20261015100000 is wrong: Supabase's default privileges GIVE
--     new functions to anon, which is why that migration also revokes explicitly.)
--   * N4: answer_booking indentation fixed (the body is otherwise the 20261015100000 one).
--   * N5: booking_kitchen_addresses rows are kept after the window ends or the booking is
--     cancelled. No client can read them (RLS on, no grant, no policy) and get_booking_contact
--     stops returning them, so keeping them is safe; the rows cascade-delete with the booking.
--     A retention job (delete after the window) is a later decision, not built.
--
-- Lock order (everywhere): chefs row, then chef_private row, then bookings row.
--   answer_booking: chefs FOR SHARE, then bookings FOR UPDATE (chef_private is only read).
--   set_chef_kitchen_address: chefs FOR NO KEY UPDATE, then chef_private FOR UPDATE.
--
-- MOCK: nothing here moves money; all identity and SMS checks stay mocked.

-- N2
revoke all on public.booking_kitchen_addresses from public, anon, authenticated;
comment on table public.booking_kitchen_addresses is
  'Kitchen address copied at acceptance. Server and get_booking_contact only. Rows are kept after the D-52 window or a cancel (no client access); delete only with the booking.';

-- ---------------------------------------------------------------------------
-- D-58: kitchen photos follow the D-52 window
-- ---------------------------------------------------------------------------
create or replace function public.can_view_kitchen_photos(p_chef uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.chef_id = p_chef
      and b.customer_id = (select auth.uid())
      and b.location_type = 'chef_home'
      and public.booking_contact_open(b.id, b.status)
  );
$$;

-- ---------------------------------------------------------------------------
-- answer_booking: 20261015100000 body + D-59 (marked) + N4
-- ---------------------------------------------------------------------------
create or replace function public.answer_booking(
  p_booking uuid, p_chef uuid, p_action text, p_reason text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  c public.chefs%rowtype;
  k public.chef_private%rowtype;
begin
  if p_action not in ('accept', 'decline') then
    raise exception 'action must be accept or decline' using errcode = '22023';
  end if;

  -- Lock order everywhere: chef, then booking. FOR SHARE waits for an admin reject or a kitchen
  -- address change in flight and makes one that starts now wait for this answer.
  select * into c from public.chefs where profile_id = p_chef for share;

  select * into b from public.bookings where id = p_booking and chef_id = p_chef for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if b.status <> 'requested' then
    return jsonb_build_object('result', 'invalid_state', 'status', b.status);
  end if;

  if coalesce(b.expires_at, b.created_at + interval '72 hours') <= now() then
    update public.bookings set status = 'expired' where id = b.id;
    insert into public.notifications (user_id, booking_id, type, title, body)
    select u, b.id, 'booking_expired', 'A booking request expired',
           'The request was not answered in time, so the date is free again.'
      from (values (b.customer_id), (b.chef_id)) v (u);
    return jsonb_build_object('result', 'expired');
  end if;

  if p_action = 'accept' then
    if c.status is distinct from 'approved' then
      return jsonb_build_object('result', 'chef_not_approved');
    end if;
    -- The admin may have switched chef's home off (kitchen changed or rejected) after the request.
    if b.location_type = 'chef_home' and not c.chef_home_enabled then
      return jsonb_build_object('result', 'chef_home_not_enabled');
    end if;
    if b.location_type = 'chef_home' then
      -- The chef row is share-locked, so set_chef_kitchen_address cannot change the address
      -- between this read and the accept.
      select * into k from public.chef_private where chef_id = p_chef;
      -- T-074 / D-59: no complete kitchen address, no accept (the customer would get no address).
      if not found or k.kitchen_address_line is null or k.kitchen_city is null
         or k.kitchen_postal_code is null then
        return jsonb_build_object('result', 'kitchen_address_missing');
      end if;
      insert into public.booking_kitchen_addresses (booking_id, address_line, city, postal_code)
      values (b.id, k.kitchen_address_line, k.kitchen_city, k.kitchen_postal_code)
      on conflict (booking_id) do nothing;
    end if;
    update public.bookings set status = 'accepted', responded_at = now() where id = b.id;
    insert into public.notifications (user_id, booking_id, type, title, body)
    values (b.customer_id, b.id, 'booking_accepted', 'Your booking was accepted',
            'The chef accepted your request. You can now see the contact details.');
    return jsonb_build_object('result', 'ok', 'status', 'accepted');
  end if;

  -- The trigger bookings_sync_days turns the days' is_active off, so the dates are free again.
  update public.bookings
     set status = 'declined', responded_at = now(), decline_reason = p_reason
   where id = b.id;
  insert into public.notifications (user_id, booking_id, type, title, body)
  values (b.customer_id, b.id, 'booking_declined', 'Your booking was declined',
          coalesce(p_reason, 'The chef could not take this booking.'));
  return jsonb_build_object('result', 'ok', 'status', 'declined');
end;
$$;

-- ---------------------------------------------------------------------------
-- set_chef_kitchen_address: now also writes the chefs columns (review L1) with FOR NO KEY UPDATE (N1)
-- ---------------------------------------------------------------------------
-- p_chef_columns: jsonb object with any of bio, photo_path, cuisines, languages,
-- hourly_rate_cents, service_postal_prefix, service_radius_km, location_options (a key that is
-- present is written, JSON null clears a nullable column; a missing key leaves the column alone).
-- Any other key is an error, so a caller can never write status, ratings or the like.
-- chef_home_enabled is always switched off (D-21: an admin enables it again).
drop function public.set_chef_kitchen_address(uuid, timestamptz, text, text, text, public.mock_check_status, timestamptz, timestamptz);
create function public.set_chef_kitchen_address(
  p_chef uuid, p_expected_updated_at timestamptz,
  p_line text, p_city text, p_postal text,
  p_kitchen_status public.mock_check_status,
  p_allergen_ack_at timestamptz, p_hygiene_ack_at timestamptz,
  p_chef_columns jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  cp public.chef_private%rowtype;
  cc jsonb := coalesce(p_chef_columns, '{}'::jsonb);
begin
  if exists (select 1 from jsonb_object_keys(cc) as k(key)
              where k.key not in ('bio', 'photo_path', 'cuisines', 'languages',
                                  'hourly_rate_cents', 'service_postal_prefix',
                                  'service_radius_km', 'location_options')) then
    raise exception 'unknown chefs column' using errcode = '22023';
  end if;

  perform 1 from public.chefs where profile_id = p_chef for no key update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  select * into cp from public.chef_private where chef_id = p_chef for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if cp.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('result', 'conflict');
  end if;

  if exists (select 1 from public.bookings
              where chef_id = p_chef and location_type = 'chef_home' and status = 'accepted') then
    return jsonb_build_object('result', 'kitchen_in_use');
  end if;

  update public.chef_private
     set kitchen_address_line = p_line,
         kitchen_city = p_city,
         kitchen_postal_code = p_postal,
         kitchen_status = coalesce(p_kitchen_status, kitchen_status),
         allergen_ack_at = coalesce(p_allergen_ack_at, allergen_ack_at),
         kitchen_hygiene_ack_at = coalesce(p_hygiene_ack_at, kitchen_hygiene_ack_at)
   where chef_id = p_chef;

  update public.chefs
     set chef_home_enabled = false,
         bio = case when cc ? 'bio' then cc ->> 'bio' else bio end,
         photo_path = case when cc ? 'photo_path' then cc ->> 'photo_path' else photo_path end,
         cuisines = case when cc ? 'cuisines'
                         then array(select jsonb_array_elements_text(cc -> 'cuisines'))
                         else cuisines end,
         languages = case when cc ? 'languages'
                          then array(select jsonb_array_elements_text(cc -> 'languages'))
                          else languages end,
         hourly_rate_cents = case when cc ? 'hourly_rate_cents'
                                  then (cc ->> 'hourly_rate_cents')::integer
                                  else hourly_rate_cents end,
         service_postal_prefix = case when cc ? 'service_postal_prefix'
                                      then cc ->> 'service_postal_prefix'
                                      else service_postal_prefix end,
         service_radius_km = case when cc ? 'service_radius_km'
                                  then (cc ->> 'service_radius_km')::integer
                                  else service_radius_km end,
         location_options = case when cc ? 'location_options'
                                 then array(select jsonb_array_elements_text(cc -> 'location_options'))::public.location_type[]
                                 else location_options end
   where profile_id = p_chef;
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke execute on function public.set_chef_kitchen_address(uuid, timestamptz, text, text, text, public.mock_check_status, timestamptz, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.set_chef_kitchen_address(uuid, timestamptz, text, text, text, public.mock_check_status, timestamptz, timestamptz, jsonb) to service_role;
