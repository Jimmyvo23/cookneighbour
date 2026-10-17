-- T-082 (issue #150, D-76): the booking list says which bookings are frozen.
--
--   * get_bookings_frozen(bookings): the batch twin of get_booking_frozen (T-064, D-53). It takes
--     the ids of one list page and returns the ids that are frozen, so the list needs one call
--     instead of one per row. Parties only: an id the caller is not the customer or chef of is
--     never returned (an admin or stranger gets an empty set). It says nothing about the flag's
--     reason or about admin notes. At most 100 ids are looked at (a page is at most 50).
--   * No table, column or policy changes; booking_flags stays admin-only.
-- Lock order is not affected (read only).
-- MOCK: nothing here moves money.

create or replace function public.get_bookings_frozen(p_bookings uuid[]) returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select b.id
    from public.bookings b
   where b.id = any (coalesce(p_bookings[1:100], '{}'::uuid[]))
     and (select auth.uid()) in (b.customer_id, b.chef_id)
     and public.booking_is_frozen(b.id);
$$;
revoke execute on function public.get_bookings_frozen(uuid[]) from public, anon;
grant execute on function public.get_bookings_frozen(uuid[]) to authenticated;
