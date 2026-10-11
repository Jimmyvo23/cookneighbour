import { handle, json } from "@/lib/api/errors";
import { readOptionalJsonObject } from "@/lib/api/request";
import { cancelBooking } from "@/lib/server/booking-changes";
import { requireBookingParty } from "@/lib/server/bookings";

// POST /api/bookings/:id/cancel { reason? }: the customer (a `requested` or `accepted` booking) or
// the chef (an `accepted` booking) cancels. D-20 records on_time / late; D-26 decides the free
// trial from the cooked marker. The body is optional (contract 7A).
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const caller = await requireBookingParty();
    const body = await readOptionalJsonObject(request);
    const { id } = await ctx.params;
    return json(await cancelBooking(caller, id, body));
  });
}
