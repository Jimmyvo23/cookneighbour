import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { loadBookingDetail } from "@/lib/server/booking-views";
import { requireBookingParty, sweepExpired } from "@/lib/server/bookings";

// GET /api/bookings/:id: one booking for its customer or its chef (contract 7A). Anyone else gets
// the same 404 as a missing booking. The other party's phone and the cooking address appear only
// once the booking is accepted.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await connection();
  return handle(async () => {
    const caller = await requireBookingParty();
    const { id } = await ctx.params;
    await sweepExpired(caller.admin, caller.userId);
    return json(await loadBookingDetail(caller.supabase, caller.userId, id));
  });
}
