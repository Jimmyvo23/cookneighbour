# CookNeighbour data model and row-level security

Source of truth: `supabase/migrations/` (`core_schema`, `core_rls`, `storage_buckets`, `auth_backend`, `kitchen_photos_insert_only`, and later `booking_expired_status` and `booking_api`, T-042). This page describes it in plain English for the Tester (T-027) and the Reviewer. Money is integer cents. `country`, `currency` and `language` default to `CA`, `CAD`, `en`. Everything about payments, ID, food-handler, kitchen and police checks and SMS is **MOCK**.

## How access works

- RLS is enabled on every table. `anon` and `authenticated` start with **no** table privileges; only the grants and policies below give access. Future tables also start with no client privileges.
- The **server** (Next.js route handlers using the secret key / service role) bypasses RLS and does the writes that need business logic: bookings, booking days and dishes, intake forms, receipts, free-trial claims and blocks, notifications, chef sign-up rows, and everything in `profile_private`. It must check authorization itself.
- `is_admin()` (security definer, empty `search_path`) is true when the signed-in user's profile role is `admin`. Admin accounts are created by seed or the server; sign-up can only ask for `customer` or `chef`.
- All policies use `(select auth.uid())`.
- "Party" means the booking's customer or its chef.

## Enums

| Enum | Values |
|---|---|
| `user_role` | customer, chef, admin |
| `chef_status` | pending, approved, rejected |
| `police_check_status` (MOCK) | not_started, pending, verified, failed |
| `mock_check_status` (MOCK: ID, food handler, kitchen) | not_started, pending, verified, failed |
| `location_type` | customer_home, chef_home |
| `grocery_option` | customer_buys, chef_shops |
| `booking_status` | requested, accepted, declined, cancelled, completed, no_show_customer, no_show_chef, expired (T-042, D-19) |
| `cancelled_by` / `cancellation_timing` | customer, chef / on_time, late |
| `free_trial_state` | held, consumed, released |
| `free_trial_block_reason` | customer, phone, address |
| `report_status` | open, reviewing, resolved, dismissed |

## Tables

| Table | Purpose and notable rules |
|---|---|
| `postal_prefixes` | GTA prefix (e.g. `L5B`), city, lat, lng. Public reference data (A-1). |
| `profiles` | One row per auth user (created by trigger on `auth.users` insert). Role, display name, country/currency/language. **No private data.** |
| `profile_private` | Phone (E.164), `phone_hash`, `phone_verified` (MOCK), home address, `postal_prefix`, `address_hash`. Created empty by the same trigger. |
| `chefs` | Public listing: status, display name, bio, photo, cuisines, languages, hourly rate, service prefix and radius, `location_options` (array), `chef_home_enabled` (admin sets after the MOCK kitchen review), cached `rating_avg` / `review_count`. |
| `chef_private` | Reject reason, `police_check_status`, ID / food-handler / kitchen MOCK statuses, document and kitchen-photo paths, kitchen address, allergen and kitchen-hygiene acknowledgements. |
| `dishes` | Name, photo, description, cuisine, `cook_minutes`, `ingredient_cost_cents`, servings, allergens, `shelf_life_days` (default 2), `is_active`. |
| `availability` | `(chef_id, day)` primary key, `available`. |
| `bookings` | Customer, chef, status, `location_type`, `grocery_option`, `is_free_trial`, estimate snapshot (rate, minutes, labour, ingredients, travel, platform fee, total), fee percent and per-km rate used, cancellation fields, `expires_at` (T-042: when an unanswered request expires), country/currency. |
| `booking_addresses` | The customer's cooking address for `customer_home` bookings. Separate so it is not readable by the chef through the table. |
| `booking_days` | 1 to 3 days (`day_number` 1..3), `visit_date`, `chef_id` (copied by trigger), `is_active`. |
| `booking_day_dishes` | Dish snapshot (name, minutes, cost, allergens, servings), quantity, `eat_by_date`. `dish_id` becomes null if the dish is deleted. |
| `intake_forms` | One per booking: allergies, dietary notes, allergy-conflict acknowledged. |
| `receipts` | File path, amount, mismatch flag, customer confirmation time. |
| `messages` | Chat per booking (in the `supabase_realtime` publication; Realtime applies the RLS policies). |
| `notifications` | In-app only (A-5). |
| `reviews` | Rating 1..5, comment, author/subject, `author_role`, author display-name snapshot. Unique per booking and author. |
| `reports` | Report-a-problem per booking. |
| `free_trial_claims` | `customer_id`, `booking_id`, `phone_hash`, `address_hash`, state. |
| `free_trial_blocks` | Log of blocked second-trial attempts for the admin list. T-042: `attempts` and `last_attempt_at`; repeated attempts by one customer for one reason inside an hour are counted in one row (`record_free_trial_block`). |

## Rules encoded in the database

- **One visit per chef per date (A-9):** unique index on `booking_days (chef_id, visit_date) where is_active`. A trigger sets `is_active` false when a booking becomes `declined`, `cancelled` or `expired` (T-042), so those never block; `requested`, `accepted`, `completed` and no-shows do (a pending request holds the date).
- **1 to 3 days:** `day_number` check 1..3, unique per booking. **Past date** rejected by trigger (Toronto time).
- **Booking insert rules (trigger):** chef must be `approved`; the location must be in the chef's `location_options`; `chef_home` also needs `chef_home_enabled`; the customer must have role `customer`; a chef's-home booking must have `est_travel_cents = 0`; customer cannot book themselves.
- **Free trial:** partial unique indexes on `free_trial_claims` for `customer_id`, `phone_hash` and `address_hash` where `state <> 'released'`. Releasing a claim (booking cancelled before it happened) frees the trial; `held` and `consumed` block. Which state to set is the API's job.
- **Role cannot be changed by a client** (trigger `guard_profile_update`). **Moderation fields** on `chefs` (`status`, `chef_home_enabled`, `rating_avg`, `review_count`) and `chef_private` (reject reason and all check statuses) can be changed only by an admin or the server. Since the T-032 migration **no client can insert, update or delete `dishes` or `availability` either** (grants revoked, own-row write policies dropped; routes validate and write with the service role). Since the T-028 migration **no client can update `profiles`, `chefs` or `chef_private` at all** (table `UPDATE` revoked, update policies dropped): the API routes write them with the service role. The triggers `guard_profile_update`, `guard_chef_update` and `guard_chef_private_update` remain as a second line of defence. Stored photo paths must start with the owner's folder (`chefs.photo_path`, `dishes.photo_path` check constraints). A verified phone hash can belong to one account only (unique partial index `profile_private_phone_hash_verified`).
- Chef `rating_avg` / `review_count` are recalculated by trigger from customer reviews.
- No-shows are statuses (`no_show_customer`, `no_show_chef`), not separate flags.

## Contact details and addresses (CLAUDE.md 6.8)

- Nobody can select another user's `profile_private`, `chef_private` or `booking_addresses` row.
- After a booking is `accepted` (and stays unlocked for `completed`, `no_show_*`), a party calls `get_booking_contact(booking_id)`:
  - Chef gets the customer's display name, phone and, for `customer_home`, the cooking address.
  - Customer gets the chef's display name, phone and, for `chef_home`, the kitchen address.
  - Before acceptance, for non-parties, for `declined` / `cancelled` / `requested`, it returns **no rows**. Hashes, documents and verification fields are never returned.
- The customer always sees their own address. The chef sees the intake form (allergies) before accepting.

## Policies per table

`SELECT` unless stated. "Admin" means `is_admin()`. Unlisted operations have no policy, so they are denied for clients.

| Table | Who | Rule |
|---|---|---|
| `postal_prefixes` | anon, authenticated | all rows |
| `profiles` | self | own row; **no client update** (routes write it, T-028) |
| | admin | all |
| | counterparty | profiles of the other party in any shared booking |
| `profile_private` | self, admin | own row / all. No client writes |
| `chefs` | anon, authenticated | rows with `status = 'approved'` only |
| | owner | own row (any status); **no client update** (routes write it, T-028) |
| | admin | all; **no client update** (admin routes use the service role) |
| | booking counterparty | the chef of a shared booking |
| `chef_private` | owner, admin | own row / all; **no client update** (routes write it, T-028) |
| `dishes` | anon, authenticated | active dishes of approved chefs |
| | owner | all own dishes (select only). **No client insert, update or delete** (routes write them, T-032); at most 50 active dishes per chef (trigger `dishes_active_cap`) |
| | admin | all |
| `availability` | anon, authenticated | rows of approved chefs |
| | owner | all own (select only). **No client insert, update or delete** (routes write them, T-032) |
| | admin | all |
| `bookings` | party | bookings where self is customer or chef. No client writes |
| | admin | all |
| `booking_addresses` | customer of the booking, admin | the chef has no table access (use `get_booking_contact`) |
| `booking_days`, `booking_day_dishes`, `intake_forms`, `receipts` | parties, admin | via the booking. No client writes |
| `messages` | parties, admin | read. Insert: `sender_id` = self, self is a party, booking status is `requested`, `accepted` or `completed` |
| `notifications` | owner | read own; update own, **`read_at` column only** (column grant) |
| `reviews` | anon, authenticated | customer-written reviews of an approved chef |
| | author or subject, admin | read |
| | insert | author = self, booking `completed`, self is a party, subject is the other party, `author_role` matches |
| `reports` | reporter, admin | read own / all |
| | insert | reporter = self, status `open`, no admin note, self is a party |
| | update | admin only |
| `free_trial_claims` | owner, admin | own / all. No client writes |
| `free_trial_blocks` | admin | all. No client writes |

## Storage

| Bucket | Public | Policies |
|---|---|---|
| `chef-documents` (ID, food handler; MOCK verification) | no | users with role `chef` may insert into folder `<own uid>/`; only admin can read or delete |
| `kitchen-photos` | **no** (decision D-10) | role `chef` may only **insert new objects** in `<own uid>/` (no update, no delete: migration `20261008150000_kitchen_photos_insert_only`, T-031 tester finding F3); the owner reads own; admin reads and deletes; the customer of an `accepted`/`completed`/no-show `chef_home` booking with that chef reads (`can_view_kitchen_photos`). The chef routes delete a removed photo with the service role |
| `profile-photos` | public URLs work, **no listing** | any signed-in user inserts, updates, deletes in `<own uid>/`; only the folder owner and admin can select through the API |
| `dish-photos` | public URLs work, **no listing** | same as profile photos, but only users with role `chef` may write; owner and admin can select |
| `receipts` | no | path `<booking id>/<file>`: the booking's chef may insert; both parties and admin may read |

Size limits 5 MB (photos) and 10 MB (documents, receipts); MIME types restricted. Anonymous users have no storage policies at all.

**Why kitchen photos are insert-only for the chef (T-031, F3).** A verified MOCK kitchen check refers to a path, and the N1 reset only fires when the stored path changes. If the chef could overwrite or delete an object in place, the picture could change under a `verified` check. Without update or delete rights a changed picture needs a new name, which is a path change, which resets the check and switches chef's home off. `chef-documents` was already insert-only for chefs.

**profile-photos and dish-photos stay owner-writable on purpose.** No verified check depends on those files, and a chef can already point a dish or profile row at a different new file at any time, so an in-place overwrite adds no power. Content moderation of public photos is a separate, later concern. T-032 decided: dishes and availability rows moved to routes (the route checks the photo path and that the object exists), but the dish-photos bucket stays owner-writable for the same reason. If photo cleanup moves to the server later, the owner delete policy can go too.

## Stored file paths (B2)

Trigger `chef_private_check_paths` requires `id_document_path`, `food_handler_path` and every entry of `kitchen_photo_paths` to start with `<chef id>/` (and contain no `..`), for every writer. Trigger `chef_private_reset_checks` would set a matching MOCK status back to `pending` when a non-admin client changes a verified document or the kitchen, but since T-028 clients cannot update `chef_private`, so it is **inert** (the server and admin never fire it). The chef routes (T-031) apply the N1 re-verification reset themselves (contract section 2): a changed ID or food-handler document sets that check from `verified` or `failed` to `pending` (a `failed` re-upload also goes to `pending`, Planner decision); changed kitchen photos or address set `kitchen_status` to `pending` (from `verified` or `failed`) and `chefs.chef_home_enabled` to false until an admin re-enables it. `not_started` and `pending` stay as they are. The `chef_private` write is conditional on `updated_at` (optimistic lock), so an admin verdict that lands mid-request cannot leave a changed file verified.

## Client insert columns

Clients may insert only these columns (column grants): `messages (booking_id, sender_id, body)`, `reviews (booking_id, author_id, subject_id, author_role, rating, comment)`, `reports (booking_id, reporter_id, category, description)`. `reports.category` is the enum `report_category`: safety, food_quality, no_show, payment, other.

## Why `phone_e164` is stored

CLAUDE.md 6.8 says each party sees the other's phone number once the booking is accepted, which a hash cannot provide. It lives only in `profile_private` (owner and admin read) and reaches the other party only through `get_booking_contact()` after acceptance. Display names never fall back to the email local part (default `New user`), because names appear in public reviews.

## Writing a new migration (checklist)

Default privileges are revoked for tables **and** functions in schema `public`, so a new object is unusable by clients until you say so.

1. New table: `enable row level security`, then `grant` the minimum privileges (column-level where possible) to `anon`/`authenticated`, then add explicit policies using `(select auth.uid())`. No policy means no access.
2. New function: it is not executable by anyone; `grant execute` only to the roles that need it. Security definer functions must set `search_path = ''` and schema-qualify everything.
3. Private data never goes in a publicly readable row; put it in an owner/admin-only table.
4. Add tests to the T-027 RLS suite for every new table, policy and function (allowed and denied cases), and update this page.

## Admin decision functions (T-035)

`admin_approve_chef(uuid)`, `admin_reject_chef(uuid, text)` and `admin_review_kitchen(uuid, text, text, text[], jsonb)` (migration `20261010120000`) make an admin decision one transaction: they lock the chef's `chefs` and `chef_private` rows (`for no key update`, always in that order), re-read everything, decide, write and insert the `notifications` row. They are `SECURITY INVOKER` with `search_path = ''`, EXECUTE only for `service_role`, and return jsonb `{ result: ... }`. The routes call them after checking `profiles.role = 'admin'`. Approve's completeness rules mirror `computeMissing()` and add "the stored file exists in `storage.objects`"; `tests/api/admin-chefs-decisions.test.ts` compares both lists. The RLS suite (`tests/rls/admin-decisions.test.ts`) checks that no browser role can call them.

## Booking API functions (T-042)

Migration `20261011100100_booking_api.sql`. All are `SECURITY INVOKER` with `search_path = ''`, `EXECUTE` for `service_role` only; the route checks who the caller is first. `tests/rls/booking-api.test.ts` checks the privileges.

| Function | What it does |
|---|---|
| `create_booking(p jsonb)` | One transaction: advisory lock per customer, open-request limit (D-28, counted without stale requests), `FOR SHARE` on the chef row and the chosen availability rows, then the booking (`is_free_trial` only together with its claim), address, days, dish snapshots with `eat_by_date`, intake form, free-trial claim and the chef's notification. Returns `ok`, `too_many_open`, `chef_not_bookable`, `date_too_soon` or `chef_unavailable`; a double booking (23505 on `booking_days_one_per_chef_date`) or a second free trial (23505 on a `free_trial_one_per_*` index) is raised, which rolls everything back. |
| `answer_booking(booking, chef, action, reason)` | Locks the booking row (`chef_id` must match), refuses anything but `requested`, turns an expired request into `expired` (returned, so it is saved), then accepts (chef must be approved) or declines (days freed by the existing trigger). Adds the customer's notification. |
| `expire_stale_bookings(user)` | One conditional UPDATE `requested` to `expired` for requests past `expires_at` (`null` user means everyone), a notification for both parties, and a `release` list of declined / expired bookings whose claim is still `held` (the route calls `applyFreeTrialEvent` for each). |
| `chef_remove_availability(chef, days)` | D-22: locks the chef's availability rows `FOR UPDATE`, refuses with the booked dates when a `requested` or `accepted` booking is on one of them, otherwise deletes. |
| `chef_booked_dates(chef, from, to)`, `chefs_booked_on(day)` | `SECURITY DEFINER`, open to everyone: dates (or chef ids) that have an active booking day, ignoring stale requests. They return nothing else. |
| `record_free_trial_block(customer, reason, window)` | Admin log: counts repeats in one row per customer and reason per window. |

Lock order: customer advisory lock, then the `chefs` row (`FOR SHARE`), then availability rows. An admin reject locks `chefs` then `chef_private`; no cycle.

## Known limits and notes for reviewers

- Admin can read messages (to review reports). Admin writes to moderation columns are allowed by policy and trigger; the server can do it too.
- `requested` bookings hold the chef's date until answered, declined, cancelled or expired. T-042 (D-19): an unanswered request expires at `expires_at` (the earlier of 72 hours after creation and 00:00 Toronto on day 1); expiry is lazy, see "Booking API functions" below.
- Hosted Supabase: the migrations are applied with `supabase db push` by the Planner after review, not by this task.
