-- T-101 (D-148, security review LOW-2): the chef reads a customer's allergy and dietary form only
-- while it is needed.
--   * The customer reads their own form at every status.
--   * The chef reads it while the request is open (`requested`, so the form can be read before
--     accepting, CLAUDE.md 6.7) and from acceptance until the D-52 contact window ends (00:00
--     Toronto on last visit day + 8, the same window get_booking_contact uses). Not after a
--     decline, cancel or expiry, and not after the window.
--   * Admin: unchanged (intake_forms_select_admin is not touched).
-- The check lives in a SECURITY DEFINER helper because booking_contact_open is not executable by
-- clients. Writers are unchanged (create_booking writes the form; clients have no write policy).
--
-- Hosted note: no data changes. Run `npx supabase db push` only with Jimmy's OK.

create function public.can_read_intake(p_booking uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking
      and (
        b.customer_id = (select auth.uid())
        or (
          b.chef_id = (select auth.uid())
          and (b.status = 'requested' or public.booking_contact_open(b.id, b.status))
        )
      )
  );
$$;
revoke execute on function public.can_read_intake(uuid) from public, anon;
grant execute on function public.can_read_intake(uuid) to authenticated;

drop policy intake_forms_select_party on public.intake_forms;
create policy intake_forms_select_party on public.intake_forms
  for select to authenticated using (public.can_read_intake(booking_id));
