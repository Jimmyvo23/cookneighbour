-- T-042: booking API database support. New migration; earlier migrations are not edited.
--
--   * bookings.expires_at (D-19): when an unanswered `requested` booking expires. Set by the route
--     when the booking is created (earlier of 72 hours and 00:00 Toronto on day 1); null only for
--     rows made before this migration (the functions below then fall back to created_at + 72 h).
--   * `expired` frees the chef's dates like `declined` and `cancelled` (triggers updated).
--   * create_booking: booking, address, days, dish snapshots, intake form, free-trial claim and the
--     chef's notification in ONE transaction (T-038 reviewer MEDIUM). Row locks and an advisory lock
--     make the 3-open-requests limit (D-28) and double booking race-safe.
--   * answer_booking: the chef accepts or declines under a row lock; an expired request cannot be
--     accepted.
--   * expire_stale_bookings: lazy expiry (D-19) and a self-repair list of finished bookings whose
--     free-trial claim is still held.
--   * chef_remove_availability: D-22, a chef cannot clear a date with an open booking.
--   * chef_booked_dates / chefs_booked_on: dates only (A-19), for the public chef page and search.
--   * free_trial_blocks.attempts / last_attempt_at + record_free_trial_block: the block log counts
--     repeated attempts in one row per customer and reason per window instead of one row each
--     (T-038 follow-up: the log could be flooded).
--
-- All writes run as the service role from routes that already checked who the caller is. The
-- functions are SECURITY INVOKER with search_path = '' (like the T-035 admin functions) and are not
-- executable by browsers, except the two read-only date lists at the end.
-- MOCK: nothing here moves money; the free trial only waives chef labour in the prototype (Q-1).

alter table public.bookings add column expires_at timestamptz;
create index bookings_requested_expiry_idx on public.bookings (expires_at) where status = 'requested';

alter table public.free_trial_blocks
  add column attempts integer not null default 1 check (attempts >= 1),
  add column last_attempt_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- `expired` frees the dates, like `declined` and `cancelled`.
-- ---------------------------------------------------------------------------
create or replace function public.booking_days_before_insert() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = new.booking_id;
  if not found then
    raise exception 'booking not found' using errcode = '23503';
  end if;
  new.chef_id := b.chef_id;
  new.is_active := b.status not in ('declined', 'cancelled', 'expired');
  if new.visit_date < (now() at time zone 'America/Toronto')::date then
    raise exception 'visit date is in the past' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.bookings_sync_days() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.booking_days
     set is_active = new.status not in ('declined', 'cancelled', 'expired')
   where booking_id = new.id;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_booking(p jsonb) -> { result: 'ok', booking_id } | { result: <refusal> }
-- ---------------------------------------------------------------------------
-- p keys: customer_id, chef_id, location_type, grocery_option, max_open, expires_at,
--   est { hourly_rate_cents, cook_minutes, labour_cents, ingredients_cents, travel_cents,
--         platform_fee_cents, total_cents, platform_fee_percent, travel_rate_cents_per_km,
--         distance_km, service_postal_prefix },
--   address { line, city, postal_code } | null,
--   days [ { date, cook_minutes, dishes [ { dish_id, name, cook_minutes, ingredient_cost_cents,
--            servings, allergens, quantity, eat_by_date } ] } ] (sorted by date, day 1 first),
--   intake { allergies, dietary_notes, acknowledged },
--   free_trial { phone_hash, address_hash } | null.
-- Refusals are returned (the transaction wrote nothing): too_many_open, chef_not_bookable,
-- date_too_soon, chef_unavailable (with dates). Unique violations (double booking, free trial) and
-- check violations are raised, which rolls everything back; the route maps the SQLSTATE and the
-- index name in the message.
create or replace function public.create_booking(p jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_customer uuid := (p ->> 'customer_id')::uuid;
  v_chef uuid := (p ->> 'chef_id')::uuid;
  v_loc public.location_type := (p ->> 'location_type')::public.location_type;
  v_est jsonb := p -> 'est';
  v_trial jsonb := p -> 'free_trial';
  v_addr jsonb := p -> 'address';
  v_today date := (now() at time zone 'America/Toronto')::date;
  c public.chefs%rowtype;
  v_open integer;
  v_dates date[];
  v_have date[];
  v_missing date[];
  v_booking uuid := gen_random_uuid();
  v_day jsonb;
  v_dish jsonb;
  v_day_id uuid;
  v_n integer := 0;
begin
  -- One customer's creates run one after the other, so the open-request count cannot be raced.
  perform pg_advisory_xact_lock(hashtextextended('create_booking:' || v_customer::text, 0));

  select count(*) into v_open from public.bookings b
   where b.customer_id = v_customer
     and b.status = 'requested'
     and coalesce(b.expires_at, b.created_at + interval '72 hours') > now();
  if v_open >= (p ->> 'max_open')::integer then
    return jsonb_build_object('result', 'too_many_open', 'open', v_open);
  end if;

  -- FOR SHARE: a concurrent admin reject (which updates this row) waits for this transaction.
  select * into c from public.chefs where profile_id = v_chef for share;
  if not found or c.status <> 'approved'
     or not (v_loc = any (c.location_options))
     or (v_loc = 'chef_home' and not c.chef_home_enabled) then
    return jsonb_build_object('result', 'chef_not_bookable');
  end if;

  select array_agg((d ->> 'date')::date order by (d ->> 'date')::date) into v_dates
    from jsonb_array_elements(p -> 'days') d;
  -- D-27: no same-day bookings (the route checks too; this is the second line).
  if exists (select 1 from unnest(v_dates) x where x <= v_today) then
    return jsonb_build_object('result', 'date_too_soon');
  end if;

  -- Lock the chef's availability rows for these dates (FOR SHARE) so a clear cannot slip in
  -- between this check and the insert; chef_remove_availability takes FOR UPDATE on the same rows.
  select array_agg(s.day) into v_have from (
    select a.day from public.availability a
     where a.chef_id = v_chef and a.available and a.day = any (v_dates)
       for share
  ) s;
  select array_agg(x) into v_missing from unnest(v_dates) x
   where v_have is null or not (x = any (v_have));
  if v_missing is not null then
    return jsonb_build_object('result', 'chef_unavailable', 'dates', to_jsonb(v_missing));
  end if;

  insert into public.bookings (
    id, customer_id, chef_id, location_type, grocery_option, is_free_trial,
    hourly_rate_cents, est_cook_minutes, est_labour_cents, est_ingredients_cents, est_travel_cents,
    est_platform_fee_cents, est_total_cents, platform_fee_percent, travel_rate_cents_per_km,
    distance_km, service_postal_prefix, expires_at
  ) values (
    v_booking, v_customer, v_chef, v_loc, (p ->> 'grocery_option')::public.grocery_option,
    -- is_free_trial is true only together with the claim written below, in this transaction.
    v_trial is not null and jsonb_typeof(v_trial) = 'object',
    (v_est ->> 'hourly_rate_cents')::integer, (v_est ->> 'cook_minutes')::integer,
    (v_est ->> 'labour_cents')::integer, (v_est ->> 'ingredients_cents')::integer,
    (v_est ->> 'travel_cents')::integer, (v_est ->> 'platform_fee_cents')::integer,
    (v_est ->> 'total_cents')::integer, (v_est ->> 'platform_fee_percent')::numeric,
    (v_est ->> 'travel_rate_cents_per_km')::integer, (v_est ->> 'distance_km')::numeric,
    v_est ->> 'service_postal_prefix', (p ->> 'expires_at')::timestamptz
  );

  if v_addr is not null and jsonb_typeof(v_addr) = 'object' then
    insert into public.booking_addresses (booking_id, address_line, city, postal_code)
    values (v_booking, v_addr ->> 'line', v_addr ->> 'city', v_addr ->> 'postal_code');
  end if;

  for v_day in select d from jsonb_array_elements(p -> 'days') d loop
    v_n := v_n + 1;
    -- A second booking for the same chef and date raises 23505 on booking_days_one_per_chef_date.
    insert into public.booking_days (booking_id, day_number, visit_date, total_cook_minutes)
    values (v_booking, v_n, (v_day ->> 'date')::date, (v_day ->> 'cook_minutes')::integer)
    returning id into v_day_id;
    for v_dish in select x from jsonb_array_elements(v_day -> 'dishes') x loop
      insert into public.booking_day_dishes (
        booking_day_id, dish_id, dish_name, cook_minutes, ingredient_cost_cents, servings,
        allergens, quantity, eat_by_date
      ) values (
        v_day_id, (v_dish ->> 'dish_id')::uuid, v_dish ->> 'name',
        (v_dish ->> 'cook_minutes')::integer, (v_dish ->> 'ingredient_cost_cents')::integer,
        (v_dish ->> 'servings')::integer,
        coalesce(array(select jsonb_array_elements_text(v_dish -> 'allergens')), '{}'),
        (v_dish ->> 'quantity')::integer, (v_dish ->> 'eat_by_date')::date
      );
    end loop;
  end loop;

  insert into public.intake_forms (booking_id, allergies, dietary_notes, allergy_conflict_acknowledged)
  values (
    v_booking, p -> 'intake' ->> 'allergies', p -> 'intake' ->> 'dietary_notes',
    coalesce((p -> 'intake' ->> 'acknowledged')::boolean, false)
  );

  if v_trial is not null and jsonb_typeof(v_trial) = 'object' then
    -- The three partial unique indexes decide a race or a repeat; a violation (23505) rolls back
    -- the whole booking. The route logs the reason and answers 409 FREE_TRIAL_USED.
    insert into public.free_trial_claims (customer_id, booking_id, phone_hash, address_hash)
    values (v_customer, v_booking, v_trial ->> 'phone_hash', v_trial ->> 'address_hash');
  end if;

  -- No names, phone numbers, addresses or allergy text in a notification.
  insert into public.notifications (user_id, booking_id, type, title, body)
  values (
    v_chef, v_booking, 'booking_requested', 'New booking request',
    'A customer asked you to cook on ' || to_char(v_dates[1], 'YYYY-MM-DD')
      || case when cardinality(v_dates) > 1 then ' and ' || (cardinality(v_dates) - 1)::text
              || case when cardinality(v_dates) = 2 then ' more day.' else ' more days.' end
         else '.' end
  );

  return jsonb_build_object('result', 'ok', 'booking_id', v_booking);
end;
$$;

-- ---------------------------------------------------------------------------
-- answer_booking(booking, chef, 'accept' | 'decline', reason)
-- ---------------------------------------------------------------------------
-- Returns { result: 'ok', status } | 'not_found' | 'invalid_state' (with status) | 'expired' |
-- 'chef_not_approved'. The booking row is locked, so two answers, or an answer and an expiry, take
-- turns. 'expired' is returned, not raised, so that the status change is saved.
create or replace function public.answer_booking(
  p_booking uuid, p_chef uuid, p_action text, p_reason text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  c_status public.chef_status;
begin
  if p_action not in ('accept', 'decline') then
    raise exception 'action must be accept or decline' using errcode = '22023';
  end if;

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
    select status into c_status from public.chefs where profile_id = p_chef;
    if c_status is distinct from 'approved' then
      return jsonb_build_object('result', 'chef_not_approved');
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
-- expire_stale_bookings(user or null) -> { expired: n, release: [ { booking_id, status } ] }
-- ---------------------------------------------------------------------------
-- One conditional UPDATE (`where status = 'requested'`), so an accept and an expiry cannot both
-- win. `release` lists declined / expired bookings whose free-trial claim is still held: the route
-- calls applyFreeTrialEvent for each (A-16). That list also repairs a crash between the status
-- change and the claim release. Only these two statuses are listed: their outcome is always
-- "release"; cancellations decide release or consume in T-063 (D-26).
create or replace function public.expire_stale_bookings(p_user uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n integer;
  rel jsonb;
begin
  with ex as (
    update public.bookings b
       set status = 'expired'
     where b.status = 'requested'
       and coalesce(b.expires_at, b.created_at + interval '72 hours') <= now()
       and (p_user is null or p_user in (b.customer_id, b.chef_id))
    returning b.id, b.customer_id, b.chef_id
  ), notes as (
    insert into public.notifications (user_id, booking_id, type, title, body)
    select v.u, ex.id, 'booking_expired', 'A booking request expired',
           'The request was not answered in time, so the date is free again.'
      from ex cross join lateral (values (ex.customer_id), (ex.chef_id)) v (u)
    returning 1
  )
  select count(*) into n from ex;

  select coalesce(jsonb_agg(jsonb_build_object('booking_id', b.id, 'status', b.status::text)), '[]'::jsonb)
    into rel
    from public.bookings b
    join public.free_trial_claims f on f.booking_id = b.id
   where f.state = 'held'
     and b.status in ('declined', 'expired')
     and (p_user is null or p_user in (b.customer_id, b.chef_id));

  return jsonb_build_object('expired', n, 'release', rel);
end;
$$;

-- ---------------------------------------------------------------------------
-- chef_remove_availability(chef, dates) -> { result: 'ok' } | { result: 'booked', dates }
-- ---------------------------------------------------------------------------
-- D-22. The availability rows are locked FOR UPDATE first; a booking being created holds them
-- FOR SHARE, so this waits for it and the next statement (a new snapshot) sees the new booking.
-- Only `requested` and `accepted` bookings block; finished ones do not.
create or replace function public.chef_remove_availability(p_chef uuid, p_days date[]) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  booked date[];
begin
  perform 1 from (
    select a.day from public.availability a
     where a.chef_id = p_chef and a.day = any (p_days)
       for update
  ) s;

  select array_agg(distinct bd.visit_date order by bd.visit_date) into booked
    from public.booking_days bd
    join public.bookings b on b.id = bd.booking_id
   where bd.chef_id = p_chef
     and bd.visit_date = any (p_days)
     and b.status in ('requested', 'accepted');
  if booked is not null then
    return jsonb_build_object('result', 'booked', 'dates', to_jsonb(booked));
  end if;

  delete from public.availability where chef_id = p_chef and day = any (p_days);
  return jsonb_build_object('result', 'ok');
end;
$$;

-- ---------------------------------------------------------------------------
-- Public, dates-only helpers (A-19). They say that a chef is taken on a day, never by whom.
-- A `requested` booking past its expiry is ignored (lazy expiry has not run yet).
-- ---------------------------------------------------------------------------
create or replace function public.chef_booked_dates(p_chef uuid, p_from date, p_to date) returns setof date
language sql stable security definer
set search_path = ''
as $$
  select distinct bd.visit_date
    from public.booking_days bd
    join public.bookings b on b.id = bd.booking_id
   where bd.chef_id = p_chef
     and bd.is_active
     and bd.visit_date between p_from and p_to
     and not (b.status = 'requested'
              and coalesce(b.expires_at, b.created_at + interval '72 hours') <= now())
   order by 1;
$$;

create or replace function public.chefs_booked_on(p_day date) returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select distinct bd.chef_id
    from public.booking_days bd
    join public.bookings b on b.id = bd.booking_id
   where bd.visit_date = p_day
     and bd.is_active
     and not (b.status = 'requested'
              and coalesce(b.expires_at, b.created_at + interval '72 hours') <= now());
$$;

-- ---------------------------------------------------------------------------
-- record_free_trial_block(customer, reason, window minutes)
-- ---------------------------------------------------------------------------
-- Admin-only log (CLAUDE.md 6.9). The same customer and reason inside the window is counted in one
-- row; the advisory lock makes parallel attempts count instead of adding rows.
create or replace function public.record_free_trial_block(
  p_customer uuid, p_reason public.free_trial_block_reason, p_window_minutes integer
) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('free_trial_block:' || p_customer::text || p_reason::text, 0));
  update public.free_trial_blocks
     set attempts = attempts + 1, last_attempt_at = now()
   where id = (
     select f.id from public.free_trial_blocks f
      where f.customer_id = p_customer and f.reason = p_reason
        and f.last_attempt_at > now() - make_interval(mins => p_window_minutes)
      order by f.last_attempt_at desc limit 1
   );
  if not found then
    insert into public.free_trial_blocks (customer_id, reason) values (p_customer, p_reason);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: the writers are for the server (service role) only; the date lists are public.
-- ---------------------------------------------------------------------------
revoke execute on function public.create_booking(jsonb) from public, anon, authenticated;
revoke execute on function public.answer_booking(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.expire_stale_bookings(uuid) from public, anon, authenticated;
revoke execute on function public.chef_remove_availability(uuid, date[]) from public, anon, authenticated;
revoke execute on function public.record_free_trial_block(uuid, public.free_trial_block_reason, integer) from public, anon, authenticated;
grant execute on function public.record_free_trial_block(uuid, public.free_trial_block_reason, integer) to service_role;
grant execute on function public.create_booking(jsonb) to service_role;
grant execute on function public.answer_booking(uuid, uuid, text, text) to service_role;
grant execute on function public.expire_stale_bookings(uuid) to service_role;
grant execute on function public.chef_remove_availability(uuid, date[]) to service_role;

revoke execute on function public.chef_booked_dates(uuid, date, date) from public;
revoke execute on function public.chefs_booked_on(date) from public;
grant execute on function public.chef_booked_dates(uuid, date, date) to anon, authenticated, service_role;
grant execute on function public.chefs_booked_on(date) to anon, authenticated, service_role;
