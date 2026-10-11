import { handle, json } from "@/lib/api/errors";
import { readJsonObject } from "@/lib/api/request";
import { answerBooking, requireChefParty } from "@/lib/server/bookings";

// POST /api/bookings/:id/decline: the booking's chef declines a `requested` booking, with a
// required reason (D-34, contract 7A) that must not contain contact details. The dates are freed and the free-trial claim is released.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const caller = await requireChefParty();
    const body = await readJsonObject(request);
    const { id } = await ctx.params;
    return json(await answerBooking(caller, id, "decline", body));
  });
}
