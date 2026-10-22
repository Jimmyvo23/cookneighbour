-- T-102 (security review LOW-3 and LOW-5). Applied after review; do not edit once applied.
--
-- LOW-3: `handle_new_user` only trimmed the display name and cut it to 80 characters, so a direct
-- call to Supabase Auth (/auth/v1/signup) skipped the app's name rules. The trigger now applies the
-- same rules as the sign-up route (src/lib/domain/text-fold.ts, contactDetails.ts) as far as SQL can:
--   - 1 to 80 UTF-16 units (a character outside the BMP counts as 2, like JavaScript's .length);
--   - no control characters, no bidi controls, zero-width space, word joiner or BOM (ZWNJ and ZWJ stay allowed);
--   - at least one visible character after the fold (NFKC, invisible characters, accents removed);
--   - no email, web address or North American phone number (same shapes as findContactDetails).
-- A blank name still becomes 'New user' (unchanged). A name that breaks a rule makes the whole
-- sign-up fail (error 22023): refuse, never store a changed name. A lone UTF-16 surrogate cannot
-- exist in a Postgres text value, so that rule needs no SQL.
-- Known gaps (documented in docs/security-review.md follow-up and the handoff): Postgres `\s`
-- and JavaScript `trim()` differ on a few exotic spaces; the contact filter is best effort, like
-- the app's. The app route also rejects contact details in a name now, so normal users see a 422.
--
-- LOW-5: profile-photos and dish-photos were owner-writable in place (update and delete), so an
-- approved photo could be replaced at the same path, and any signed-in account could upload to
-- profile-photos. Now both buckets are insert-only for the owner (a new path per file; the routes
-- delete old files with the service role) and only chefs may upload to profile-photos.

create function public.display_name_problem(p_name text) returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  t text := regexp_replace(p_name, '^[\s   -     　﻿]+|[\s   -     　﻿]+$', '', 'g');
  f text;
  run text;
  digits text;
  units int;
begin
  units := char_length(t) + char_length(regexp_replace(t, '[^\U00010000-\U0010ffff]', '', 'g'));
  if units > 80 then return 'too_long'; end if;
  if t ~ '[\u0001-\u001f\u007f]' then return 'control_characters'; end if;
  if t ~ '[‪-‮⁦-⁩​⁠﻿]' then return 'invisible_characters'; end if;

  -- fold: NFKC, drop invisible characters, d with stroke to d, drop accents (same as foldText)
  f := normalize(t, NFKC);
  f := regexp_replace(f, '[‪-‮⁦-⁩​-‍⁠﻿]', '', 'g');
  f := replace(replace(f, 'đ', 'd'), 'Đ', 'D');
  f := regexp_replace(normalize(f, NFD), '[̀-ͯ]', '', 'g');
  f := normalize(f, NFC);
  if regexp_replace(f, '^[\s   -     　]+|[\s   -     　]+$', '', 'g') = '' then
    return 'no_visible_character';
  end if;

  -- contact details (same shapes as findContactDetails; look-alike dashes become '-')
  f := regexp_replace(f, '[‐-―−]', '-', 'g');
  if f ~ '[^\s@]+@[^\s@]+\.[^\s@]+' then return 'contact_details'; end if;
  -- JavaScript's \b is ASCII only and Postgres's \m and \M are Unicode aware, so the word boundaries
  -- are spelled out with ASCII classes to give the same answer as the app (T-102 tester F-1).
  -- A host name may start with a letter or digit after a non-word character, or (JavaScript quirk:
  -- \b sits between a word character and a hyphen) with a hyphen right after a word character.
  if f ~* '(^|[^a-zA-Z0-9_])(https?://|www\.)[^\s]+|(^|[^a-zA-Z0-9_])[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(com|ca|org|net|io|me|co|app|info|ly|gl)($|[^a-zA-Z0-9_])|[a-zA-Z0-9_]-[a-z0-9-]*(\.[a-z0-9-]+)*\.(com|ca|org|net|io|me|co|app|info|ly|gl)($|[^a-zA-Z0-9_])' then
    return 'contact_details';
  end if;
  f := regexp_replace(f, '\m[0-9]{4}-[0-9]{2}-[0-9]{2}\M', ' ', 'g');
  for run in select m[1] from regexp_matches(f, '(\+?[0-9(][0-9\s.()-]*[0-9])', 'g') as m loop
    digits := regexp_replace(run, '[^0-9]', '', 'g');
    if char_length(digits) = 10 or (char_length(digits) = 11 and digits like '1%') then
      return 'contact_details';
    end if;
    if run ~ '(^|[^0-9])(1[\s.-]*)?\(?[0-9]{3}\)?[\s.-]*[0-9]{3}[\s.-]*[0-9]{4}($|[^0-9])' then
      return 'contact_details';
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.display_name_problem(text) from public, anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');
  v_problem text;
begin
  if v_name is not null then
    v_problem := public.display_name_problem(v_name);
    if v_problem is not null then
      -- No name or value in the message: it is shown to the caller as a generic sign-up error.
      raise exception 'invalid display name (%)', v_problem using errcode = '22023';
    end if;
  end if;
  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    case when new.raw_user_meta_data ->> 'role' = 'chef' then 'chef'::public.user_role
         else 'customer'::public.user_role end,
    -- Never derive a name from the email: local parts are often real names and would leak into public reviews.
    coalesce(v_name, 'New user')
  );
  insert into public.profile_private (profile_id) values (new.id);
  return new;
end;
$$;

-- LOW-5: insert-only owner policies on the public photo buckets, chefs only for profile photos.
drop policy profile_photos_update_own on storage.objects;
drop policy profile_photos_delete_own on storage.objects;
drop policy dish_photos_update_own on storage.objects;
drop policy dish_photos_delete_own on storage.objects;
drop policy profile_photos_insert_own on storage.objects;
create policy profile_photos_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-photos'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select public.is_chef()));
