import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { readJsonObject, requireJson } from "@/lib/api/request";
import { requireBookingParty } from "@/lib/server/bookings";
import { createReview, getBookingReviews } from "@/lib/server/reviews";

// GET /api/bookings/:id/reviews: the caller's review, the one about them, and whether they may
// write one now (contract 7D). Customer or chef of the booking only; the admin gets 403.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await connection();
  return handle(async () => {
    const caller = await requireBookingParty();
    const { id } = await ctx.params;
    return json(await getBookingReviews(caller, id));
  });
}

// POST /api/bookings/:id/reviews { rating, comment? }: 201, or 200 when the same review is sent
// again (retry). A review is final once posted.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const caller = await requireBookingParty();
    requireJson(request);
    const { id } = await ctx.params;
    const out = await createReview(caller, id, () => readJsonObject(request));
    return json(out.review, out.duplicate ? 200 : 201);
  });
}
