// The booking of a party, for the review and report routes (T-048). The booking is read with the
// caller's own session (row-level security applies), then matched against the caller's id again:
// someone else's booking, a missing one and an admin all give the same 404 (the routes already
// answered 403 to the admin role). The lazy sweeps run first, so a booking that is due is
// `completed` when the caller looks.
import "server-only";
import { ApiFailure } from "@/lib/api/errors";
import { isUuid } from "@/lib/domain/admin-chefs";
import { sweepExpired, type BookingCaller } from "@/lib/server/bookings";

export interface PartyBooking {
  id: string;
  customerId: string;
  chefId: string;
  status: string;
  /** completed_at, or updated_at for a completed booking without it (as the review policy does). */
  completedAt: string | null;
  /** The other party's profile id. */
  otherId: string;
}

export const bookingNotFound = () =>
  new ApiFailure("NOT_FOUND", "Booking not found.");

export async function loadPartyBooking(
  caller: BookingCaller,
  id: string,
): Promise<PartyBooking> {
  if (!isUuid(id)) throw bookingNotFound();
  await sweepExpired(caller.admin, caller.userId);
  const r = await caller.supabase
    .from("bookings")
    .select("id, customer_id, chef_id, status, completed_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (r.error) throw new Error("booking lookup failed");
  const b = r.data as Record<string, unknown> | null;
  if (!b || (b.customer_id !== caller.userId && b.chef_id !== caller.userId))
    throw bookingNotFound();
  const status = b.status as string;
  return {
    id: b.id as string,
    customerId: b.customer_id as string,
    chefId: b.chef_id as string,
    status,
    completedAt:
      status === "completed"
        ? ((b.completed_at as string | null) ?? (b.updated_at as string))
        : null,
    otherId: (b.customer_id === caller.userId
      ? b.chef_id
      : b.customer_id) as string,
  };
}
