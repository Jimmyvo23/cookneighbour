import { handle, json } from "@/lib/api/errors";
import { requireJson } from "@/lib/api/request";
import { confirmPickup } from "@/lib/server/booking-changes";
import { requireCustomer } from "@/lib/server/bookings";

// POST /api/bookings/:id/days/:dayNumber/pickup/confirm (T-071, D-55): the customer of a
// chef's-home booking says "I picked up my meals" for one cooked day. No body; repeating is
// harmless. After this the chef cannot mark the pickup missed.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; dayNumber: string }> },
) {
  return handle(async () => {
    const caller = await requireCustomer();
    requireJson(request);
    const { id, dayNumber } = await ctx.params;
    return json(await confirmPickup(caller, id, dayNumber));
  });
}
