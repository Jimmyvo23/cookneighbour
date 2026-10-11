import { handle, json } from "@/lib/api/errors";
import { requireJson } from "@/lib/api/request";
import { markPickupMissed } from "@/lib/server/booking-changes";
import { requireChefParty } from "@/lib/server/bookings";

// POST /api/bookings/:id/pickup/missed (D-29): after the eat-by deadline of a cooked day has
// passed, the chef closes a chef's-home booking as a customer no-show. Days not yet cooked are
// cancelled and the free trial is consumed. No body.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const caller = await requireChefParty();
    requireJson(request);
    const { id } = await ctx.params;
    return json(await markPickupMissed(caller, id));
  });
}
