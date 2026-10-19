import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { limiterKey, rateLimit } from "@/lib/api/rate-limit";
import { readJsonObject } from "@/lib/api/request";
import { MESSAGE_RATE_LIMIT } from "@/lib/domain/messages";
import { requireBookingParty } from "@/lib/server/bookings";
import { listMessages, sendMessage } from "@/lib/server/messages";

// GET /api/bookings/:id/messages: the chat of a booking, oldest first (contract 7C). Customer or
// chef of the booking only; a hidden chat (D-94) answers 409 `chat_hidden`.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await connection();
  return handle(async () => {
    const caller = await requireBookingParty();
    const { id } = await ctx.params;
    return json(
      await listMessages(caller, id, new URL(request.url).searchParams),
    );
  });
}

// POST /api/bookings/:id/messages: send a message (customer or chef of the booking). Rate limited
// (placeholder limiter). Before acceptance a message with a phone number, email or link is 422.
// 201 for a new message, 200 when the same clientId is sent again (returns the first row).
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const caller = await requireBookingParty();
    rateLimit(
      limiterKey("message", caller.userId),
      MESSAGE_RATE_LIMIT.limit,
      MESSAGE_RATE_LIMIT.windowSeconds,
    );
    const body = await readJsonObject(request);
    const { id } = await ctx.params;
    const out = await sendMessage(caller, id, body);
    return json(out.message, out.duplicate ? 200 : 201);
  });
}
