-- ---------------------------------------------------------------------------
-- T-065: contact privacy. New migration; earlier migrations are not edited.
--
--   * booking_kitchen_addresses: the chef's kitchen address copied onto the booking when the chef
--     accepts a chef's-home booking (T-063 review M4). get_booking_contact returns this copy, so a
--     later kitchen-address change never shows a new address to a past customer. No client can
--     read the table (RLS on, no grant, no policy); only get_booking_contact (SECURITY DEFINER) and
--     the server read it.
--   * answer_booking: the T-063 body (20261011200000) plus the snapshot, written in the same
--     transaction and under the same chef row lock as the accept.
--   * set_chef_kitchen_address (T-063 review L4 / N3): the N3 check ("no accepted chef's-home
--     booking") and the write are one function. It locks the chef row FOR UPDATE first (the same
--     order as answer_booking and admin_reject_chef: chef, chef_private, booking), so an accept
--     that is running either finishes first (the change is then refused) or waits and finds
--     chef's home switched off.
--   * D-52 / D-56: contact details (phone and address) are visible from acceptance until the end
--     of the 7th day after the last visit day, Toronto calendar: they hide again at 00:00
--     Toronto on (last visit day + 8). A cancelled, declined, expired or requested booking never
--     shows them (D-56: cancelling locks contact both ways at once, as before). Chat is
--     unaffected (messages use their own policies).
--     get_booking_contact gains a column, visible_until (the instant it hides again).
--
-- MOCK: nothing here moves money; all identity and SMS checks stay mocked.

-- ---------------------------------------------------------------------------
-- Kitchen address snapshot
-- ---------------------------------------------------------------------------
create table public.booking_kitchen_addresses (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  address_line text not null,
  city text not null,
  postal_code text not null check (postal_code ~ '^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$'),
  created_at timestamptz not null default now()
);
alter table public.booking_kitchen_addresses enable row level security;
-- Deliberately no grant and no policy: not even admins read it from a browser.

-- Bookings already accepted before this migration get the chef's current address (best available;
-- earlier changes cannot be recovered, and N3 has blocked changes while a booking was accepted).
insert into public.booking_kitchen_addresses (booking_id, address_line, city, postal_code)
select b.id, cp.kitchen_address_line, cp.kitchen_city, cp.kitchen_postal_code
  from public.bookings b
  join public.chef_private cp on cp.chef_id = b.chef_id
 where b.location_type = 'chef_home'
   and b.status in ('accepted', 'completed', 'no_show_customer', 'no_show_chef')
   and cp.kitchen_address_line is not null
   and cp.kitchen_city is not null
   and cp.kitchen_postal_code is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- D-52 / D-56 window
-- ---------------------------------------------------------------------------
-- The instant contact details hide again: 00:00 Toronto on (last visit day + 8), daylight saving
-- included. Null when the booking has no days.
create function public.booking_contact_ends_at(p_booking uuid) returns timestamptz
language sql stable
set search_path = ''
as $$
  select ((max(d.visit_date) + 8)::timestamp at time zone 'America/Toronto')
    from public.booking_days d
   where d.booking_id = p_booking;
$$;

-- True while the parties may see each other's phone and address.
create function public.booking_contact_open(
  p_booking uuid, p_status public.booking_status, p_at timestamptz default now()
) returns boolean
language sql stable
set search_path = ''
as $$
  select public.booking_contact_unlocked(p_status)
     and coalesce(p_at < public.booking_contact_ends_at(p_booking), false);
$$;

drop function public.get_booking_contact(uuid);
create function public.get_booking_contact(p_booking uuid)
returns table (
  counterparty_role public.user_role,
  display_name text,
  phone_e164 text,
  address_line text,
  city text,
  postal_code text,
  visible_until timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  b public.bookings;
  me uuid := (select auth.uid());
  until_at timestamptz;
begin
  select * into b from public.bookings where id = p_booking;
  if not found or me is null or me not in (b.customer_id, b.chef_id)
     or not public.booking_contact_open(b.id, b.status) then
    return;
  end if;
  until_at := public.booking_contact_ends_at(b.id);

  if me = b.chef_id then
    return query
      select 'customer'::public.user_role, p.display_name, pp.phone_e164,
             ba.address_line, ba.city, ba.postal_code, until_at
        from public.profiles p
        join public.profile_private pp on pp.profile_id = p.id
        left join public.booking_addresses ba
               on ba.booking_id = b.id and b.location_type = 'customer_home'
       where p.id = b.customer_id;
  else
    -- Chef's home: the address copied at acceptance, never the chef's current one.
    return query
      select 'chef'::public.user_role, p.display_name, pp.phone_e164,
             ka.address_line, ka.city, ka.postal_code, until_at
        from public.profiles p
        join public.profile_private pp on pp.profile_id = p.id
        left join public.booking_kitchen_addresses ka
               on ka.booking_id = b.id and b.location_type = 'chef_home'
       where p.id = b.chef_id;
  end if;
end;
$$;
-- Supabase's own default privileges give new functions to anon: take that away explicitly.
revoke execute on function public.get_booking_contact(uuid) from public, anon;
grant execute on function public.get_booking_contact(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- answer_booking: the 20261011200000 body plus the kitchen snapshot (marked below)
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
  k public.chef_private%rowtype; -- T-065
begin
  if p_action not in ('accept', 'decline') then
    raise exception 'action must be accept or decline' using errcode = '22023';
  end if;

  -- Lock order everywhere: chef, then booking. FOR SHARE waits for an admin reject in flight and
  -- makes a reject that starts now wait for this answer.
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
    -- T-065 begin: copy the kitchen address onto the booking (the chef row is share-locked, so
    -- set_chef_kitchen_address cannot change it between this read and the accept).
    if b.location_type = 'chef_home' then
      select * into k from public.chef_private where chef_id = p_chef;
      if not found or k.kitchen_address_line is null or k.kitchen_city is null
         or k.kitchen_postal_code is null then
        return jsonb_build_object('result', 'chef_home_not_enabled');
      end if;
      insert into public.booking_kitchen_addresses (booking_id, address_line, city, postal_code)
      values (b.id, k.kitchen_address_line, k.kitchen_city, k.kitchen_postal_code)
      on conflict (booking_id) do nothing;
    end if;
    -- T-065 end
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
-- set_chef_kitchen_address (N3, T-063 review L4): check and write in one locked function
-- ---------------------------------------------------------------------------
-- Returns { result: 'ok' } | { result: 'not_found' } | { result: 'conflict' } (the chef_private
-- row changed since the caller read it: read again) | { result: 'kitchen_in_use' } (the chef has
-- an accepted chef's-home booking: the customer was given this address).
-- p_kitchen_status null leaves the MOCK kitchen check alone; the acknowledgement timestamps are
-- only set when given. Switches chef's home off (D-21: an admin enables it again).
create function public.set_chef_kitchen_address(
  p_chef uuid, p_expected_updated_at timestamptz,
  p_line text, p_city text, p_postal text,
  p_kitchen_status public.mock_check_status,
  p_allergen_ack_at timestamptz, p_hygiene_ack_at timestamptz
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  cp public.chef_private%rowtype;
begin
  perform 1 from public.chefs where profile_id = p_chef for update;
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
  update public.chefs set chef_home_enabled = false where profile_id = p_chef;
  return jsonb_build_object('result', 'ok');
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: server only (the default privileges already strip new functions; stated explicitly)
-- ---------------------------------------------------------------------------
revoke execute on function public.booking_contact_ends_at(uuid) from public, anon, authenticated;
revoke execute on function public.booking_contact_open(uuid, public.booking_status, timestamptz) from public, anon, authenticated;
revoke execute on function public.set_chef_kitchen_address(uuid, timestamptz, text, text, text, public.mock_check_status, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.booking_contact_ends_at(uuid) to service_role;
grant execute on function public.booking_contact_open(uuid, public.booking_status, timestamptz) to service_role;
grant execute on function public.set_chef_kitchen_address(uuid, timestamptz, text, text, text, public.mock_check_status, timestamptz, timestamptz) to service_role;
