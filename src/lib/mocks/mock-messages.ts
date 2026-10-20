// MOCK CHAT ROUTES (T-046). Stand in for docs/api-contract.md section 7C
// (GET and POST /api/bookings/:id/messages) so the chat UI (T-047) can be built before the browser
// talks to the real routes. Nothing here is real: messages live in this browser tab only
// (sessionStorage), nobody else ever sees them, and no notification is created.
//
// The rules are the real pure functions in src/lib/domain/messages.ts (body shape, contact check
// before acceptance, refusal texts) so the mock cannot drift from the server.
// Differences from the real API, on purpose:
//   - the first time a chat with no messages is read, one made-up greeting from the other party is
//     added, so the UI has something to show (MOCK; a real chat starts empty);
//   - the cursor is an index, not a (time, id) pair, but it is just as opaque to the UI;
//   - test hook hooks.messagesRateLimited = true makes the next send answer 429 (retry 30 s);
//     hooks.messagesFailNext = true makes the next send answer a generic 500, once (T-047).
// The frozen state comes from `BookingDetail.frozen` (hooks.frozenSeeded in mock-bookings.ts).
import type { MessageView } from "@/lib/api/types";
import {
  CONTACT_IN_CHAT_MESSAGE,
  MESSAGE_REFUSALS,
  contactBlockedBeforeAcceptance,
  isChatOpenStatus,
  parseMessageBody,
} from "@/lib/domain/messages";
import {
  UUID,
  fail,
  json,
  notFound,
  type BookingMockState,
  type BookingRouteResult,
} from "@/lib/mocks/mock-bookings";

/** A MOCK message as saved (the view without `mine`, which depends on who is looking). */
export type MockMessage = Omit<MessageView, "mine">;

const GREETING = "Hello! Thank you for the booking. (MOCK message)";

export function messageRoute(
  method: string,
  path: string,
  body: unknown,
  s: BookingMockState,
  role: "customer" | "chef",
  now: Date = new Date(),
): BookingRouteResult | null {
  const url = new URL(path, "http://mock.invalid");
  const m = /^\/api\/bookings\/([^/]+)\/messages$/.exec(url.pathname);
  if (!m) return null;
  if (method !== "GET" && method !== "POST")
    return fail(404, "NOT_FOUND", "Not found.");

  const key = role === "chef" ? "chefBookings" : "bookings";
  const id = m[1];
  const row = UUID.test(id)
    ? (s[key] ?? []).find((x) => x.detail.id === id)
    : undefined;
  if (!row) return notFound();
  const d = row.detail;
  const me = s.profile!.id;
  const other = role === "chef" ? d.customer : d.chef;
  const all = s.messages ?? {};
  let list: MockMessage[] = all[id] ?? [];
  const mine = (x: MockMessage): MessageView => ({
    ...x,
    mine: x.senderId === me,
  });
  // A request past its expiry is hidden even if the sweep has not marked it yet (finding 4a).
  const hidden =
    !isChatOpenStatus(d.status) ||
    (d.status === "requested" &&
      d.expiresAt !== null &&
      new Date(d.expiresAt).getTime() <= now.getTime());
  const refuse = (reason: keyof typeof MESSAGE_REFUSALS) =>
    fail(409, "INVALID_STATE", MESSAGE_REFUSALS[reason], { reason });

  if (method === "GET") {
    const limitRaw = url.searchParams.get("limit");
    const cursorRaw = url.searchParams.get("cursor");
    const errors: Record<string, string> = {};
    // Like the real route: a value sent twice, or any other parameter, is 422.
    for (const k of new Set(url.searchParams.keys()))
      if (k !== "limit" && k !== "cursor") errors[k] = "Unknown parameter.";
      else if (url.searchParams.getAll(k).length > 1)
        errors[k] = "Send this only once.";
    let limit = 20;
    if (limitRaw !== null && !errors.limit) {
      if (!/^\d{1,3}$/.test(limitRaw) || +limitRaw < 1 || +limitRaw > 50)
        errors.limit = "Use a whole number from 1 to 50.";
      else limit = +limitRaw;
    }
    let from = 0;
    if (cursorRaw !== null && !errors.cursor) {
      const c = /^m(\d{1,6})$/.exec(cursorRaw);
      if (!c) errors.cursor = "That page marker is not valid.";
      else from = +c[1];
    }
    if (Object.keys(errors).length)
      return fail(422, "VALIDATION_FAILED", "Check the highlighted fields.", {
        fields: errors,
      });
    if (hidden) return refuse("chat_hidden");
    let next: BookingRouteResult["next"];
    if (list.length === 0) {
      list = [
        {
          id: `00000000-0000-4000-8000-${id.slice(-12)}`,
          bookingId: id,
          senderId: other.id,
          clientId: null,
          body: GREETING,
          createdAt: new Date(d.createdAt).toISOString(),
        },
      ];
      next = { messages: { ...all, [id]: list } };
    }
    const page = list.slice(from, from + limit);
    return {
      res: json(200, {
        items: page.map(mine),
        nextCursor: from + limit < list.length ? `m${from + limit}` : null,
      }),
      next,
    };
  }

  // POST
  if (s.hooks.messagesRateLimited)
    return {
      res: new Response(
        JSON.stringify({
          error: {
            code: "RATE_LIMITED",
            message: "Too many attempts. Please try again later.",
            retryAfterSeconds: 30,
          },
        }),
        {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "30" },
        },
      ),
      next: { hooks: { ...s.hooks, messagesRateLimited: false } },
    };
  if (s.hooks.messagesFailNext)
    return {
      res: json(500, {
        error: {
          code: "INTERNAL",
          message: "Something went wrong on our side. Please try again.",
        },
      }),
      next: { hooks: { ...s.hooks, messagesFailNext: false } },
    };
  const parsed = parseMessageBody(
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {},
  );
  if (!parsed.ok)
    return fail(422, "VALIDATION_FAILED", "Check the highlighted fields.", {
      fields: parsed.fields,
    });
  if (contactBlockedBeforeAcceptance(d.status, parsed.text))
    return fail(422, "CONTACT_DETAILS_NOT_ALLOWED", CONTACT_IN_CHAT_MESSAGE, {
      fields: { body: "Remove phone numbers, email addresses and links." },
    });
  if (hidden) return refuse("chat_hidden");
  if (d.frozen) return refuse("frozen");
  // The client id is unique per sender across ALL bookings (like the database index).
  const used = Object.values(all)
    .flat()
    .find((x) => x.senderId === me && x.clientId === parsed.clientId);
  if (used) {
    if (used.bookingId !== id || used.body !== parsed.text)
      return refuse("message_id_reused");
    return { res: json(200, mine(used)) };
  }
  const made: MockMessage = {
    id: crypto.randomUUID(),
    bookingId: id,
    senderId: me,
    clientId: parsed.clientId,
    body: parsed.text,
    createdAt: new Date().toISOString(),
  };
  return {
    res: json(201, mine(made)),
    next: { messages: { ...all, [id]: [...list, made] } },
  };
}
