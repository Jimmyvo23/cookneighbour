import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { requireBookingParty } from "@/lib/server/bookings";
import { getShoppingList } from "@/lib/server/groceries";

// GET /api/bookings/:id/shopping-list: the chef's shopping list for the booking's chosen dishes
// (grocery option A; the chef also uses it for option B). Customer or chef of the booking only.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await connection();
  return handle(async () => {
    const caller = await requireBookingParty();
    const { id } = await ctx.params;
    return json(await getShoppingList(caller, id));
  });
}
