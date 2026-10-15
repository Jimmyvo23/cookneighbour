-- T-066: fixes found in the T-063 review. New migration; earlier migrations are not edited.
--
--   * D-36 (M1): the automatic completion (D-33) needs at least one day that was cooked. A booking
--     whose last day is over but where no day was cooked is NOT completed (the free trial is not
--     used, reviews do not open); it gets one `booking_flags` row (reason `no_day_cooked`) so an
--     admin sees it, and both parties get one neutral notification. It stays `accepted`.
--   * L1: admin_reject_chef (D-22 cascade) leaves a `requested` booking that already ran out of
--     time alone, so the expiry sweep marks it `expired` instead of it being `cancelled`.
--   * L2: completion (by the chef or automatic) voids accepted pickup proposals too, not only open
--     ones (cancel, no-show and pickup-missed already voided both).
--   * D-37 needs no SQL: the free-trial outcome of a chef no-show comes from freeTrialEffect and the
--     `cooked` flag these functions already return.
-- change_booking and admin_reject_chef are copied from 20261011200000 with only the changes above.
-- Lock order is unchanged (chef, then booking). Grants are re-applied at the end.

alter table public.booking_flags drop constraint booking_flags_reason_check;
alter table public.booking_flags
  add constraint booking_flags_reason_check check (reason in ('chef_rejected', 'no_day_cooked'));

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
     where booking_id = b.id and status in ('proposed', 'accepted');
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
-- Lazy D-33 completion, now with D-36: an `accepted` booking whose completion time has passed
--   * becomes `completed` when at least one day was cooked (and no problem report is open);
--   * is flagged for the admin (once) when no day was cooked, and stays `accepted`.
-- Both are single statements guarded by `status = 'accepted'` / the flag's primary key, so a
-- parallel change and this sweep cannot both win. Returns the finished bookings whose free-trial
-- claim is still `held` (the route applies the claim outcome and repairs a crash in between).
create or replace function public.sweep_booking_changes(p_user uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n integer;
  nf integer;
  rel jsonb;
begin
  with done as (
    update public.bookings b
       set status = 'completed', completed_at = now()
     where b.status = 'accepted'
       and (p_user is null or p_user in (b.customer_id, b.chef_id))
       and public.booking_auto_complete_at(b.id) <= now()
       and exists (select 1 from public.booking_days d where d.booking_id = b.id and d.cooked_at is not null)
       and not exists (select 1 from public.reports r where r.booking_id = b.id and r.status in ('open', 'reviewing'))
    returning b.id, b.customer_id, b.chef_id
  ), voided as (
    update public.pickup_proposals p
       set status = 'void', responded_at = coalesce(p.responded_at, now())
      from done
     where p.booking_id = done.id and p.status in ('proposed', 'accepted')
    returning 1
  ), notes as (
    insert into public.notifications (user_id, booking_id, type, title, body)
    select v.u, done.id, 'booking_completed', 'A booking is complete',
           'The visits are over, so this booking was completed automatically.'
      from done cross join lateral (values (done.customer_id), (done.chef_id)) v (u)
    returning 1
  )
  select count(*) into n from done;

  -- D-36: nothing was cooked, so the booking is not completed. One flag per booking.
  with fl as (
    insert into public.booking_flags (booking_id, reason)
    select b.id, 'no_day_cooked'
      from public.bookings b
     where b.status = 'accepted'
       and (p_user is null or p_user in (b.customer_id, b.chef_id))
       and public.booking_auto_complete_at(b.id) <= now()
       and not exists (select 1 from public.booking_days d where d.booking_id = b.id and d.cooked_at is not null)
       and not exists (select 1 from public.reports r where r.booking_id = b.id and r.status in ('open', 'reviewing'))
    on conflict (booking_id) do nothing
    returning booking_id
  ), notes as (
    insert into public.notifications (user_id, booking_id, type, title, body)
    select v.u, fl.booking_id, 'booking_flagged', 'A booking needs a check',
           'The visits are over but no visit was marked as cooked. An admin will look at this booking.'
      from fl
      join public.bookings b on b.id = fl.booking_id
      cross join lateral (values (b.customer_id), (b.chef_id)) v (u)
    returning 1
  )
  select count(*) into nf from fl;

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

  return jsonb_build_object('completed', n, 'flagged', nf, 'release', rel);
end;
$$;

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
       -- L1: a request that already ran out of time is `expired` (the sweep marks it), not cancelled.
       and coalesce(expires_at, created_at + interval '72 hours') > now()
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

revoke execute on function public.change_booking(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.sweep_booking_changes(uuid) from public, anon, authenticated;
revoke execute on function public.admin_reject_chef(uuid, text) from public, anon, authenticated;
grant execute on function public.change_booking(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.sweep_booking_changes(uuid) to service_role;
grant execute on function public.admin_reject_chef(uuid, text) to service_role;
