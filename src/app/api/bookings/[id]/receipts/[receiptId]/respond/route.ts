import { handle, json } from "@/lib/api/errors";
import { readJsonObject } from "@/lib/api/request";
import { requireCustomer } from "@/lib/server/bookings";
import { answerReceipt } from "@/lib/server/groceries";

// POST /api/bookings/:id/receipts/:receiptId/respond: the booking's customer confirms or disputes
// a receipt. MOCK: nothing is charged.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; receiptId: string }> },
) {
  return handle(async () => {
    const caller = await requireCustomer();
    const body = await readJsonObject(request);
    const { id, receiptId } = await ctx.params;
    return json(await answerReceipt(caller, id, receiptId, body));
  });
}
