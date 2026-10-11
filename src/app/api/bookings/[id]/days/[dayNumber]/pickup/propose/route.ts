import { handle, json } from "@/lib/api/errors";
import { readJsonObject } from "@/lib/api/request";
import { proposePickup } from "@/lib/server/booking-changes";
import { requireCustomer } from "@/lib/server/bookings";

// POST /api/bookings/:id/days/:dayNumber/pickup/propose { proposedAt } (D-29): the customer of a
// chef's-home booking proposes a new pickup time, no later than the end of the earliest eat-by
// date of that day's meals.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; dayNumber: string }> },
) {
  return handle(async () => {
    const caller = await requireCustomer();
    const body = await readJsonObject(request);
    const { id, dayNumber } = await ctx.params;
    return json(await proposePickup(caller, id, dayNumber, body));
  });
}
