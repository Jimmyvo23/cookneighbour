import { handle, json } from "@/lib/api/errors";
import { readJsonObject } from "@/lib/api/request";
import { respondPickup } from "@/lib/server/booking-changes";
import { requireChefParty } from "@/lib/server/bookings";

// POST /api/bookings/:id/days/:dayNumber/pickup/respond { accept } (D-29): the chef accepts or
// declines the customer's open pickup proposal for that day. After a decline the customer may
// propose again until the meals' eat-by deadline.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; dayNumber: string }> },
) {
  return handle(async () => {
    const caller = await requireChefParty();
    const body = await readJsonObject(request);
    const { id, dayNumber } = await ctx.params;
    return json(await respondPickup(caller, id, dayNumber, body));
  });
}
