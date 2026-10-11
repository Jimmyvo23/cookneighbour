import { handle, json } from "@/lib/api/errors";
import { requireJson } from "@/lib/api/request";
import { markDayCooked } from "@/lib/server/booking-changes";
import { requireChefParty } from "@/lib/server/bookings";

// POST /api/bookings/:id/days/:dayNumber/cooked: the chef marks one visit as cooked (the D-26
// marker). From the visit date on; repeating it is harmless. No body.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; dayNumber: string }> },
) {
  return handle(async () => {
    const caller = await requireChefParty();
    requireJson(request);
    const { id, dayNumber } = await ctx.params;
    return json(await markDayCooked(caller, id, dayNumber));
  });
}
