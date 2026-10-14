-- T-067 saved allergy profile (D-38). The customer's allergies and dietary notes are stored on
-- their own private profile row and prefill the booking intake form. A booking keeps its own copy
-- (intake_forms); this column is never read by a chef.
--
-- Privacy: profile_private is readable by its owner and by admin only (existing policies
-- profile_private_select_own / _select_admin) and has no client writes (no insert/update grant).
-- The API route is the only writer (service role), after validating with the same rules as the
-- booking intake (D-23). No new policy and no grant change is needed, and none is added.
-- Does not touch functions replaced by the T-066 migration.
alter table public.profile_private
  add column saved_intake jsonb
    constraint profile_private_saved_intake_object
    check (saved_intake is null or jsonb_typeof(saved_intake) = 'object'),
  add column saved_intake_at timestamptz;

comment on column public.profile_private.saved_intake is
  'Customer intake form (noAllergies, allergens, allergyNotes, noDietaryNeeds, dietaryNotes). Owner and admin read; server writes only.';
