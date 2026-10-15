-- T-064: an open admin flag freezes the booking (D-53); a no_day_cooked flag does not (D-57).
-- New migration; earlier migrations are not edited.
--
--   * booking_flags.resolved_at: a flag is OPEN while resolved_at is null. Completing a booking
--     resolves its open `no_day_cooked` flag (D-57), by the chef's "visit done" or by the sweep.
--     (The admin's own decision, T-048, will also set resolved_at.)
--   * booking_is_frozen(booking): true while the booking has an open flag whose reason is not
--     `no_day_cooked` (today: `chef_rejected`, D-22; a future reason freezes by default).
--   * D-53, frozen means: change_booking refuses every action, for both parties, with
--     invalid_state / reason `frozen` (completion by the chef, cooked, no-show, pickup, cancel);
--     the sweep never auto-completes a frozen booking; submit_receipt (chef) and the receipt
--     storage policy refuse it. Customer receipt answers, chat and reads are unchanged.
--     INTERIM (question for Jimmy): the customer cannot cancel a frozen booking either.
--   * get_booking_frozen(booking): the only read of the flag a browser has. Parties only; it says
--     nothing about the flag's reason or about admin notes.
--   * admin_reject_chef: if the booking already has an open `no_day_cooked` flag, it is upgraded to
--     `chef_rejected` (so the booking freezes) and the customer is told. It locks the accepted
--     bookings it flags in id order (FOR UPDATE), so a parallel completion either finishes first
--     (not flagged) or waits and sees the flag. LOW-2 (T-066 review): flag inserts are in booking
--     id order here and in the sweep, so two of them cannot deadlock.
--   * sweep_booking_changes: the automatic completion now locks each due booking, then re-reads the
--     flag in a new statement (a plain single UPDATE would not see a flag committed while it waited).
--   * T-074 review L1: answer_booking treats a blank (spaces only) kitchen address part as missing,
--     like the admin functions do (`coalesce(btrim(x), '') = ''`).
--   * T-074 review N1: the comment on set_chef_kitchen_address says what a JSON null does.
--
-- Lock order is unchanged: chefs, chef_private, then bookings (by id when several).
-- MOCK: nothing here moves money; there is no refund or rebooking flow.

alter table public.booking_flags add column resolved_at timestamptz;
comment on column public.booking_flags.resolved_at is
  'null = open. D-53: an open flag other than no_day_cooked freezes the booking. D-57: completing the booking resolves a no_day_cooked flag.';

create or replace function public.booking_is_frozen(p_booking uuid) returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from public.booking_flags f
     where f.booking_id = p_booking and f.resolved_at is null and f.reason <> 'no_day_cooked');
$$;
revoke execute on function public.booking_is_frozen(uuid) from public, anon, authenticated;
grant execute on function public.booking_is_frozen(uuid) to service_role;

-- What a browser may know: "this booking is frozen" (neutral). Parties only.
create or replace function public.get_booking_frozen(p_booking uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.booking_is_frozen(b.id)
    from public.bookings b
   where b.id = p_booking and (select auth.uid()) in (b.customer_id, b.chef_id);
$$;
revoke execute on function public.get_booking_frozen(uuid) from public, anon;
grant execute on function public.get_booking_frozen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- change_booking: the 20261014150000 body plus D-53 and D-57 (both marked)
-- ---------------------------------------------------------------------------
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

  -- T-064 / D-53: an open admin flag freezes the booking until an admin decides.
  if public.booking_is_frozen(b.id) then
    return jsonb_build_object('result', 'invalid_state', 'reason', 'frozen');
  end if;

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
    -- T-064 / D-57: completing the booking resolves its no_day_cooked flag.
    update public.booking_flags set resolved_at = now()
     where booking_id = b.id and reason = 'no_day_cooked' and resolved_at is null;
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
-- The 20261014150000 body with D-53 / D-57 and LOW-2:
--   * automatic completion (D-33, D-36) visits each due booking in id order, locks it FOR UPDATE,
--     and then checks status, frozen flag, cooked day and open report in NEW statements, so a flag
--     or report committed while it waited is seen. A frozen booking is never auto-completed.
--   * completing resolves the booking's open no_day_cooked flag (D-57).
--   * the no_day_cooked flags are inserted in booking id order (LOW-2).
-- Returns the finished bookings whose free-trial claim is still `held` (the route applies the claim
-- outcome and repairs a crash in between).
create or replace function public.sweep_booking_changes(p_user uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n integer := 0;
  nf integer;
  rel jsonb;
  due record;
  bk public.bookings%rowtype;
begin
  for due in
    select b.id
      from public.bookings b
     where b.status = 'accepted'
       and (p_user is null or p_user in (b.customer_id, b.chef_id))
       and public.booking_auto_complete_at(b.id) <= now()
     order by b.id
  loop
    select * into bk from public.bookings where id = due.id for update;
    if not found or bk.status <> 'accepted' then continue; end if;
    -- D-53: an open admin flag freezes the booking.
    if public.booking_is_frozen(bk.id) then continue; end if;
    if not exists (select 1 from public.booking_days d where d.booking_id = bk.id and d.cooked_at is not null) then
      continue; -- D-36: flagged below instead
    end if;
    if exists (select 1 from public.reports r where r.booking_id = bk.id and r.status in ('open', 'reviewing')) then
      continue;
    end if;
    update public.bookings set status = 'completed', completed_at = now() where id = bk.id;
    update public.pickup_proposals set status = 'void', responded_at = coalesce(responded_at, now())
     where booking_id = bk.id and status in ('proposed', 'accepted');
    -- D-57: completing the booking resolves its no_day_cooked flag.
    update public.booking_flags set resolved_at = now()
     where booking_id = bk.id and reason = 'no_day_cooked' and resolved_at is null;
    insert into public.notifications (user_id, booking_id, type, title, body)
    select v.u, bk.id, 'booking_completed', 'A booking is complete',
           'The visits are over, so this booking was completed automatically.'
      from (values (bk.customer_id), (bk.chef_id)) v (u);
    n := n + 1;
  end loop;

  -- D-36: nothing was cooked, so the booking is not completed. One flag per booking, in id order.
  with fl as (
    insert into public.booking_flags (booking_id, reason)
    select b.id, 'no_day_cooked'
      from public.bookings b
     where b.status = 'accepted'
       and (p_user is null or p_user in (b.customer_id, b.chef_id))
       and public.booking_auto_complete_at(b.id) <= now()
       and not exists (select 1 from public.booking_days d where d.booking_id = b.id and d.cooked_at is not null)
       and not exists (select 1 from public.reports r where r.booking_id = b.id and r.status in ('open', 'reviewing'))
     order by b.id
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

-- ---------------------------------------------------------------------------
-- admin_reject_chef: the 20261014150000 body; only the flag step changes (marked)
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
  -- T-064: the bookings are locked and flagged in id order (LOW-2: no deadlock between two flaggers;
  -- a parallel completion finishes first or sees the flag). An open no_day_cooked flag is upgraded
  -- to chef_rejected so that the booking freezes (D-53); the customer is told as for a new flag.
  with y as (
    insert into public.booking_flags (booking_id, reason)
    select s.id, 'chef_rejected'
      from (select id from public.bookings
             where chef_id = p_chef_id and status = 'accepted'
             order by id for update) s
    on conflict (booking_id) do update set reason = 'chef_rejected'
      where public.booking_flags.reason = 'no_day_cooked' and public.booking_flags.resolved_at is null
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
-- answer_booking: the 20261016100000 body; only the D-59 test changes (marked)
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
      -- T-064 (T-074 review L1): a blank part counts as missing, like the admin functions.
      if not found or coalesce(btrim(k.kitchen_address_line), '') = ''
         or coalesce(btrim(k.kitchen_city), '') = ''
         or coalesce(btrim(k.kitchen_postal_code), '') = '' then
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
-- Receipts (T-044): a chef cannot register or upload a receipt on a frozen booking (D-53)
-- ---------------------------------------------------------------------------
create or replace function public.submit_receipt(
  p_booking uuid, p_chef uuid, p_path text, p_amount integer, p_mismatch boolean
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  b public.bookings;
  v_current public.receipts;
  v_id uuid;
begin
  select * into b from public.bookings where id = p_booking and chef_id = p_chef for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if b.grocery_option <> 'chef_shops' then
    return jsonb_build_object('result', 'invalid_state', 'reason', 'not_chef_shops');
  end if;
  if b.status not in ('accepted', 'completed') then
    return jsonb_build_object('result', 'invalid_state', 'reason', 'wrong_status');
  end if;
  -- T-064 / D-53: no chef action on a frozen booking.
  if public.booking_is_frozen(b.id) then
    return jsonb_build_object('result', 'invalid_state', 'reason', 'frozen');
  end if;
  select * into v_current from public.receipts
    where booking_id = b.id and superseded_at is null;
  if found then
    if v_current.customer_disputed_at is null then
      return jsonb_build_object('result', 'invalid_state',
        'reason', case when v_current.customer_confirmed_at is null then 'receipt_waiting' else 'receipt_confirmed' end);
    end if;
  end if;
  begin
    -- inside the block: if the new path was used before, the old receipt is NOT superseded
    if v_current.id is not null then
      update public.receipts set superseded_at = now() where id = v_current.id;
    end if;
    insert into public.receipts (booking_id, uploaded_by, file_path, amount_cents, currency, mismatch_flagged)
    values (b.id, p_chef, p_path, p_amount, b.currency, p_mismatch)
    returning id into v_id;
  exception when unique_violation then
    -- the same object path was registered before: a new name is needed per upload
    return jsonb_build_object('result', 'invalid_state', 'reason', 'path_used');
  end;
  insert into public.notifications (user_id, booking_id, type, title, body)
  values (b.customer_id, b.id, 'receipt_uploaded', 'A grocery receipt is waiting for you',
          case when p_mismatch then 'The chef uploaded a receipt that differs from the estimate. Please check it.'
               else 'The chef uploaded a grocery receipt. Please confirm it.' end);
  return jsonb_build_object('result', 'ok', 'receipt_id', v_id);
end;
$$;

create or replace function public.booking_accepts_receipts(p_booking uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking and b.chef_id = (select auth.uid())
      and b.grocery_option = 'chef_shops'
      and b.status in ('accepted', 'completed')
      and not public.booking_is_frozen(b.id)
  );
$$;

-- T-074 review N1: the header comment of 20261016100000 says "JSON null clears a nullable column".
-- That is true for the scalar columns only; for cuisines, languages and location_options a JSON
-- null gives an EMPTY array (jsonb_array_elements_text(null) returns no rows), never SQL null.
-- The route never sends null for these.
comment on function public.set_chef_kitchen_address(uuid, timestamptz, text, text, text, public.mock_check_status, timestamptz, timestamptz, jsonb) is
  'p_chef_columns: a key that is present is written; JSON null clears a scalar column (bio, photo_path, service_postal_prefix, service_radius_km) but gives an EMPTY array for cuisines, languages and location_options; a missing key leaves the column alone; any other key raises. chef_home_enabled is always switched off.';

revoke execute on function public.change_booking(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.sweep_booking_changes(uuid) from public, anon, authenticated;
revoke execute on function public.admin_reject_chef(uuid, text) from public, anon, authenticated;
revoke execute on function public.answer_booking(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.submit_receipt(uuid, uuid, text, integer, boolean) from public, anon, authenticated;
revoke execute on function public.booking_accepts_receipts(uuid) from public, anon, authenticated;
grant execute on function public.change_booking(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.sweep_booking_changes(uuid) to service_role;
grant execute on function public.admin_reject_chef(uuid, text) to service_role;
grant execute on function public.answer_booking(uuid, uuid, text, text) to service_role;
grant execute on function public.submit_receipt(uuid, uuid, text, integer, boolean) to service_role;
grant execute on function public.booking_accepts_receipts(uuid) to authenticated;
