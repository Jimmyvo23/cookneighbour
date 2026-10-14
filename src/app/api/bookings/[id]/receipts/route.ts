import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { readJsonObject } from "@/lib/api/request";
import { requireBookingParty, requireChefParty } from "@/lib/server/bookings";
import { listReceipts, submitReceipt } from "@/lib/server/groceries";

// GET /api/bookings/:id/receipts: the booking's receipts (customer or chef of the booking only).
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await connection();
  return handle(async () => {
    const caller = await requireBookingParty();
    const { id } = await ctx.params;
    return json(await listReceipts(caller, id));
  });
}

// POST /api/bookings/:id/receipts: the booking's chef registers an uploaded receipt (grocery
// option B). MOCK: reimbursement is recorded, never collected.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const caller = await requireChefParty();
    const body = await readJsonObject(request);
    const { id } = await ctx.params;
    return json(await submitReceipt(caller, id, body), 201);
  });
}
