-- T-048 fix round (WO-5c, Jimmy's decisions of 2026-10-20). New migration; earlier ones are not edited.
--
--   * F-2: anon reads only id, author_role, rating, comment, created_at from reviews (column grant).
--     author_id, booking_id, subject_id and the full-name snapshot author_display_name are no longer
--     readable by anon through PostgREST. GET /api/chefs/:id/reviews reads with the service role
--     after the visibility check and cuts the first name on the server. (authenticated keeps its
--     table grant: a party needs the columns, and the row policies still decide which rows.)
--   * F-1 (replaces A-30): an open or reviewing report NEVER blocks a completion path: the chef's
--     "visit done", the customer's last pickup confirmation, the automatic completion in the sweep
--     and the no_day_cooked flag. The problem_reported refusal is gone.
--   * admin_decide_booking: a report may also be resolved with a final status on a `completed`
--     booking (cancelled, chef no-show, customer no-show; `completed` means leave it). On an
--     `accepted` booking a final status is still required. Any other status closes with a note
--     only (status_not_open if a final status is sent). The free trial follows in the route.
--     Resolving or dismissing a report writes one notice to the reporter only ('report_closed').
--   * sweep_booking_changes lists a consumed claim whose booking an admin moved to cancelled or
--     chef no-show with no cooked day, so a failed follow-up is repaired.
-- MOCK: nothing here moves money.

revoke select on public.reviews from anon;
grant select (id, author_role, rating, comment, created_at) on public.reviews to anon;

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
  if p_action not in ('cancel', 'cooked', 'no_show', 'complete', 'pickup_propose', 'pickup_respond', 'pickup_missed', 'pickup_confirm') then
    raise exception 'unknown action' using errcode = '22023';
  end if;

  select * into b from public.bookings where id = p_booking for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  v_is_customer := p_actor = b.customer_id;
  v_is_chef := p_actor = b.chef_id;
  if not (v_is_customer or v_is_chef) then return jsonb_build_object('result', 'not_found'); end if;
  -- Second line behind the route's role check: the wrong side sees the same "not found".
  if (p_action in ('cooked', 'complete', 'pickup_respond', 'pickup_missed') and not v_is_chef)
     or (p_action in ('pickup_propose', 'pickup_confirm') and not v_is_customer) then
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

  -- T-081: confirming a day that is already confirmed stays a harmless repeat even when that
  -- confirm completed the booking (double click, stale page): same answer, nothing changes.
  if p_action = 'pickup_confirm' and b.status = 'completed' and exists (
    select 1 from public.booking_days
     where booking_id = b.id and day_number = (p_args ->> 'day_number')::smallint and picked_up_at is not null
  ) then
    return jsonb_build_object('result', 'ok', 'status', 'completed', 'cooked', v_cooked);
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
    -- T-048 (Jimmy, 2026-10-20): an open report never blocks completion. The chef's "visit done"
    -- works exactly as without a report, so nothing the chef sees reveals that one exists.
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
    -- T-071 / D-55 (A-29): only a cooked day past its deadline that the customer has NOT confirmed.
    -- The booking row is locked above, so a confirm and this action cannot both succeed.
    select dd.* into d from public.booking_days dd
     where dd.booking_id = b.id and dd.is_active and dd.cooked_at is not null and dd.picked_up_at is null
       and exists (select 1 from public.booking_day_dishes x where x.booking_day_id = dd.id)
       and public.booking_pickup_end(
             (select min(x.eat_by_date) from public.booking_day_dishes x where x.booking_day_id = dd.id)
           ) <= now()
     order by dd.day_number limit 1;
    if not found then
      -- Was there a cooked day past its deadline that was confirmed? Then say so.
      if exists (
        select 1 from public.booking_days dd
         where dd.booking_id = b.id and dd.is_active and dd.cooked_at is not null and dd.picked_up_at is not null
           and exists (select 1 from public.booking_day_dishes x where x.booking_day_id = dd.id)
           and public.booking_pickup_end(
                 (select min(x.eat_by_date) from public.booking_day_dishes x where x.booking_day_id = dd.id)
               ) <= now()
      ) then
        return jsonb_build_object('result', 'invalid_state', 'reason', 'pickup_confirmed');
      end if;
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

  -- T-071 / D-55: the customer confirms "I picked up my meals" for one cooked day. No undo.
  if p_action = 'pickup_confirm' then
    if d.cooked_at is null then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'day_not_cooked');
    end if;
    -- First time wins; repeating keeps it and tells the chef nothing new.
    update public.booking_days set picked_up_at = now() where id = d.id and picked_up_at is null;
    if found then
      update public.pickup_proposals set status = 'void', responded_at = coalesce(responded_at, now())
       where booking_day_id = d.id and status in ('proposed', 'accepted');
      insert into public.notifications (user_id, booking_id, type, title, body)
      values (b.chef_id, b.id, 'pickup_confirmed', 'Meals picked up',
              'The customer confirmed they picked up the meals from one of the visits.');
    end if;
    -- T-081 / D-81, D-83: the last day just confirmed (the booking is not frozen, checked above):
    -- complete right away, in this same transaction and under the same booking lock. T-048: an open
    -- report does not stop it (this replaces A-30).
    if public.booking_all_picked_up(b.id) then
      update public.bookings set status = 'completed', completed_at = now() where id = b.id;
      -- D-57: completing the booking resolves its no_day_cooked flag.
      update public.booking_flags set resolved_at = now()
       where booking_id = b.id and reason = 'no_day_cooked' and resolved_at is null;
      update public.pickup_proposals set status = 'void', responded_at = coalesce(responded_at, now())
       where booking_id = b.id and status in ('proposed', 'accepted');
      insert into public.notifications (user_id, booking_id, type, title, body)
      select v.u, b.id, 'booking_completed', 'A booking is complete',
             'Every day was cooked and picked up, so this booking was completed automatically. You can now leave a review.'
        from (values (b.customer_id), (b.chef_id)) v (u);
      return jsonb_build_object('result', 'ok', 'status', 'completed', 'cooked', v_cooked);
    end if;
    return jsonb_build_object('result', 'ok', 'status', 'accepted', 'cooked', v_cooked);
  end if;

  if p_action = 'pickup_propose' then
    if d.cooked_at is null then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'day_not_cooked');
    end if;
    -- T-071 review: nothing to arrange once the customer has said they picked the meals up.
    if d.picked_up_at is not null then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'picked_up');
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
       -- T-081 / D-81: a chef's-home booking with every day picked up is due right away.
       and (public.booking_auto_complete_at(b.id) <= now() or public.booking_all_picked_up(b.id))
     order by b.id
  loop
    select * into bk from public.bookings where id = due.id for update;
    if not found or bk.status <> 'accepted' then continue; end if;
    -- D-53: an open admin flag freezes the booking.
    if public.booking_is_frozen(bk.id) then continue; end if;
    if not exists (select 1 from public.booking_days d where d.booking_id = bk.id and d.cooked_at is not null) then
      continue; -- D-36: flagged below instead
    end if;
    -- T-048: an open report never stops the automatic completion.
    update public.bookings set status = 'completed', completed_at = now() where id = bk.id;
    update public.pickup_proposals set status = 'void', responded_at = coalesce(responded_at, now())
     where booking_id = bk.id and status in ('proposed', 'accepted');
    -- D-57: completing the booking resolves its no_day_cooked flag.
    update public.booking_flags set resolved_at = now()
     where booking_id = bk.id and reason = 'no_day_cooked' and resolved_at is null;
    insert into public.notifications (user_id, booking_id, type, title, body)
    select v.u, bk.id, 'booking_completed', 'A booking is complete',
           case when public.booking_all_picked_up(bk.id) and public.booking_auto_complete_at(bk.id) > now()
                then 'Every day was cooked and picked up, so this booking was completed automatically. You can now leave a review.'
                else 'The visits are over, so this booking was completed automatically.' end
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
   where (
           (f.state = 'held'
            and b.status in ('declined', 'expired', 'cancelled', 'completed', 'no_show_customer', 'no_show_chef'))
        -- T-048: an admin changed a completed booking afterwards; a consumed claim whose booking is now
        -- cancelled or a chef no-show with no cooked day is released again (D-26, D-37).
        or (f.state = 'consumed'
            and b.status in ('cancelled', 'no_show_chef')
            and not exists (select 1 from public.booking_days d where d.booking_id = b.id and d.cooked_at is not null))
         )
     and (p_user is null or p_user in (b.customer_id, b.chef_id));

  return jsonb_build_object('completed', n, 'flagged', nf, 'release', rel);
end;
$$;

create or replace function public.admin_decide_booking(
  p_admin uuid, p_kind text, p_booking uuid, p_report uuid, p_final text, p_note text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  r public.reports%rowtype;
  v_booking uuid := p_booking;
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_cooked boolean;
  v_day smallint;
  v_status public.booking_status;
  v_flag text;
  v_note text := btrim(coalesce(p_note, ''));
  v_kind text;
  v_words text;
  v_at timestamptz := now();
  v_change boolean;
begin
  if p_kind not in ('report_resolve', 'report_dismiss', 'flag_resolve') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  if p_final is not null and p_final not in ('completed', 'cancelled', 'no_show_chef', 'no_show_customer') then
    raise exception 'unknown final status' using errcode = '22023';
  end if;
  if char_length(v_note) not between 3 and 500 then
    raise exception 'the note must be 3 to 500 characters' using errcode = '22023';
  end if;
  -- Second line behind the route's role check.
  if not exists (select 1 from public.profiles where id = p_admin and role = 'admin') then
    raise exception 'only an admin can decide' using errcode = '42501';
  end if;
  if p_kind = 'report_dismiss' and p_final is not null then
    raise exception 'a dismissal never changes the booking' using errcode = '22023';
  end if;

  if p_kind <> 'flag_resolve' then
    select booking_id into v_booking from public.reports where id = p_report;
    if not found then return jsonb_build_object('result', 'not_found'); end if;
  end if;

  -- Lock order: booking, then report.
  select * into b from public.bookings where id = v_booking for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if p_kind <> 'flag_resolve' then
    select * into r from public.reports where id = p_report for update;
    if not found then return jsonb_build_object('result', 'not_found'); end if;
    if r.status not in ('open', 'reviewing') then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'already_decided');
    end if;
  end if;

  v_cooked := exists (select 1 from public.booking_days where booking_id = b.id and cooked_at is not null);
  select f.reason into v_flag from public.booking_flags f where f.booking_id = b.id and f.resolved_at is null;

  if p_kind = 'flag_resolve' then
    if v_flag is null then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'no_open_flag');
    end if;
    if b.status <> 'accepted' then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'status_not_open');
    end if;
    if p_final is null then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'final_status_required');
    end if;
  elsif p_kind = 'report_resolve' then
    if b.status = 'accepted' and p_final is null then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'final_status_required');
    end if;
    -- T-048: a completed booking may be given a final status too; every other status closes with a
    -- note only.
    if b.status not in ('accepted', 'completed') and p_final is not null then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'status_not_open');
    end if;
  end if;
  -- Choosing "completed" for a completed booking means leave it as it is.
  v_change := p_final is not null and not (b.status = 'completed' and p_final = 'completed');
  if p_final is not null then v_status := p_final::public.booking_status; end if;

  -- -------------------------------------------------------------------------
  -- The final status (an accepted or completed booking only, checked above)
  -- -------------------------------------------------------------------------
  if v_change then
    if v_status = 'completed' then
      update public.bookings set status = 'completed', completed_at = v_at where id = b.id;
    elsif v_status = 'cancelled' then
      -- cancelled_by stays null (by the system, like the D-22 cascade); the trigger
      -- bookings_sync_days frees every date. The admin's note is NOT stored as the cancel reason.
      update public.bookings set status = 'cancelled', cancelled_at = v_at where id = b.id;
    else
      -- A no-show: the earliest active day that was not cooked, else the first active day.
      select d.day_number into v_day from public.booking_days d
       where d.booking_id = b.id and d.is_active and d.cooked_at is null
       order by d.day_number limit 1;
      if v_day is null then
        select d.day_number into v_day from public.booking_days d
         where d.booking_id = b.id and d.is_active
         order by d.day_number limit 1;
      end if;
      update public.bookings
         set status = v_status, no_show_reported_at = v_at, no_show_day_number = v_day
       where id = b.id;
      -- The booking ends here: visits that have not happened (and were not cooked) free their dates.
      update public.booking_days set is_active = false
       where booking_id = b.id and cooked_at is null and visit_date > v_today;
    end if;
    update public.pickup_proposals set status = 'void', responded_at = coalesce(responded_at, v_at)
     where booking_id = b.id and status in ('proposed', 'accepted');
    -- D-67: a decision unfreezes the booking; every open flag is resolved.
    update public.booking_flags set resolved_at = v_at
     where booking_id = b.id and resolved_at is null;
    -- Neutral notice to BOTH parties: no report, no flag, no note, no reason (Jimmy, 2026-10-20).
    -- The text must match bookingDecidedBody() in src/lib/domain/reviews.ts.
    v_words := case p_final
      when 'completed' then 'completed'
      when 'cancelled' then 'cancelled'
      when 'no_show_chef' then 'a chef no-show'
      else 'a customer no-show' end;
    insert into public.notifications (user_id, booking_id, type, title, body)
    select v.u, b.id, 'booking_decided', 'An admin made a decision on your booking',
           'An admin reviewed this booking and set it to ' || v_words || '.'
      from (values (b.customer_id), (b.chef_id)) v (u);
  end if;

  -- -------------------------------------------------------------------------
  -- The report and the audit row
  -- -------------------------------------------------------------------------
  if p_kind <> 'flag_resolve' then
    -- T-048 (Jimmy, 2026-10-20): the reporter, and only the reporter, learns that an admin closed
    -- the report. No note, no outcome, nothing for the other party.
    insert into public.notifications (user_id, booking_id, type, title, body)
    values (r.reporter_id, b.id, 'report_closed', 'An admin closed your problem report',
            'An admin has looked at your report and closed it.');
    update public.reports
       set status = case when p_kind = 'report_dismiss' then 'dismissed' else 'resolved' end::public.report_status,
           resolved_at = v_at
     where id = r.id;
  end if;
  v_kind := case p_kind
    when 'report_resolve' then 'report_resolved'
    when 'report_dismiss' then 'report_dismissed'
    else 'flag_resolved' end;
  insert into public.admin_decisions (kind, booking_id, report_id, flag_reason, admin_id, final_status, note, created_at)
  values (v_kind, b.id, case when p_kind = 'flag_resolve' then null else r.id end,
          case when p_kind = 'report_dismiss' then null else v_flag end,
          p_admin, v_status, v_note, v_at);

  return jsonb_build_object(
    'result', 'ok',
    'status', coalesce(v_status::text, b.status::text),
    'changed', v_change,
    'cooked', v_cooked,
    'kind', v_kind,
    'decided_at', v_at);
end;
$$;

revoke execute on function public.change_booking(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.change_booking(uuid, uuid, text, jsonb) to service_role;
revoke execute on function public.sweep_booking_changes(uuid) from public, anon, authenticated;
grant execute on function public.sweep_booking_changes(uuid) to service_role;
revoke execute on function public.admin_decide_booking(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_decide_booking(uuid, text, uuid, uuid, text, text) to service_role;
