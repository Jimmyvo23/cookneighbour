// Server side of the chat routes (T-046, contract section 7C).
//
// Authorization (contract section 2): the role comes from profiles.role (requireBookingParty:
// customers and chefs; admins get 403 here, the admin reads chats through row-level security and
// never sends, D-95). The booking id is matched against the caller's OWN rows; someone else's
// booking and a missing one give the same 404, and the body is not looked at before that.
// Reads use the caller's user-scoped client, so the party select policy (D-94, Realtime uses the
// same one) is a second line of defence. Writing is the database function send_message only
// (service role): it re-checks party, status, expiry, freeze (D-93) and the client message id in
// one transaction and adds the D-96 notification (no message text in it, A-33).
import "server-only";
import { ApiFailure, validationFailed } from "@/lib/api/errors";
import type { MessageList, MessageView } from "@/lib/api/types";
import { isUuid } from "@/lib/domain/admin-chefs";
import {
  CONTACT_IN_CHAT_MESSAGE,
  MESSAGE_REFUSALS,
  contactBlockedBeforeAcceptance,
  isChatOpenStatus,
  parseMessageBody,
} from "@/lib/domain/messages";
import type { BookingCaller } from "@/lib/server/bookings";
import { sweepExpired } from "@/lib/server/bookings";
import { decodeListCursor, encodeListCursor } from "@/lib/server/booking-views";

type Row = Record<string, unknown>;

const notFound = () => new ApiFailure("NOT_FOUND", "Booking not found.");
const refusal = (reason: keyof typeof MESSAGE_REFUSALS) =>
  new ApiFailure("INVALID_STATE", MESSAGE_REFUSALS[reason], { reason });

const COLS = "id, booking_id, sender_id, client_id, body, created_at";

function view(r: Row, userId: string): MessageView {
  return {
    id: r.id as string,
    bookingId: r.booking_id as string,
    senderId: r.sender_id as string,
    mine: r.sender_id === userId,
    clientId: (r.client_id as string | null) ?? null,
    body: r.body as string,
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

/** The booking's status for its own customer or chef (RLS), after the lazy expiry sweep. */
async function loadStatus(caller: BookingCaller, id: string): Promise<string> {
  if (!isUuid(id)) throw notFound();
  await sweepExpired(caller.admin, caller.userId);
  const r = await caller.supabase
    .from("bookings")
    .select("customer_id, chef_id, status")
    .eq("id", id)
    .maybeSingle();
  if (r.error) throw new Error("booking lookup failed");
  const b = r.data as Row | null;
  // RLS also shows an admin every booking; never rely on the route's role check alone.
  if (!b || (b.customer_id !== caller.userId && b.chef_id !== caller.userId))
    throw notFound();
  return b.status as string;
}

export function parseMessageListQuery(params: URLSearchParams) {
  const errors: Record<string, string> = {};
  const one = (k: string): string => {
    const all = params.getAll(k);
    if (all.length > 1) {
      errors[k] = "Send this only once.";
      return "";
    }
    return (all[0] ?? "").trim();
  };
  let limit = 20;
  const l = one("limit");
  if (l && !errors.limit) {
    if (!/^\d{1,3}$/.test(l) || Number(l) < 1 || Number(l) > 50)
      errors.limit = "Use a whole number from 1 to 50.";
    else limit = Number(l);
  }
  let cursor: ReturnType<typeof decodeListCursor> = null;
  const c = one("cursor");
  if (c && !errors.cursor) {
    cursor = decodeListCursor(c);
    if (!cursor) errors.cursor = "That page marker is not valid.";
  }
  for (const k of new Set(params.keys()))
    if (k !== "limit" && k !== "cursor") errors[k] = "Unknown parameter.";
  if (Object.keys(errors).length) throw validationFailed(errors);
  return { limit, cursor };
}

// GET /api/bookings/:id/messages: oldest first, keyset on (created_at, id).
export async function listMessages(
  caller: BookingCaller,
  id: string,
  params: URLSearchParams,
): Promise<MessageList> {
  const status = await loadStatus(caller, id);
  const q = parseMessageListQuery(params);
  if (!isChatOpenStatus(status)) throw refusal("chat_hidden");
  let req = caller.supabase.from("messages").select(COLS).eq("booking_id", id);
  if (q.cursor) {
    // Both values passed the strict checks in decodeListCursor (a timestamp and a uuid); still quoted.
    req = req.or(
      `created_at.gt."${q.cursor.c}",and(created_at.eq."${q.cursor.c}",id.gt.${q.cursor.i})`,
    );
  }
  const res = await req
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(q.limit + 1);
  if (res.error) throw new Error("messages read failed");
  const rows = (res.data ?? []) as Row[];
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => view(r, caller.userId)),
    nextCursor:
      rows.length > q.limit && last
        ? encodeListCursor(last.created_at as string, last.id as string)
        : null,
  };
}

// POST /api/bookings/:id/messages
export async function sendMessage(
  caller: BookingCaller,
  id: string,
  body: Record<string, unknown>,
): Promise<{ message: MessageView; duplicate: boolean }> {
  const status = await loadStatus(caller, id);
  const parsed = parseMessageBody(body);
  if (!parsed.ok) throw validationFailed(parsed.fields);
  // CLAUDE.md 6.8: no phone numbers or addresses before acceptance (best effort, see contactDetails.ts).
  if (contactBlockedBeforeAcceptance(status, parsed.text))
    throw new ApiFailure(
      "CONTACT_DETAILS_NOT_ALLOWED",
      CONTACT_IN_CHAT_MESSAGE,
      {
        fields: { body: "Remove phone numbers, email addresses and links." },
      },
    );
  const r = await caller.admin.rpc("send_message", {
    p_booking: id,
    p_sender: caller.userId,
    p_client_id: parsed.clientId,
    p_body: parsed.text,
  });
  if (r.error) throw new Error(`send_message failed: ${r.error.message}`);
  const out = r.data as Row;
  switch (out.result) {
    case "ok":
      return {
        message: view(out.message as Row, caller.userId),
        duplicate: out.duplicate === true,
      };
    case "not_found":
      throw notFound();
    case "invalid_state":
      if (
        out.reason === "chat_hidden" ||
        out.reason === "frozen" ||
        out.reason === "message_id_reused"
      )
        throw refusal(out.reason);
      throw new Error("send_message returned an unknown reason");
    default:
      throw new Error("send_message returned an unknown result");
  }
}
