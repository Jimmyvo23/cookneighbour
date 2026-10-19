-- T-046 (WO-5a): messaging backend. Jimmy's rules D-93 to D-96, Planner defaults A-33 and A-34.
--
--   * Sending is API only. The direct insert policy `messages_insert_party` and the client insert
--     grant on `messages` are gone, so the browser cannot skip the server checks (CLAUDE.md 6.8:
--     no phone numbers or addresses before acceptance).
--   * D-94: the chat of a declined, cancelled, expired or no-show (chef or customer) booking is
--     hidden from both parties: no read and no Realtime events. Requested, accepted and completed
--     bookings are open (completed stays open, D-52 and D-63). A `requested` booking whose expiry
--     time has passed but that the lazy sweep has not marked yet counts as expired (finding 4a).
--     The new helper `booking_chat_open` carries that rule; the party select policy uses it.
--     Realtime applies the same policy to every subscriber, so a hidden chat stops streaming.
--   * D-95 and A-34: the admin select policy is unchanged. The admin reads every chat and never
--     sends (the admin has no way to send: there is no insert path left, and send_message refuses
--     anyone who is not the booking's customer or chef).
--   * `send_message(booking, sender, client id, body)`: the only writer of `messages`. It locks the
--     booking row (FOR SHARE, so it takes turns with change_booking and answer_booking, which take
--     FOR UPDATE) and checks, in this order: sender is a party (else not_found); chat open (else
--     invalid_state / chat_hidden; this includes a stale request); not frozen (D-93, else
--     invalid_state / frozen); then the client message id. `messages.client_id` is unique per
--     sender, so a retried send returns the original row instead of a second one (T-075 INFO). A
--     client id already used for another booking or another text is invalid_state /
--     message_id_reused. The message and the D-96 notification are written in one transaction. A
--     retry writes no second notification.
--   * D-96 and A-33: every new message adds a `new_message` notification for the other party. Its
--     title and body never contain the message text, a name, a phone number or an address.
--   * Execute on `send_message` is for service_role only (the route calls it after its own checks,
--     with the sender id taken from the session). `booking_chat_open` is executable by
--     authenticated because the select policy runs as the caller.
--   * created_at uses clock_timestamp() (not the transaction start), so a page cursor on
--     (created_at, id) is less likely to skip a message that commits late.
--
-- Lock order: this function locks only the booking row, so it cannot deadlock with the
-- chef-first order used by answer_booking and admin_reject_chef.
-- MOCK: nothing here moves money or sends a real notification (the notification is a table row).

alter table public.messages add column client_id uuid;
comment on column public.messages.client_id is
  'Chosen by the sender''s browser for each message. Unique per sender, so a retry after a timeout returns the same row (T-075 INFO). Null only for rows made before T-046.';
-- Nulls are distinct in a unique index, so older rows without a client id do not clash.
create unique index messages_sender_client_id_key on public.messages (sender_id, client_id);

-- ---------------------------------------------------------------------------
-- D-94: which bookings have a chat the parties may read
-- ---------------------------------------------------------------------------
create or replace function public.booking_chat_open(p_booking uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
     where b.id = p_booking
       and b.status in ('requested', 'accepted', 'completed')
       and not (b.status = 'requested'
                and coalesce(b.expires_at, b.created_at + interval '72 hours') <= now())
  );
$$;
revoke execute on function public.booking_chat_open(uuid) from public, anon;
grant execute on function public.booking_chat_open(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies and grants
-- ---------------------------------------------------------------------------
drop policy messages_insert_party on public.messages;
revoke insert on public.messages from authenticated;
revoke insert (booking_id, sender_id, body) on public.messages from authenticated;

drop policy messages_select_party on public.messages;
create policy messages_select_party on public.messages
  for select to authenticated
  using (public.is_booking_party(booking_id) and public.booking_chat_open(booking_id));
-- messages_select_admin is unchanged (D-95): the admin reads every chat.

-- ---------------------------------------------------------------------------
-- send_message: the only writer
-- ---------------------------------------------------------------------------
create or replace function public.send_message(
  p_booking uuid, p_sender uuid, p_client_id uuid, p_body text
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  m public.messages%rowtype;
  v_other uuid;
begin
  if p_client_id is null or p_body is null or char_length(p_body) not between 1 and 2000 then
    raise exception 'invalid message' using errcode = '22023';
  end if;

  select * into b from public.bookings where id = p_booking for share;
  if not found or p_sender is null or p_sender not in (b.customer_id, b.chef_id) then
    return jsonb_build_object('result', 'not_found');
  end if;

  -- D-94, and finding 4a: a request that should have expired takes no messages.
  if b.status not in ('requested', 'accepted', 'completed')
     or (b.status = 'requested'
         and coalesce(b.expires_at, b.created_at + interval '72 hours') <= now()) then
    return jsonb_build_object('result', 'invalid_state', 'reason', 'chat_hidden');
  end if;

  -- D-93: a frozen booking has a read-only chat.
  if public.booking_is_frozen(b.id) then
    return jsonb_build_object('result', 'invalid_state', 'reason', 'frozen');
  end if;

  insert into public.messages (booking_id, sender_id, client_id, body, created_at)
  values (b.id, p_sender, p_client_id, p_body, clock_timestamp())
  on conflict (sender_id, client_id) do nothing
  returning * into m;

  if m.id is null then
    -- Same sender, same client id: a retry (or a clash). Read the first one.
    select * into m from public.messages where sender_id = p_sender and client_id = p_client_id;
    if m.booking_id <> b.id or m.body <> p_body then
      return jsonb_build_object('result', 'invalid_state', 'reason', 'message_id_reused');
    end if;
    return jsonb_build_object('result', 'ok', 'duplicate', true, 'message', to_jsonb(m));
  end if;

  v_other := case when p_sender = b.customer_id then b.chef_id else b.customer_id end;
  insert into public.notifications (user_id, booking_id, type, title, body)
  values (v_other, b.id, 'new_message', 'You have a new message',
          'A new message arrived on one of your bookings. Open the booking to read it.');

  return jsonb_build_object('result', 'ok', 'duplicate', false, 'message', to_jsonb(m));
end;
$$;
revoke execute on function public.send_message(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.send_message(uuid, uuid, uuid, text) to service_role;
