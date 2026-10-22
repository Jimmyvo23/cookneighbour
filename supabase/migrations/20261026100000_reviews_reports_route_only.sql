-- T-098 (WO-T098, T-053 findings MED-1 and LOW-1): reviews and reports are written by the server only.
--
-- Before: `authenticated` had a column insert grant and an insert policy on both tables, so a signed-in
-- user could call POST /rest/v1/reviews (or /reports) with the publishable key and skip the route's
-- checks (the contact-details refusal, unsafe-text check, empty-text rule, rate limit, client_id
-- retry key). Same fix as T-046 for `messages`:
--   * the insert policies and every insert privilege of `authenticated` (and `anon`) are removed;
--   * the routes insert with the service role AFTER their own checks;
--   * the party / status / window rules the policies enforced now live in BEFORE INSERT triggers, so
--     they hold for the service role too and the route is not the only guard.
-- Updates and deletes: no browser role has any (reviews: never granted; reports: removed in
-- 20261022100000), and this migration re-asserts that with explicit revokes.
-- Rollback (not run by anything): re-create reviews_insert_party and reports_insert_party from
-- 20261022100000 / 20261025100000, re-grant the insert column lists from 20261007221002, drop the two
-- triggers and functions below.
-- Before the hosted push: nothing to check (no data changes; the triggers only act on new rows).
-- MOCK: nothing here moves money or verifies identity.

drop policy reviews_insert_party on public.reviews;
drop policy reports_insert_party on public.reports;

revoke insert, update, delete, truncate, references, trigger on public.reviews from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.reports from anon, authenticated;
revoke insert (booking_id, author_id, subject_id, author_role, rating, comment, id, created_at, author_display_name)
  on public.reviews from anon, authenticated;
revoke insert (booking_id, reporter_id, category, description, status, created_at, resolved_at, client_id, id)
  on public.reports from anon, authenticated;
revoke update (rating, comment) on public.reviews from anon, authenticated;
revoke update (status, description, category, resolved_at) on public.reports from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reviews: a completed booking, inside the window, written as one party about the other.
-- (Same rule as the old policy reviews_insert_party; it now applies to every writer.)
-- ---------------------------------------------------------------------------
create function public.reviews_guard_insert() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.bookings b
    where b.id = new.booking_id
      and b.status = 'completed'
      -- Until review_window_days() x 24 hours after completion (inclusive).
      and now() <= coalesce(b.completed_at, b.updated_at)
                   + make_interval(hours => public.review_window_days() * 24)
      and ((b.customer_id = new.author_id and b.chef_id = new.subject_id and new.author_role = 'customer')
        or (b.chef_id = new.author_id and b.customer_id = new.subject_id and new.author_role = 'chef'))
  ) then
    raise exception 'review not allowed for this booking' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.reviews_guard_insert() from public, anon, authenticated;
-- Runs before reviews_before_insert (name order) so a refused row never gets a display name.
create trigger reviews_a_guard_insert before insert on public.reviews
  for each row execute function public.reviews_guard_insert();

-- ---------------------------------------------------------------------------
-- Reports: the reporter is a party of the booking; a new report is open and unresolved.
-- (Same rule as the old policy reports_insert_party; it now applies to every writer.)
-- ---------------------------------------------------------------------------
create function public.reports_guard_insert() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status <> 'open' or new.resolved_at is not null then
    raise exception 'a new report must be open' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.bookings b
    where b.id = new.booking_id
      and new.reporter_id in (b.customer_id, b.chef_id)
  ) then
    raise exception 'only a party of the booking can report on it' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.reports_guard_insert() from public, anon, authenticated;
create trigger reports_guard_insert before insert on public.reports
  for each row execute function public.reports_guard_insert();
