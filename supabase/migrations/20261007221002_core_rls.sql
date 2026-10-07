-- T-025 row-level security: helper functions, grants, policies.
-- Principle: deny by default. RLS is enabled on every table; anon and authenticated start with
-- NO table privileges and get back only what is listed here. The server (service role, which
-- bypasses RLS) writes bookings, intake, receipts, claims, notifications and private data after
-- its own checks. Every policy is also described in docs/data-model.md.

-- ---------------------------------------------------------------------------
-- Helpers (security definer so policies can look across tables without recursion)
-- ---------------------------------------------------------------------------
create function public.is_booking_party(p_booking uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking
      and (select auth.uid()) in (b.customer_id, b.chef_id)
  );
$$;

create function public.is_booking_chef(p_booking uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking and b.chef_id = (select auth.uid())
  );
$$;

-- True when the signed-in user and p_other are the two sides of any booking.
create function public.shares_booking_with(p_other uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where (b.customer_id = (select auth.uid()) and b.chef_id = p_other)
       or (b.chef_id = (select auth.uid()) and b.customer_id = p_other)
  );
$$;

-- Contact details unlock once the chef has accepted (and stay unlocked afterwards).
create function public.booking_contact_unlocked(p_status public.booking_status) returns boolean
language sql immutable
set search_path = ''
as $$
  select p_status in ('accepted', 'completed', 'no_show_customer', 'no_show_chef');
$$;

-- The ONLY way a party can read the other party's phone number and address.
-- Returns no rows unless the caller is a party AND the booking has been accepted.
--   Chef calls it:     customer's phone, and the cooking address for customer_home bookings.
--   Customer calls it: chef's phone, and the chef's kitchen address for chef_home bookings.
-- Hashes, documents and verification fields are never returned.
create function public.get_booking_contact(p_booking uuid)
returns table (
  counterparty_role public.user_role,
  display_name text,
  phone_e164 text,
  address_line text,
  city text,
  postal_code text
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  b public.bookings;
  me uuid := (select auth.uid());
begin
  select * into b from public.bookings where id = p_booking;
  if not found or me is null or me not in (b.customer_id, b.chef_id)
     or not public.booking_contact_unlocked(b.status) then
    return;
  end if;

  if me = b.chef_id then
    return query
      select 'customer'::public.user_role, p.display_name, pp.phone_e164,
             ba.address_line, ba.city, ba.postal_code
        from public.profiles p
        join public.profile_private pp on pp.profile_id = p.id
        left join public.booking_addresses ba
               on ba.booking_id = b.id and b.location_type = 'customer_home'
       where p.id = b.customer_id;
  else
    return query
      select 'chef'::public.user_role, p.display_name, pp.phone_e164,
             case when b.location_type = 'chef_home' then cp.kitchen_address_line end,
             case when b.location_type = 'chef_home' then cp.kitchen_city end,
             case when b.location_type = 'chef_home' then cp.kitchen_postal_code end
        from public.profiles p
        join public.profile_private pp on pp.profile_id = p.id
        left join public.chef_private cp on cp.chef_id = p.id
       where p.id = b.chef_id;
  end if;
end;
$$;

create function public.is_chef() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'chef'
  );
$$;

-- Storage helper: first folder of an object path as a uuid (null for any other shape).
create function public.storage_folder_uuid(p_name text) returns uuid
language sql stable
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(p_name))[1])::uuid
  end;
$$;

-- Kitchen photos (<chef id>/<file>): the customer of an accepted/completed chef_home booking
-- with that chef may view them.
create function public.can_view_kitchen_photos(p_chef uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.chef_id = p_chef
      and b.customer_id = (select auth.uid())
      and b.location_type = 'chef_home'
      and public.booking_contact_unlocked(b.status)
  );
$$;

-- Storage helper: receipts live at <booking id>/<file>; returns null for any other path shape.
create function public.storage_booking_id(p_name text) returns uuid
language sql stable
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(p_name))[1])::uuid
  end;
$$;

-- Function privileges: nothing is callable by PUBLIC. Policy helpers need authenticated.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_booking_party(uuid) to authenticated;
grant execute on function public.is_booking_chef(uuid) to authenticated;
grant execute on function public.shares_booking_with(uuid) to authenticated;
grant execute on function public.booking_contact_unlocked(public.booking_status) to authenticated;
grant execute on function public.get_booking_contact(uuid) to authenticated;
grant execute on function public.storage_booking_id(text) to authenticated;
grant execute on function public.is_chef() to authenticated;
grant execute on function public.storage_folder_uuid(text) to authenticated;
grant execute on function public.can_view_kitchen_photos(uuid) to authenticated;
-- Trigger functions are not granted to anyone; triggers fire without an EXECUTE check.
-- Future functions in this schema should also not be public:
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere, strip default Supabase table grants, grant back the minimum
-- ---------------------------------------------------------------------------
alter table public.postal_prefixes enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.chefs enable row level security;
alter table public.chef_private enable row level security;
alter table public.dishes enable row level security;
alter table public.availability enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_addresses enable row level security;
alter table public.booking_days enable row level security;
alter table public.booking_day_dishes enable row level security;
alter table public.intake_forms enable row level security;
alter table public.receipts enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.reviews enable row level security;
alter table public.reports enable row level security;
alter table public.free_trial_claims enable row level security;
alter table public.free_trial_blocks enable row level security;

revoke all on all tables in schema public from anon, authenticated;
-- Future tables in this schema also start with no client privileges:
alter default privileges in schema public revoke all on tables from anon, authenticated;

grant select on public.postal_prefixes, public.chefs, public.dishes, public.availability, public.reviews to anon;

grant select on
  public.postal_prefixes, public.profiles, public.profile_private, public.chefs, public.chef_private,
  public.dishes, public.availability, public.bookings, public.booking_addresses, public.booking_days,
  public.booking_day_dishes, public.intake_forms, public.receipts, public.messages,
  public.notifications, public.reviews, public.reports, public.free_trial_claims, public.free_trial_blocks
  to authenticated;
grant update on public.profiles, public.chefs, public.chef_private to authenticated;
grant insert, update, delete on public.dishes, public.availability to authenticated;
-- Column-level insert grants: clients cannot set ids, timestamps or server-managed columns.
grant insert (booking_id, sender_id, body) on public.messages to authenticated;
grant insert (booking_id, author_id, subject_id, author_role, rating, comment) on public.reviews to authenticated;
grant insert (booking_id, reporter_id, category, description) on public.reports to authenticated;
grant update on public.reports to authenticated;
grant update (read_at) on public.notifications to authenticated;
-- postal_prefixes, free_trial_*, bookings*, intake_forms, receipts: read-only for clients.

-- ---------------------------------------------------------------------------
-- postal_prefixes: public reference data, read only
-- ---------------------------------------------------------------------------
create policy postal_prefixes_read on public.postal_prefixes
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- profiles: self, admin, and the other party of a shared booking. No insert/delete policy.
-- ---------------------------------------------------------------------------
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_select_admin on public.profiles
  for select to authenticated using ((select public.is_admin()));
create policy profiles_select_counterparty on public.profiles
  for select to authenticated using (public.shares_booking_with(id));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- profile_private: owner and admin read. Writes by the server only.
-- ---------------------------------------------------------------------------
create policy profile_private_select_own on public.profile_private
  for select to authenticated using (profile_id = (select auth.uid()));
create policy profile_private_select_admin on public.profile_private
  for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- chefs: approved chefs are public; owner sees own row; admin sees all;
-- a customer keeps seeing a chef they have a booking with.
-- ---------------------------------------------------------------------------
create policy chefs_select_public on public.chefs
  for select to anon, authenticated using (status = 'approved');
create policy chefs_select_own on public.chefs
  for select to authenticated using (profile_id = (select auth.uid()));
create policy chefs_select_admin on public.chefs
  for select to authenticated using ((select public.is_admin()));
create policy chefs_select_counterparty on public.chefs
  for select to authenticated using (public.shares_booking_with(profile_id));
create policy chefs_update_own on public.chefs
  for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
create policy chefs_update_admin on public.chefs
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- chef_private: owner and admin only (documents, verification statuses, kitchen address)
-- ---------------------------------------------------------------------------
create policy chef_private_select_own on public.chef_private
  for select to authenticated using (chef_id = (select auth.uid()));
create policy chef_private_select_admin on public.chef_private
  for select to authenticated using ((select public.is_admin()));
create policy chef_private_update_own on public.chef_private
  for update to authenticated
  using (chef_id = (select auth.uid())) with check (chef_id = (select auth.uid()));
create policy chef_private_update_admin on public.chef_private
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- dishes and availability: public only for approved chefs; the chef manages their own
-- ---------------------------------------------------------------------------
create policy dishes_select_public on public.dishes
  for select to anon, authenticated
  using (is_active and exists (
    select 1 from public.chefs c where c.profile_id = dishes.chef_id and c.status = 'approved'));
create policy dishes_select_own on public.dishes
  for select to authenticated using (chef_id = (select auth.uid()));
create policy dishes_select_admin on public.dishes
  for select to authenticated using ((select public.is_admin()));
create policy dishes_insert_own on public.dishes
  for insert to authenticated with check (chef_id = (select auth.uid()));
create policy dishes_update_own on public.dishes
  for update to authenticated
  using (chef_id = (select auth.uid())) with check (chef_id = (select auth.uid()));
create policy dishes_delete_own on public.dishes
  for delete to authenticated using (chef_id = (select auth.uid()));

create policy availability_select_public on public.availability
  for select to anon, authenticated
  using (exists (
    select 1 from public.chefs c where c.profile_id = availability.chef_id and c.status = 'approved'));
create policy availability_select_own on public.availability
  for select to authenticated using (chef_id = (select auth.uid()));
create policy availability_select_admin on public.availability
  for select to authenticated using ((select public.is_admin()));
create policy availability_insert_own on public.availability
  for insert to authenticated with check (chef_id = (select auth.uid()));
create policy availability_update_own on public.availability
  for update to authenticated
  using (chef_id = (select auth.uid())) with check (chef_id = (select auth.uid()));
create policy availability_delete_own on public.availability
  for delete to authenticated using (chef_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- bookings and children: the two parties and admin read; the server writes.
-- ---------------------------------------------------------------------------
create policy bookings_select_party on public.bookings
  for select to authenticated
  using ((select auth.uid()) in (customer_id, chef_id));
create policy bookings_select_admin on public.bookings
  for select to authenticated using ((select public.is_admin()));

-- The customer's own cooking address: only the customer (and admin) can select it.
-- The chef gets it after acceptance through get_booking_contact(), never by table select.
create policy booking_addresses_select_customer on public.booking_addresses
  for select to authenticated
  using (exists (select 1 from public.bookings b
                 where b.id = booking_addresses.booking_id and b.customer_id = (select auth.uid())));
create policy booking_addresses_select_admin on public.booking_addresses
  for select to authenticated using ((select public.is_admin()));

create policy booking_days_select_party on public.booking_days
  for select to authenticated using (public.is_booking_party(booking_id));
create policy booking_days_select_admin on public.booking_days
  for select to authenticated using ((select public.is_admin()));

create policy booking_day_dishes_select_party on public.booking_day_dishes
  for select to authenticated
  using (exists (select 1 from public.booking_days d
                 where d.id = booking_day_dishes.booking_day_id and public.is_booking_party(d.booking_id)));
create policy booking_day_dishes_select_admin on public.booking_day_dishes
  for select to authenticated using ((select public.is_admin()));

-- The chef reads the intake form before accepting (CLAUDE.md 6.7), so parties may read it at any status.
create policy intake_forms_select_party on public.intake_forms
  for select to authenticated using (public.is_booking_party(booking_id));
create policy intake_forms_select_admin on public.intake_forms
  for select to authenticated using ((select public.is_admin()));

create policy receipts_select_party on public.receipts
  for select to authenticated using (public.is_booking_party(booking_id));
create policy receipts_select_admin on public.receipts
  for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- messages: parties read; a party may send as themselves while the booking is open.
-- Admin may read (needed to review reports); admin cannot send.
-- ---------------------------------------------------------------------------
create policy messages_select_party on public.messages
  for select to authenticated using (public.is_booking_party(booking_id));
create policy messages_select_admin on public.messages
  for select to authenticated using ((select public.is_admin()));
create policy messages_insert_party on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (select 1 from public.bookings b
                where b.id = messages.booking_id
                  and (select auth.uid()) in (b.customer_id, b.chef_id)
                  and b.status in ('requested', 'accepted', 'completed'))
  );

-- ---------------------------------------------------------------------------
-- notifications: owner reads and marks as read (read_at only). Server inserts.
-- ---------------------------------------------------------------------------
create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- reviews: only after a completed booking, by a party, about the other party.
-- Customer reviews of an approved chef are public; chef reviews of a customer are private.
-- ---------------------------------------------------------------------------
create policy reviews_select_public on public.reviews
  for select to anon, authenticated
  using (author_role = 'customer' and exists (
    select 1 from public.chefs c where c.profile_id = reviews.subject_id and c.status = 'approved'));
create policy reviews_select_party on public.reviews
  for select to authenticated
  using ((select auth.uid()) in (author_id, subject_id));
create policy reviews_select_admin on public.reviews
  for select to authenticated using ((select public.is_admin()));
create policy reviews_insert_party on public.reviews
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.bookings b
      where b.id = reviews.booking_id
        and b.status = 'completed'
        and ((b.customer_id = author_id and b.chef_id = subject_id and author_role = 'customer')
          or (b.chef_id = author_id and b.customer_id = subject_id and author_role = 'chef'))
    )
  );

-- ---------------------------------------------------------------------------
-- reports: a party files a report about their booking; reporter and admin read; admin triages.
-- ---------------------------------------------------------------------------
create policy reports_select_own on public.reports
  for select to authenticated using (reporter_id = (select auth.uid()));
create policy reports_select_admin on public.reports
  for select to authenticated using ((select public.is_admin()));
create policy reports_insert_party on public.reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and status = 'open'
    and admin_note is null
    and resolved_at is null
    and public.is_booking_party(booking_id)
  );
create policy reports_update_admin on public.reports
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- free trial: owner may read their own claim; admin reads all and the block log. Server writes.
-- ---------------------------------------------------------------------------
create policy free_trial_claims_select_own on public.free_trial_claims
  for select to authenticated using (customer_id = (select auth.uid()));
create policy free_trial_claims_select_admin on public.free_trial_claims
  for select to authenticated using ((select public.is_admin()));
create policy free_trial_blocks_select_admin on public.free_trial_blocks
  for select to authenticated using ((select public.is_admin()));
