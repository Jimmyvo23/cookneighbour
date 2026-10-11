import { handle, json } from "@/lib/api/errors";
import { requireJson } from "@/lib/api/request";
import { reportNoShow } from "@/lib/server/booking-changes";
import { requireBookingParty } from "@/lib/server/bookings";

// POST /api/bookings/:id/no-show: a chef caller reports the customer (`no_show_customer`), a
// customer caller reports the chef (`no_show_chef`). Only for an `accepted` booking with a visit
// whose date has come and that was not cooked. No body (still application/json).
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const caller = await requireBookingParty();
    requireJson(request);
    const { id } = await ctx.params;
    return json(await reportNoShow(caller, id));
  });
}
