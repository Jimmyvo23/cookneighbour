import { handle, json } from "@/lib/api/errors";
import { requireJson } from "@/lib/api/request";
import { completeVisit } from "@/lib/server/booking-changes";
import { requireChefParty } from "@/lib/server/bookings";

// POST /api/bookings/:id/complete: the chef marks "visit done" (D-33) once every day is cooked.
// Without this the booking completes by itself after the last day (lazy sweep). No body.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const caller = await requireChefParty();
    requireJson(request);
    const { id } = await ctx.params;
    return json(await completeVisit(caller, id));
  });
}
