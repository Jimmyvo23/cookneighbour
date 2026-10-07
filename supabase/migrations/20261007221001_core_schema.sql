-- T-025 core schema: enums, tables, indexes, helper functions, triggers.
-- Row-level security and grants are in the next migration (core_rls).
-- Money is integer cents. country/currency/language default to CA/CAD/en (CLAUDE.md section 3).
-- Everything involving payments, identity checks, police checks and SMS is MOCK:
-- the *_status columns below are written by mock code only (src/lib/mocks/).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('customer', 'chef', 'admin');
create type public.chef_status as enum ('pending', 'approved', 'rejected');
create type public.police_check_status as enum ('not_started', 'pending', 'verified', 'failed'); -- MOCK
create type public.mock_check_status as enum ('not_started', 'pending', 'verified', 'failed'); -- MOCK (ID, food handler, kitchen)
create type public.location_type as enum ('customer_home', 'chef_home');
create type public.grocery_option as enum ('customer_buys', 'chef_shops');
create type public.booking_status as enum (
  'requested', 'accepted', 'declined', 'cancelled', 'completed', 'no_show_customer', 'no_show_chef'
);
create type public.cancelled_by as enum ('customer', 'chef');
create type public.cancellation_timing as enum ('on_time', 'late');
create type public.free_trial_state as enum ('held', 'consumed', 'released');
create type public.free_trial_block_reason as enum ('customer', 'phone', 'address');
create type public.report_status as enum ('open', 'reviewing', 'resolved', 'dismissed');

-- ---------------------------------------------------------------------------
-- Generic trigger: keep updated_at fresh
-- ---------------------------------------------------------------------------
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- postal_prefixes (GTA only, assumption A-1). Public reference data.
-- ---------------------------------------------------------------------------
create table public.postal_prefixes (
  prefix text primary key check (prefix ~ '^[A-Z][0-9][A-Z]$'),
  city text not null,
  province text not null default 'ON',
  country text not null default 'CA',
  lat numeric(9, 6) not null check (lat between -90 and 90),
  lng numeric(9, 6) not null check (lng between -180 and 180),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user. NO private data here (see profile_private).
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'customer',
  display_name text not null check (char_length(display_name) between 1 and 80),
  country text not null default 'CA',
  currency text not null default 'CAD',
  language text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- profile_private: phone, home address and abuse-check hashes. Owner and admin read only.
-- Written by the server (secret key) only, so users cannot edit a hash to dodge the free-trial rule.
create table public.profile_private (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  phone_e164 text check (phone_e164 ~ '^\+1[0-9]{10}$'),
  phone_hash text,
  phone_verified boolean not null default false, -- MOCK SMS verification
  address_line text,
  city text,
  postal_code text check (postal_code ~ '^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$'),
  postal_prefix text check (postal_prefix ~ '^[A-Z][0-9][A-Z]$'),
  address_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profile_private_updated_at before update on public.profile_private
  for each row execute function public.set_updated_at();

-- Role helpers (used by policies). Security definer so they can read profiles without recursion.
create function public.is_admin() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

-- Create profile + profile_private when an auth user is created.
-- Only 'chef' may be requested through sign-up metadata; admin can never be self-assigned.
create function public.handle_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    case when new.raw_user_meta_data ->> 'role' = 'chef' then 'chef'::public.user_role
         else 'customer'::public.user_role end,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
                  nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                  'New user'), 80)
  );
  insert into public.profile_private (profile_id) values (new.id);
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only the server (service role / database owner) may change a role.
create function public.guard_profile_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and current_user in ('anon', 'authenticated') then
    raise exception 'role cannot be changed from the client' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'id cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------------
-- chefs (public listing columns only) and chef_private (owner + admin)
-- ---------------------------------------------------------------------------
create table public.chefs (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  status public.chef_status not null default 'pending',
  display_name text not null check (char_length(display_name) between 1 and 80),
  bio text check (char_length(bio) <= 2000),
  photo_path text,
  cuisines text[] not null default '{}',
  languages text[] not null default '{}',
  hourly_rate_cents integer check (hourly_rate_cents > 0),
  service_postal_prefix text references public.postal_prefixes (prefix),
  service_radius_km integer not null default 15 check (service_radius_km between 1 and 200),
  location_options public.location_type[] not null default '{customer_home}'
    check (cardinality(location_options) >= 1),
  chef_home_enabled boolean not null default false, -- set by admin after kitchen review (MOCK check)
  rating_avg numeric(3, 2) not null default 0,
  review_count integer not null default 0,
  country text not null default 'CA',
  currency text not null default 'CAD',
  language text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chefs_status_idx on public.chefs (status);
create index chefs_prefix_idx on public.chefs (service_postal_prefix) where status = 'approved';
create index chefs_cuisines_idx on public.chefs using gin (cuisines);
create index chefs_languages_idx on public.chefs using gin (languages);
create trigger chefs_updated_at before update on public.chefs
  for each row execute function public.set_updated_at();

create table public.chef_private (
  chef_id uuid primary key references public.chefs (profile_id) on delete cascade,
  reject_reason text,
  police_check_status public.police_check_status not null default 'not_started', -- MOCK
  id_check_status public.mock_check_status not null default 'not_started', -- MOCK
  food_handler_status public.mock_check_status not null default 'not_started', -- MOCK
  kitchen_status public.mock_check_status not null default 'not_started', -- MOCK
  id_document_path text,
  food_handler_path text,
  kitchen_photo_paths text[] not null default '{}',
  kitchen_address_line text,
  kitchen_city text,
  kitchen_postal_code text check (kitchen_postal_code ~ '^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$'),
  allergen_ack_at timestamptz,
  kitchen_hygiene_ack_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger chef_private_updated_at before update on public.chef_private
  for each row execute function public.set_updated_at();

-- Moderation and rating columns can only be changed by an admin or the server.
create function public.guard_chef_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if new.status is distinct from old.status
       or new.chef_home_enabled is distinct from old.chef_home_enabled
       or new.rating_avg is distinct from old.rating_avg
       or new.review_count is distinct from old.review_count
       or new.profile_id is distinct from old.profile_id then
      raise exception 'moderation and rating fields are admin-only' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger chefs_guard before update on public.chefs
  for each row execute function public.guard_chef_update();

create function public.guard_chef_private_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if new.reject_reason is distinct from old.reject_reason
       or new.police_check_status is distinct from old.police_check_status
       or new.id_check_status is distinct from old.id_check_status
       or new.food_handler_status is distinct from old.food_handler_status
       or new.kitchen_status is distinct from old.kitchen_status
       or new.chef_id is distinct from old.chef_id then
      raise exception 'verification fields are admin-only' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger chef_private_guard before update on public.chef_private
  for each row execute function public.guard_chef_private_update();

-- ---------------------------------------------------------------------------
-- dishes and availability
-- ---------------------------------------------------------------------------
create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  chef_id uuid not null references public.chefs (profile_id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  photo_path text,
  description text check (char_length(description) <= 1000),
  cuisine text not null,
  cook_minutes integer not null check (cook_minutes > 0),
  ingredient_cost_cents integer not null default 0 check (ingredient_cost_cents >= 0),
  servings integer not null default 1 check (servings > 0),
  allergens text[] not null default '{}',
  shelf_life_days integer not null default 2 check (shelf_life_days between 0 and 7), -- A-7
  is_active boolean not null default true,
  currency text not null default 'CAD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dishes_chef_idx on public.dishes (chef_id) where is_active;
create trigger dishes_updated_at before update on public.dishes
  for each row execute function public.set_updated_at();

create table public.availability (
  chef_id uuid not null references public.chefs (profile_id) on delete cascade,
  day date not null,
  available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chef_id, day)
);
create trigger availability_updated_at before update on public.availability
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- bookings and children
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete restrict,
  chef_id uuid not null references public.chefs (profile_id) on delete restrict,
  status public.booking_status not null default 'requested',
  location_type public.location_type not null,
  grocery_option public.grocery_option not null,
  is_free_trial boolean not null default false,
  -- estimate snapshot (cents), computed by src/lib/domain/pricing
  hourly_rate_cents integer not null check (hourly_rate_cents > 0),
  est_cook_minutes integer not null default 0 check (est_cook_minutes >= 0),
  est_labour_cents integer not null default 0 check (est_labour_cents >= 0),
  est_ingredients_cents integer not null default 0 check (est_ingredients_cents >= 0),
  est_travel_cents integer not null default 0 check (est_travel_cents >= 0),
  est_platform_fee_cents integer not null default 0 check (est_platform_fee_cents >= 0), -- shown, not collected
  est_total_cents integer not null default 0 check (est_total_cents >= 0),
  platform_fee_percent numeric(5, 2) not null default 10,
  travel_rate_cents_per_km integer not null default 60,
  distance_km numeric(7, 2),
  service_postal_prefix text check (service_postal_prefix ~ '^[A-Z][0-9][A-Z]$'),
  decline_reason text,
  responded_at timestamptz,
  cancelled_by public.cancelled_by,
  cancelled_at timestamptz,
  cancellation_timing public.cancellation_timing,
  cancel_reason text,
  country text not null default 'CA',
  currency text not null default 'CAD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_not_self check (customer_id <> chef_id),
  constraint bookings_cancel_consistent check (status <> 'cancelled' or cancelled_at is not null),
  constraint bookings_chef_home_no_travel check (location_type <> 'chef_home' or est_travel_cents = 0)
);
create index bookings_customer_idx on public.bookings (customer_id, created_at desc);
create index bookings_chef_idx on public.bookings (chef_id, status);

-- Customer cooking address for customer_home bookings. Kept apart so the chef cannot read it
-- until the booking is accepted (read through get_booking_contact()).
create table public.booking_addresses (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  address_line text not null,
  city text not null,
  postal_code text not null check (postal_code ~ '^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$'),
  created_at timestamptz not null default now()
);

create table public.booking_days (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  chef_id uuid not null references public.chefs (profile_id) on delete restrict, -- copied from the booking by trigger
  day_number smallint not null check (day_number between 1 and 3), -- 1 to 3 days max
  visit_date date not null,
  start_time time,
  total_cook_minutes integer not null default 0 check (total_cook_minutes >= 0),
  is_active boolean not null default true, -- false once the booking is declined or cancelled
  created_at timestamptz not null default now(),
  unique (booking_id, day_number),
  unique (booking_id, visit_date)
);
-- A-9: one visit per chef per date. Declined and cancelled bookings do not block.
create unique index booking_days_one_per_chef_date on public.booking_days (chef_id, visit_date) where is_active;
create index booking_days_booking_idx on public.booking_days (booking_id);

create table public.booking_day_dishes (
  id uuid primary key default gen_random_uuid(),
  booking_day_id uuid not null references public.booking_days (id) on delete cascade,
  dish_id uuid references public.dishes (id) on delete set null,
  -- snapshot so history survives dish edits or deletion
  dish_name text not null,
  cook_minutes integer not null check (cook_minutes > 0),
  ingredient_cost_cents integer not null default 0 check (ingredient_cost_cents >= 0),
  servings integer not null default 1 check (servings > 0),
  allergens text[] not null default '{}',
  quantity integer not null default 1 check (quantity > 0),
  eat_by_date date not null, -- A-7: visit date + shelf life days
  created_at timestamptz not null default now()
);
create index booking_day_dishes_day_idx on public.booking_day_dishes (booking_day_id);

-- Fill chef_id / is_active from the booking and reject past dates (Toronto time).
create function public.booking_days_before_insert() returns trigger
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
  new.is_active := b.status not in ('declined', 'cancelled');
  if new.visit_date < (now() at time zone 'America/Toronto')::date then
    raise exception 'visit date is in the past' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger booking_days_before_insert before insert on public.booking_days
  for each row execute function public.booking_days_before_insert();

-- Release the chef's dates when a booking is declined or cancelled.
create function public.bookings_sync_days() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.booking_days
     set is_active = new.status not in ('declined', 'cancelled')
   where booking_id = new.id;
  return null;
end;
$$;
create trigger bookings_sync_days after update of status on public.bookings
  for each row when (old.status is distinct from new.status)
  execute function public.bookings_sync_days();

-- Booking rules that must hold no matter which code path writes: approved chef,
-- location offered, chef's-home only when admin enabled it, customer role.
create function public.bookings_before_insert() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.chefs;
  r public.user_role;
begin
  select * into c from public.chefs where profile_id = new.chef_id;
  if not found or c.status <> 'approved' then
    raise exception 'chef is not approved' using errcode = '23514';
  end if;
  if not (new.location_type = any (c.location_options)) then
    raise exception 'chef does not offer this location' using errcode = '23514';
  end if;
  if new.location_type = 'chef_home' and not c.chef_home_enabled then
    raise exception 'chef home option is not enabled for this chef' using errcode = '23514';
  end if;
  select role into r from public.profiles where id = new.customer_id;
  if r is distinct from 'customer' then
    raise exception 'only customers can book' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger bookings_before_insert before insert on public.bookings
  for each row execute function public.bookings_before_insert();
create trigger bookings_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();

create table public.intake_forms (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  allergies text not null default '',
  dietary_notes text not null default '',
  allergy_conflict_acknowledged boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id),
  file_path text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'CAD',
  mismatch_flagged boolean not null default false,
  customer_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index receipts_booking_idx on public.receipts (booking_id);

-- ---------------------------------------------------------------------------
-- messages, notifications, reviews, reports
-- ---------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index messages_booking_idx on public.messages (booking_id, created_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  subject_id uuid not null references public.profiles (id),
  author_role public.user_role not null check (author_role in ('customer', 'chef')),
  author_display_name text not null default '', -- snapshot set by trigger
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  unique (booking_id, author_id)
);
create index reviews_subject_idx on public.reviews (subject_id);

create function public.reviews_before_insert() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  select display_name into new.author_display_name from public.profiles where id = new.author_id;
  return new;
end;
$$;
create trigger reviews_before_insert before insert on public.reviews
  for each row execute function public.reviews_before_insert();

-- Keep the chef's cached rating in step with customer reviews.
create function public.reviews_after_insert() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.author_role = 'customer' then
    update public.chefs c
       set rating_avg = s.avg_rating, review_count = s.n
      from (
        select round(avg(rating)::numeric, 2) as avg_rating, count(*)::int as n
          from public.reviews
         where subject_id = new.subject_id and author_role = 'customer'
      ) s
     where c.profile_id = new.subject_id;
  end if;
  return null;
end;
$$;
create trigger reviews_after_insert after insert on public.reviews
  for each row execute function public.reviews_after_insert();

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id),
  category text not null default 'other',
  description text not null check (char_length(description) between 1 and 2000),
  status public.report_status not null default 'open',
  admin_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reports_booking_idx on public.reports (booking_id);
create index reports_status_idx on public.reports (status);
create trigger reports_updated_at before update on public.reports
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Free trial (CLAUDE.md 6.6). Hashes are SHA-256 with a server-only pepper (A-2, A-3).
-- ---------------------------------------------------------------------------
create table public.free_trial_claims (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete restrict,
  booking_id uuid not null unique references public.bookings (id) on delete restrict,
  phone_hash text not null,
  address_hash text not null,
  state public.free_trial_state not null default 'held',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A released claim (booking cancelled before it happened) frees the trial; held/consumed claims block.
create unique index free_trial_one_per_customer on public.free_trial_claims (customer_id) where state <> 'released';
create unique index free_trial_one_per_phone on public.free_trial_claims (phone_hash) where state <> 'released';
create unique index free_trial_one_per_address on public.free_trial_claims (address_hash) where state <> 'released';
create trigger free_trial_claims_updated_at before update on public.free_trial_claims
  for each row execute function public.set_updated_at();

-- Log of blocked second-trial attempts, for the admin list (CLAUDE.md 6.9).
create table public.free_trial_blocks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  reason public.free_trial_block_reason not null,
  created_at timestamptz not null default now()
);
create index free_trial_blocks_customer_idx on public.free_trial_blocks (customer_id);

-- Realtime chat: Realtime applies the messages RLS policies to every subscriber.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
