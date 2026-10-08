-- T-032 dishes and availability API. Routes become the only writers of dishes and availability
-- (API contract section 2, same approach as decision D-12 for chefs). Applied after review; do not
-- edit once applied.

-- 1. Clients can no longer write these tables. The routes validate bounds, unsafe text, photo path
--    ownership and object existence, and the date window with the service role. The select policies
--    (public: active dishes / availability of approved chefs; own; admin) are unchanged.
revoke insert, update, delete on public.dishes, public.availability from authenticated;
drop policy dishes_insert_own on public.dishes;
drop policy dishes_update_own on public.dishes;
drop policy dishes_delete_own on public.dishes;
drop policy availability_insert_own on public.availability;
drop policy availability_update_own on public.availability;
drop policy availability_delete_own on public.availability;

-- 2. At most 50 active dishes per chef (ASSUMPTION, mirrors MAX_ACTIVE_DISHES in
--    src/lib/domain/dishes.ts). A trigger under a per-chef advisory lock, so parallel creates and
--    reactivations cannot both pass a count taken before either insert. SQLSTATE 54000
--    (program_limit_exceeded) lets the route answer 409 INVALID_STATE.
create function public.dishes_active_cap() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_active then
    perform pg_advisory_xact_lock(hashtextextended(new.chef_id::text, 0));
    if (select count(*) from public.dishes d
        where d.chef_id = new.chef_id and d.is_active and d.id <> new.id) >= 50 then
      raise exception 'too many active dishes' using errcode = '54000';
    end if;
  end if;
  return new;
end;
$$;
create trigger dishes_active_cap before insert or update of is_active, chef_id on public.dishes
  for each row execute function public.dishes_active_cap();
-- Trigger functions are not callable by clients (the RLS suite snapshots function privileges).
revoke execute on function public.dishes_active_cap() from public, anon, authenticated;
