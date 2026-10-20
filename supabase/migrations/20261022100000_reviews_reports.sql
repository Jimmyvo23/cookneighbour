-- T-048 (WO-5c): reviews, problem reports and admin decisions. New migration; earlier ones are
-- not edited.
--
-- Jimmy's decisions of 2026-10-20:
--   * A review only for a `completed` booking, until 14 days (14 x 24 hours) after completion.
--     review_window_days() holds the 14 (the TypeScript constant REVIEW_WINDOW_DAYS mirrors it and a
--     test compares the two). The insert policy reviews_insert_party is replaced: the browser path
--     is limited too, not only the route. A posted review is final (clients still have no update
--     or delete privilege on reviews).
--   * A report is seen by the admin and its reporter only (policies unchanged). At most one open
--     (open or reviewing) report per reporter per booking: partial unique index
--     reports_one_open_per_reporter, so every path obeys it. reports.client_id is the retry key
--     (unique per reporter), like messages.client_id.
--   * Reports are no longer updated from a browser: the admin decides through
--     admin_decide_booking only (privilege and policy removed).
--   * D-54, D-57, D-67: admin_decide_booking is ONE locked function (service role only, EXECUTE
--     revoked from browsers). It resolves a report (picking a final status when the booking is
--     `accepted`), dismisses a report (no status change), or resolves an open booking flag
--     (`chef_rejected` or `no_day_cooked`, final status required). A final status does what the
--     party action does (completed / cancelled / no-show), and sets resolved_at on every open flag
--     of the booking, which unfreezes it. The free trial follows afterwards: the route calls
--     applyFreeTrialEvent, and the sweep repairs a failure (it lists finished bookings whose claim
--     is still held).
--   * admin_decisions: the admin's audit trail and where the note lives. Row-level security is on
--     and no client has any privilege, so no party can read a note or a decision.
--
-- Lock order: the booking row first, then the report row. This function never locks a chef row, so
-- it cannot deadlock with answer_booking or admin_reject_chef (chef, then booking, by id); it
-- locks one booking only, like change_booking.
-- MOCK: nothing here moves money; no refund or rebooking flow.

-- ---------------------------------------------------------------------------
-- Review window
-- ---------------------------------------------------------------------------
create function public.review_window_days() returns integer
language sql immutable
set search_path = ''
as $$ select 14 $$;
revoke execute on function public.review_window_days() from public, anon;
grant execute on function public.review_window_days() to authenticated, service_role;

drop policy reviews_insert_party on public.reviews;
create policy reviews_insert_party on public.reviews
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.bookings b
      where b.id = reviews.booking_id
        and b.status = 'completed'
        -- T-048: until review_window_days() x 24 hours after completion (inclusive).
        and now() <= coalesce(b.completed_at, b.updated_at)
                     + make_interval(hours => public.review_window_days() * 24)
        and ((b.customer_id = author_id and b.chef_id = subject_id and author_role = 'customer')
          or (b.chef_id = author_id and b.customer_id = subject_id and author_role = 'chef'))
    )
  );

-- ---------------------------------------------------------------------------
-- Reports: retry key, one open report per reporter per booking, admin decides through a function
-- ---------------------------------------------------------------------------
alter table public.reports add column client_id uuid;
create unique index reports_reporter_client_id on public.reports (reporter_id, client_id);
create unique index reports_one_open_per_reporter on public.reports (reporter_id, booking_id)
  where status in ('open', 'reviewing');

drop policy reports_update_admin on public.reports;
revoke update on public.reports from authenticated;

-- ---------------------------------------------------------------------------
-- Admin audit trail (and the only home of the admin's note)
-- ---------------------------------------------------------------------------
create table public.admin_decisions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('report_resolved', 'report_dismissed', 'flag_resolved')),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  report_id uuid references public.reports (id) on delete set null,
  flag_reason text,
  admin_id uuid not null references public.profiles (id),
  final_status public.booking_status,
  note text not null check (char_length(note) between 3 and 500),
  created_at timestamptz not null default now()
);
create index admin_decisions_booking_idx on public.admin_decisions (booking_id, created_at desc);
create index admin_decisions_report_idx on public.admin_decisions (report_id);
alter table public.admin_decisions enable row level security;
-- No policy and no grant: only the service role (the admin routes) reads or writes it.

-- ---------------------------------------------------------------------------
-- admin_decide_booking
-- ---------------------------------------------------------------------------
-- p_kind: 'report_resolve' | 'report_dismiss' | 'flag_resolve'
-- p_final: null, or completed | cancelled | no_show_chef | no_show_customer
-- Returns { result: ok | not_found | invalid_state, reason?, status, changed, cooked, kind, decided_at }.
create function public.admin_decide_booking(
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
    if b.status <> 'accepted' and p_final is not null then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'status_not_open');
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- The final status (an accepted booking only, checked above)
  -- -------------------------------------------------------------------------
  if p_final is not null then
    v_status := p_final::public.booking_status;
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
    'changed', p_final is not null,
    'cooked', v_cooked,
    'kind', v_kind,
    'decided_at', v_at);
end;
$$;
revoke execute on function public.admin_decide_booking(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_decide_booking(uuid, text, uuid, uuid, text, text) to service_role;
