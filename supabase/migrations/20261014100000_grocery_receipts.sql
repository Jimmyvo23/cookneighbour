-- T-044: grocery option B receipts. New migration; earlier migrations are not edited.
--
--   * receipts: superseded_at (a disputed receipt is replaced by a new one, never edited),
--     customer_disputed_at, dispute_note (the customer's "this is wrong"). A path is registered
--     once (unique file_path = insert-only, a new name per upload). At most ONE current receipt per
--     booking (partial unique index).
--   * submit_receipt(booking, chef, path, amount, mismatch): the chef registers an uploaded receipt.
--     The booking row is locked FOR UPDATE, then status (accepted or completed), the grocery option
--     (chef_shops) and "no current receipt, or the current one was disputed" are re-checked under
--     that lock and the write is one transaction. The mismatch flag is computed by the route with
--     the domain rule (A-15, src/lib/domain/receipt.ts) from the immutable estimate snapshot.
--   * answer_receipt(booking, customer, receipt, action, note): the customer confirms or disputes.
--     One conditional UPDATE (... where not yet answered and not superseded), so two answers, or an
--     answer racing a replacement, cannot both win.
--   * Storage: the receipts bucket accepts an upload only while the booking is accepted or
--     completed (earlier policy: any status). There is still no update or delete policy for
--     clients, so an object can never be overwritten.
--
-- Lock order: the booking row only (no chef row), so no deadlock with change_booking / answer_booking.
-- All writers are SECURITY INVOKER with search_path = '' and service_role only.
-- MOCK: nothing here moves money. "Reimbursement at cost" is only recorded, never collected.

alter table public.receipts
  add column superseded_at timestamptz,
  add column customer_disputed_at timestamptz,
  add column dispute_note text check (dispute_note is null or char_length(dispute_note) between 3 and 300),
  add constraint receipts_not_both_answers
    check (customer_confirmed_at is null or customer_disputed_at is null),
  add constraint receipts_file_path_unique unique (file_path);

create unique index receipts_one_current_per_booking
  on public.receipts (booking_id) where superseded_at is null;

create function public.submit_receipt(
  p_booking uuid, p_chef uuid, p_path text, p_amount integer, p_mismatch boolean
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  b public.bookings;
  v_current public.receipts;
  v_id uuid;
begin
  select * into b from public.bookings where id = p_booking and chef_id = p_chef for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if b.grocery_option <> 'chef_shops' then
    return jsonb_build_object('result', 'invalid_state', 'reason', 'not_chef_shops');
  end if;
  if b.status not in ('accepted', 'completed') then
    return jsonb_build_object('result', 'invalid_state', 'reason', 'wrong_status');
  end if;
  select * into v_current from public.receipts
    where booking_id = b.id and superseded_at is null;
  if found then
    if v_current.customer_disputed_at is null then
      return jsonb_build_object('result', 'invalid_state',
        'reason', case when v_current.customer_confirmed_at is null then 'receipt_waiting' else 'receipt_confirmed' end);
    end if;
  end if;
  begin
    -- inside the block: if the new path was used before, the old receipt is NOT superseded
    if v_current.id is not null then
      update public.receipts set superseded_at = now() where id = v_current.id;
    end if;
    insert into public.receipts (booking_id, uploaded_by, file_path, amount_cents, currency, mismatch_flagged)
    values (b.id, p_chef, p_path, p_amount, b.currency, p_mismatch)
    returning id into v_id;
  exception when unique_violation then
    -- the same object path was registered before: a new name is needed per upload
    return jsonb_build_object('result', 'invalid_state', 'reason', 'path_used');
  end;
  insert into public.notifications (user_id, booking_id, type, title, body)
  values (b.customer_id, b.id, 'receipt_uploaded', 'A grocery receipt is waiting for you',
          case when p_mismatch then 'The chef uploaded a receipt that differs from the estimate. Please check it.'
               else 'The chef uploaded a grocery receipt. Please confirm it.' end);
  return jsonb_build_object('result', 'ok', 'receipt_id', v_id);
end;
$$;

create function public.answer_receipt(
  p_booking uuid, p_customer uuid, p_receipt uuid, p_action text, p_note text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  b public.bookings;
  r public.receipts;
  v_n integer;
begin
  if p_action not in ('confirm', 'dispute') then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  select * into b from public.bookings where id = p_booking and customer_id = p_customer for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  select * into r from public.receipts where id = p_receipt and booking_id = b.id;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if b.status not in ('accepted', 'completed') then
    return jsonb_build_object('result', 'invalid_state', 'reason', 'wrong_status');
  end if;
  -- check and write in one conditional statement
  update public.receipts set
    customer_confirmed_at = case when p_action = 'confirm' then now() end,
    customer_disputed_at = case when p_action = 'dispute' then now() end,
    dispute_note = case when p_action = 'dispute' then p_note end
  where id = r.id and superseded_at is null
    and customer_confirmed_at is null and customer_disputed_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('result', 'invalid_state',
      'reason', case when r.superseded_at is not null then 'receipt_superseded' else 'already_answered' end);
  end if;
  insert into public.notifications (user_id, booking_id, type, title, body)
  values (b.chef_id, b.id,
          case when p_action = 'confirm' then 'receipt_confirmed' else 'receipt_disputed' end,
          case when p_action = 'confirm' then 'The customer confirmed your receipt'
               else 'The customer disputed your receipt' end,
          case when p_action = 'confirm' then 'The grocery cost will be reimbursed at cost (MOCK: nothing is charged).'
               else 'Please upload a corrected receipt.' end);
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke execute on function public.submit_receipt(uuid, uuid, text, integer, boolean) from public, anon, authenticated;
revoke execute on function public.answer_receipt(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_receipt(uuid, uuid, text, integer, boolean) to service_role;
grant execute on function public.answer_receipt(uuid, uuid, uuid, text, text) to service_role;

-- Storage: uploads only while the booking is accepted or completed.
create function public.booking_accepts_receipts(p_booking uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking and b.chef_id = (select auth.uid())
      and b.status in ('accepted', 'completed')
  );
$$;
revoke execute on function public.booking_accepts_receipts(uuid) from public, anon, authenticated;
grant execute on function public.booking_accepts_receipts(uuid) to authenticated;

drop policy receipts_insert_chef on storage.objects;
create policy receipts_insert_chef on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and public.booking_accepts_receipts(public.storage_booking_id(name)));
