-- T-063: booking changes. New migration; earlier migrations are not edited.
--
--   * bookings: completed_at, no_show_reported_at, no_show_day_number, pickup_missed_at.
--   * booking_days.cooked_at (D-26): the chef's "this day was cooked" marker. Cancelling after any
--     day was cooked consumes the free trial; the marker is read by the route and passed to
--     freeTrialEffect.
--   * pickup_proposals (D-29): a customer's proposed new pickup time for one day of a chef's-home
--     booking, and the chef's answer. At most one live (proposed or accepted) per day.
--   * booking_flags (D-22): an admin-only note on an accepted booking whose chef was rejected.
--   * change_booking(booking, actor, action, args): ONE function for every change the parties can
--     make (cancel, cooked, no-show, complete, pickup propose / respond / missed). The booking row
--     is locked FOR UPDATE first and the status is re-checked under that lock, so two changes (or
--     a change and an expiry or an auto-completion) take turns and only one wins.
--   * sweep_booking_changes(user): lazy auto-completion (D-33, like the D-19 expiry) and the list
--     of finished bookings whose free-trial claim is still held, so a crash between the status
--     change and the claim update is repaired by the next sweep.
--   * answer_booking: locks the chef row (FOR SHARE) BEFORE the booking row and re-checks
--     `approved` and, for a chef's-home booking, `chef_home_enabled` (T-042 reviewer finding 2).
--     Lock order is chef, then booking, everywhere (create_booking and admin_reject_chef too), so
--     a reject cannot deadlock with an accept.
--   * admin_reject_chef: the D-21 body plus the D-22 cascade: the chef's `requested` bookings are
--     cancelled and their `accepted` ones are flagged for the admin, in the same transaction.
--
-- All writers are SECURITY INVOKER with search_path = '' and service_role only. MOCK: nothing here
-- moves money; the free trial only waives chef labour in the prototype (Q-1).

alter table public.bookings
  add column completed_at timestamptz,
  add column no_show_reported_at timestamptz,
  add column no_show_day_number smallint check (no_show_day_number between 1 and 3),
  add column pickup_missed_at timestamptz;

alter table public.booking_days add column cooked_at timestamptz;

-- ---------------------------------------------------------------------------
-- Pickup proposals (D-29)
-- ---------------------------------------------------------------------------
create type public.pickup_status as enum ('proposed', 'accepted', 'declined', 'void');

create table public.pickup_proposals (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  booking_day_id uuid not null references public.booking_days (id) on delete cascade,
  proposed_by uuid not null references public.profiles (id),
  proposed_at timestamptz not null,
  status public.pickup_status not null default 'proposed',
  responded_at timestamptz,
  created_at timestamptz not null default now()
);
create index pickup_proposals_booking_idx on public.pickup_proposals (booking_id);
-- One live proposal per day: a second propose while one is open or agreed cannot be written.
create unique index pickup_one_live_per_day on public.pickup_proposals (booking_day_id)
  where status in ('proposed', 'accepted');

alter table public.pickup_proposals enable row level security;
grant select on public.pickup_proposals to authenticated;
create policy pickup_proposals_select_party on public.pickup_proposals
  for select to authenticated using (public.is_booking_party(booking_id));
create policy pickup_proposals_select_admin on public.pickup_proposals
  for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Admin flags (D-22). Admin only: the parties do not read this table.
-- ---------------------------------------------------------------------------
create table public.booking_flags (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  reason text not null check (reason in ('chef_rejected')),
  created_at timestamptz not null default now()
);
alter table public.booking_flags enable row level security;
grant select on public.booking_flags to authenticated;
create policy booking_flags_select_admin on public.booking_flags
  for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Time helpers (Toronto clock, daylight saving included)
-- ---------------------------------------------------------------------------
-- D-20 / A-22: day 1 starts at 00:00 Toronto; the cutoff is inclusive. Mirrors
-- cancellationTiming() in src/lib/domain/cancellation.ts (a database test compares the two).
create or replace function public.booking_cancellation_timing(
  p_first_day date, p_at timestamptz, p_free_hours integer
) returns text
language sql stable
set search_path = ''
as $$
  select case
    when p_at <= (p_first_day::timestamp at time zone 'America/Toronto') - make_interval(hours => p_free_hours)
    then 'on_time' else 'late' end;
$$;

-- D-29: the last moment (exclusive) a pickup can be arranged: the end of the earliest eat-by date.
create or replace function public.booking_pickup_end(p_eat_by date) returns timestamptz
language sql stable
set search_path = ''
as $$
  select ((p_eat_by + 1)::timestamp at time zone 'America/Toronto');
$$;

-- D-33 (ASSUMPTION): 24 hours after the last day ends, i.e. one calendar day after the end of the
-- last visit date. A chef's-home booking never completes by itself before the pickup window of
-- every day has closed (D-29), so "pickup missed" stays possible until then.
create or replace function public.booking_auto_complete_at(p_booking uuid) returns timestamptz
language sql stable
set search_path = ''
as $$
  select greatest(
    ((select max(d.visit_date) from public.booking_days d where d.booking_id = b.id) + 2)::timestamp
      at time zone 'America/Toronto',
    case when b.location_type = 'chef_home' then (
      select max(public.booking_pickup_end(e.eat_by))
        from (select min(x.eat_by_date) as eat_by
                from public.booking_days dd
                join public.booking_day_dishes x on x.booking_day_id = dd.id
               where dd.booking_id = b.id
               group by dd.id) e
    ) end)
  from public.bookings b
  where b.id = p_booking;
$$;

-- ---------------------------------------------------------------------------
-- change_booking(booking, actor, action, args)
-- ---------------------------------------------------------------------------
-- action: cancel { reason, free_hours } | cooked { day_number } | no_show | complete |
--         pickup_propose { day_number, proposed_at } | pickup_respond { day_number, accept } |
--         pickup_missed
-- Returns { result: 'ok', status, cooked, ... } | { result: 'not_found' } (also for the wrong side)
-- | { result: 'day_not_found' } | { result: 'invalid_state', reason } |
-- { result: 'out_of_range', reason, latest }. Nothing is written for a refusal.
create or replace function public.change_booking(
  p_booking uuid, p_actor uuid, p_action text, p_args jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  d public.booking_days%rowtype;
  pr public.pickup_proposals%rowtype;
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_is_customer boolean;
  v_is_chef boolean;
  v_other uuid;
  v_cooked boolean;
  v_first date;
  v_timing text;
  v_status public.booking_status;
  v_eat date;
  v_end timestamptz;
  v_at timestamptz;
  v_day smallint;
  v_accept boolean;
begin
  if p_action not in ('cancel', 'cooked', 'no_show', 'complete', 'pickup_propose', 'pickup_respond', 'pickup_missed') then
    raise exception 'unknown action' using errcode = '22023';
  end if;

  select * into b from public.bookings where id = p_booking for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  v_is_customer := p_actor = b.customer_id;
  v_is_chef := p_actor = b.chef_id;
  if not (v_is_customer or v_is_chef) then return jsonb_build_object('result', 'not_found'); end if;
  -- Second line behind the route's role check: the wrong side sees the same "not found".
  if (p_action in ('cooked', 'complete', 'pickup_respond', 'pickup_missed') and not v_is_chef)
     or (p_action = 'pickup_propose' and not v_is_customer) then
    return jsonb_build_object('result', 'not_found');
  end if;
  v_other := case when v_is_customer then b.chef_id else b.customer_id end;

  -- A request nobody answered in time is expired, not open (the lazy sweep marks it).
  if b.status = 'requested' and coalesce(b.expires_at, b.created_at + interval '72 hours') <= now() then
    return jsonb_build_object('result', 'invalid_state', 'reason', 'expired');
  end if;

  v_cooked := exists (select 1 from public.booking_days where booking_id = b.id and cooked_at is not null);

  -- -------------------------------------------------------------------------
  if p_action = 'cancel' then
    if b.status not in ('requested', 'accepted') then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'wrong_status');
    end if;
    -- A chef answers a request with decline (which needs a reason, D-34), not with cancel.
    if v_is_chef and b.status <> 'accepted' then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'chef_use_decline');
    end if;
    if b.status = 'accepted' and not exists (
      select 1 from public.booking_days
       where booking_id = b.id and is_active and cooked_at is null and visit_date >= v_today
    ) then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'nothing_left');
    end if;
    select min(visit_date) into v_first from public.booking_days where booking_id = b.id;
    v_timing := public.booking_cancellation_timing(v_first, now(), (p_args ->> 'free_hours')::integer);
    -- The trigger bookings_sync_days frees every date of the booking.
    update public.bookings
       set status = 'cancelled',
           cancelled_by = case when v_is_customer then 'customer' else 'chef' end::public.cancelled_by,
           cancelled_at = now(),
           cancellation_timing = v_timing::public.cancellation_timing,
           cancel_reason = p_args ->> 'reason'
     where id = b.id;
    update public.pickup_proposals set status = 'void', responded_at = coalesce(responded_at, now())
     where booking_id = b.id and status in ('proposed', 'accepted');
    insert into public.notifications (user_id, booking_id, type, title, body)
    values (v_other, b.id, 'booking_cancelled', 'A booking was cancelled',
            case when v_is_customer then 'The customer cancelled this booking.'
                 else 'The chef cancelled this booking.' end
            || case when v_timing = 'late' then ' It was cancelled less than 48 hours before the first day.' else '' end);
    return jsonb_build_object('result', 'ok', 'status', 'cancelled', 'cooked', v_cooked, 'timing', v_timing);
  end if;

  -- Every other action works on an accepted booking only.
  if b.status <> 'accepted' then
    return jsonb_build_object('result', 'invalid_state', 'reason', 'wrong_status');
  end if;

  -- -------------------------------------------------------------------------
  if p_action = 'cooked' then
    select * into d from public.booking_days
     where booking_id = b.id and day_number = (p_args ->> 'day_number')::smallint for update;
    if not found then return jsonb_build_object('result', 'day_not_found'); end if;
    if not d.is_active then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'wrong_status');
    end if;
    if d.visit_date > v_today then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'too_early');
    end if;
    -- Marking twice keeps the first time (idempotent).
    update public.booking_days set cooked_at = now() where id = d.id and cooked_at is null;
    return jsonb_build_object('result', 'ok', 'status', 'accepted', 'cooked', true);
  end if;

  -- -------------------------------------------------------------------------
  if p_action = 'no_show' then
    -- The earliest visit that is due (its date has come) and was not cooked.
    select * into d from public.booking_days
     where booking_id = b.id and is_active and cooked_at is null and visit_date <= v_today
     order by day_number limit 1;
    if not found then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'no_visit_due');
    end if;
    v_status := case when v_is_chef then 'no_show_customer' else 'no_show_chef' end;
    update public.bookings
       set status = v_status, no_show_reported_at = now(), no_show_day_number = d.day_number
     where id = b.id;
    -- The booking ends here: visits that have not happened (and were not cooked) free their dates.
    update public.booking_days set is_active = false
     where booking_id = b.id and cooked_at is null and visit_date > v_today;
    update public.pickup_proposals set status = 'void', responded_at = coalesce(responded_at, now())
     where booking_id = b.id and status in ('proposed', 'accepted');
    insert into public.notifications (user_id, booking_id, type, title, body)
    values (v_other, b.id, 'booking_no_show', 'A no-show was reported',
            case when v_is_chef then 'The chef reported that the customer was not there for a visit.'
                 else 'The customer reported that the chef did not come for a visit.' end);
    return jsonb_build_object('result', 'ok', 'status', v_status::text, 'cooked', v_cooked);
  end if;

  -- -------------------------------------------------------------------------
  if p_action = 'complete' then
    if exists (select 1 from public.booking_days where booking_id = b.id and is_active and cooked_at is null) then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'days_not_cooked');
    end if;
    -- D-33: a reported problem stops completion until the admin has dealt with it.
    if exists (select 1 from public.reports r where r.booking_id = b.id and r.status in ('open', 'reviewing')) then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'problem_reported');
    end if;
    update public.bookings set status = 'completed', completed_at = now() where id = b.id;
    update public.pickup_proposals set status = 'void', responded_at = coalesce(responded_at, now())
     where booking_id = b.id and status = 'proposed';
    insert into public.notifications (user_id, booking_id, type, title, body)
    values (v_other, b.id, 'booking_completed', 'A booking is complete',
            'The chef marked the visits as done. You can now leave a review.');
    return jsonb_build_object('result', 'ok', 'status', 'completed', 'cooked', v_cooked);
  end if;

  -- -------------------------------------------------------------------------
  -- Pickup (D-29): chef's-home bookings only.
  if b.location_type <> 'chef_home' then
    return jsonb_build_object('result', 'invalid_state', 'reason', 'not_chef_home');
  end if;

  if p_action = 'pickup_missed' then
    select dd.* into d from public.booking_days dd
     where dd.booking_id = b.id and dd.is_active and dd.cooked_at is not null
       and exists (select 1 from public.booking_day_dishes x where x.booking_day_id = dd.id)
       and public.booking_pickup_end(
             (select min(x.eat_by_date) from public.booking_day_dishes x where x.booking_day_id = dd.id)
           ) <= now()
     order by dd.day_number limit 1;
    if not found then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'pickup_window_open');
    end if;
    update public.bookings
       set status = 'no_show_customer', no_show_reported_at = now(), no_show_day_number = d.day_number,
           pickup_missed_at = now()
     where id = b.id;
    -- Days not yet cooked are cancelled (their dates are free again).
    update public.booking_days set is_active = false
     where booking_id = b.id and cooked_at is null and visit_date > v_today;
    update public.pickup_proposals set status = 'void', responded_at = coalesce(responded_at, now())
     where booking_id = b.id and status in ('proposed', 'accepted');
    insert into public.notifications (user_id, booking_id, type, title, body)
    values (b.customer_id, b.id, 'booking_pickup_missed', 'Pickup missed',
            'The meals were not picked up in time, so the chef closed this booking as a customer no-show.');
    return jsonb_build_object('result', 'ok', 'status', 'no_show_customer', 'cooked', v_cooked);
  end if;

  -- pickup_propose and pickup_respond work on one day.
  v_day := (p_args ->> 'day_number')::smallint;
  select * into d from public.booking_days where booking_id = b.id and day_number = v_day for update;
  if not found then return jsonb_build_object('result', 'day_not_found'); end if;
  if not d.is_active then
    return jsonb_build_object('result', 'invalid_state', 'reason', 'wrong_status');
  end if;

  if p_action = 'pickup_propose' then
    if d.cooked_at is null then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'day_not_cooked');
    end if;
    select min(x.eat_by_date) into v_eat from public.booking_day_dishes x where x.booking_day_id = d.id;
    if v_eat is null then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'day_not_cooked');
    end if;
    v_end := public.booking_pickup_end(v_eat);
    if now() >= v_end then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'deadline_passed');
    end if;
    select * into pr from public.pickup_proposals
     where booking_day_id = d.id and status in ('proposed', 'accepted');
    if found then
      return jsonb_build_object('result', 'invalid_state',
        'reason', case when pr.status = 'proposed' then 'proposal_open' else 'pickup_agreed' end);
    end if;
    v_at := (p_args ->> 'proposed_at')::timestamptz;
    if v_at <= now() then
      return jsonb_build_object('result', 'out_of_range', 'reason', 'not_future', 'latest', v_end);
    end if;
    -- (No lower bound besides "in the future": a day can only be cooked once its date has come,
    -- and propose needs a cooked day, so any future time is after the cooking day.)
    if v_at >= v_end then
      return jsonb_build_object('result', 'out_of_range', 'reason', 'after_deadline', 'latest', v_end);
    end if;
    -- The partial unique index pickup_one_live_per_day is the backstop for a parallel proposal.
    insert into public.pickup_proposals (booking_id, booking_day_id, proposed_by, proposed_at)
    values (b.id, d.id, p_actor, v_at);
    insert into public.notifications (user_id, booking_id, type, title, body)
    values (b.chef_id, b.id, 'pickup_proposed', 'A new pickup time was proposed',
            'The customer proposed a new time to pick up the meals. Please accept or decline it.');
    return jsonb_build_object('result', 'ok', 'status', 'accepted', 'cooked', v_cooked);
  end if;

  -- pickup_respond
  v_accept := (p_args ->> 'accept')::boolean;
  select * into pr from public.pickup_proposals
   where booking_day_id = d.id and status = 'proposed' for update;
  if not found then
    return jsonb_build_object('result', 'invalid_state', 'reason', 'no_open_proposal');
  end if;
  if v_accept and pr.proposed_at <= now() then
    return jsonb_build_object('result', 'invalid_state', 'reason', 'proposal_past');
  end if;
  update public.pickup_proposals
     set status = case when v_accept then 'accepted' else 'declined' end::public.pickup_status,
         responded_at = now()
   where id = pr.id and status = 'proposed';
  insert into public.notifications (user_id, booking_id, type, title, body)
  values (b.customer_id, b.id,
          case when v_accept then 'pickup_accepted' else 'pickup_declined' end,
          case when v_accept then 'Your pickup time was accepted' else 'Your pickup time was declined' end,
          case when v_accept then 'The chef accepted the new pickup time.'
               else 'The chef declined that pickup time. You can propose another one before the meals expire.' end);
  return jsonb_build_object('result', 'ok', 'status', 'accepted', 'cooked', v_cooked);
end;
$$;

-- ---------------------------------------------------------------------------
-- sweep_booking_changes(user or null)
-- ---------------------------------------------------------------------------
-- Lazy D-33 completion: an `accepted` booking becomes `completed` once booking_auto_complete_at has
-- passed, unless a problem report is open. One conditional UPDATE (`where status = 'accepted'`), so
-- a parallel no-show, cancellation or chef completion and this cannot both win. Returns the
-- finished bookings whose free-trial claim is still `held` (the route applies the claim outcome;
-- this also repairs a crash between the status change and the claim update).
create or replace function public.sweep_booking_changes(p_user uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n integer;
  rel jsonb;
begin
  with done as (
    update public.bookings b
       set status = 'completed', completed_at = now()
     where b.status = 'accepted'
       and (p_user is null or p_user in (b.customer_id, b.chef_id))
       and public.booking_auto_complete_at(b.id) <= now()
       and not exists (select 1 from public.reports r where r.booking_id = b.id and r.status in ('open', 'reviewing'))
    returning b.id, b.customer_id, b.chef_id
  ), notes as (
    insert into public.notifications (user_id, booking_id, type, title, body)
    select v.u, done.id, 'booking_completed', 'A booking is complete',
           'The visits are over, so this booking was completed automatically.'
      from done cross join lateral (values (done.customer_id), (done.chef_id)) v (u)
    returning 1
  )
  select count(*) into n from done;

  select coalesce(jsonb_agg(jsonb_build_object(
           'booking_id', b.id, 'status', b.status::text,
           'cooked', exists (select 1 from public.booking_days d where d.booking_id = b.id and d.cooked_at is not null))),
         '[]'::jsonb)
    into rel
    from public.bookings b
    join public.free_trial_claims f on f.booking_id = b.id
   where f.state = 'held'
     and b.status in ('declined', 'expired', 'cancelled', 'completed', 'no_show_customer', 'no_show_chef')
     and (p_user is null or p_user in (b.customer_id, b.chef_id));

  return jsonb_build_object('completed', n, 'release', rel);
end;
$$;

-- ---------------------------------------------------------------------------
-- answer_booking: chef row locked first, then the booking (finding 2 of the T-042 review)
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
-- admin_reject_chef: the D-21 body plus the D-22 cascade (marked below)
-- ---------------------------------------------------------------------------
create or replace function public.admin_reject_chef(p_chef_id uuid, p_reason text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c public.chefs%rowtype;
  v_cancelled uuid[];
  v_flagged uuid[];
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

  -- D-22 cascade begin
  -- Open requests are cancelled (by the system: cancelled_by stays null). The sweep or the route
  -- releases their free-trial claims afterwards.
  with x as (
    update public.bookings
       set status = 'cancelled', cancelled_at = now(),
           cancel_reason = 'The chef is no longer available on CookNeighbour.'
     where chef_id = p_chef_id and status = 'requested'
    returning id, customer_id
  ), n as (
    insert into public.notifications (user_id, booking_id, type, title, body)
    select customer_id, id, 'booking_cancelled', 'A booking was cancelled',
           'The chef is no longer available on CookNeighbour, so your request was cancelled.'
      from x
    returning 1
  )
  select coalesce(array_agg(id), '{}') into v_cancelled from x;

  -- Accepted bookings stay as they are and are flagged for the admin.
  with y as (
    insert into public.booking_flags (booking_id, reason)
    select b.id, 'chef_rejected' from public.bookings b
     where b.chef_id = p_chef_id and b.status = 'accepted'
    on conflict (booking_id) do nothing
    returning booking_id
  ), n as (
    insert into public.notifications (user_id, booking_id, type, title, body)
    select b.customer_id, b.id, 'booking_flagged', 'Your booking needs a check',
           'The chef''s account changed. An admin will look at this booking.'
      from public.bookings b join y on y.booking_id = b.id
    returning 1
  )
  select coalesce(array_agg(booking_id), '{}') into v_flagged from y;
  -- D-22 cascade end

  return jsonb_build_object('result', 'ok', 'cancelled', to_jsonb(v_cancelled), 'flagged', to_jsonb(v_flagged));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: writers and helpers are for the server (service role) only.
-- ---------------------------------------------------------------------------
revoke execute on function public.change_booking(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.sweep_booking_changes(uuid) from public, anon, authenticated;
revoke execute on function public.answer_booking(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.admin_reject_chef(uuid, text) from public, anon, authenticated;
revoke execute on function public.booking_cancellation_timing(date, timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.booking_pickup_end(date) from public, anon, authenticated;
revoke execute on function public.booking_auto_complete_at(uuid) from public, anon, authenticated;
grant execute on function public.change_booking(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.sweep_booking_changes(uuid) to service_role;
grant execute on function public.answer_booking(uuid, uuid, text, text) to service_role;
grant execute on function public.admin_reject_chef(uuid, text) to service_role;
grant execute on function public.booking_cancellation_timing(date, timestamptz, integer) to service_role;
grant execute on function public.booking_pickup_end(date) to service_role;
grant execute on function public.booking_auto_complete_at(uuid) to service_role;
