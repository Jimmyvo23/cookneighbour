-- T-090 (WO-6a): two small clean-ups.
--   * admin_decide_booking also returns booking_id, so the route no longer reads `reports` again.
--     Same signature, same body otherwise, same security settings and grants (service role only).
--   * reports.admin_note is dropped (T-048 INFO-4, Jimmy's OK D-122): nothing writes or reads it;
--     the admin's note lives in admin_decisions. The insert policy no longer mentions it.
--     Before the hosted push: select count(*) from public.reports where admin_note is not null; = 0.

drop policy reports_insert_party on public.reports;
alter table public.reports drop column admin_note;
create policy reports_insert_party on public.reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and status = 'open'
    and resolved_at is null
    and public.is_booking_party(booking_id)
  );

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
    'booking_id', b.id,
    'status', coalesce(v_status::text, b.status::text),
    'changed', v_change,
    'cooked', v_cooked,
    'kind', v_kind,
    'decided_at', v_at);
end;
$$;

revoke execute on function public.admin_decide_booking(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_decide_booking(uuid, text, uuid, uuid, text, text) to service_role;
