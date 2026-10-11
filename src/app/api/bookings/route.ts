import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { readJsonObject } from "@/lib/api/request";
import {
  listBookings,
  parseBookingListQuery,
} from "@/lib/server/booking-views";
import {
  createBooking,
  requireBookingParty,
  requireCustomer,
  sweepExpired,
} from "@/lib/server/bookings";

// GET /api/bookings: the caller's bookings (customer: as customer, chef: for them), newest first
// (contract 7A). Row-level security applies; lazy expiry runs first (D-19).
export async function GET(request: Request) {
  // Request-time data (cookies): keeps this route out of the build-time prerender.
  await connection();
  return handle(async () => {
    const caller = await requireBookingParty();
    const query = parseBookingListQuery(new URL(request.url).searchParams);
    await sweepExpired(caller.admin, caller.userId);
    return json(
      await listBookings(
        caller.supabase,
        caller.userId,
        caller.role as "customer" | "chef",
        query,
      ),
    );
  });
}

// POST /api/bookings: a customer asks a chef to cook for 1 to 3 days (contract 7A). The booking,
// its days, intake form, free-trial claim and the chef's notification are one transaction.
export function POST(request: Request) {
  return handle(async () => {
    const caller = await requireCustomer();
    const body = await readJsonObject(request);
    return json(await createBooking(caller, body), 201);
  });
}
