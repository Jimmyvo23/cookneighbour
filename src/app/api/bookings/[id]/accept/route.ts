import { handle, json } from "@/lib/api/errors";
import { requireJson } from "@/lib/api/request";
import { answerBooking, requireChefParty } from "@/lib/server/bookings";

// POST /api/bookings/:id/accept: the booking's chef accepts a `requested` booking (contract 7A).
// The body is ignored but the request must still say it is application/json (CSRF rule).
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const caller = await requireChefParty();
    requireJson(request);
    const { id } = await ctx.params;
    return json(await answerBooking(caller, id, "accept", null));
  });
}
