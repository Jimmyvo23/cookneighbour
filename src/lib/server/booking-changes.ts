// Server side of the booking-change routes (T-063, contract section 7A): cancel, "cooked" marker,
// no-show, "visit done", and the missed-pickup flow (D-29).
//
// Authorization (contract section 2): every entry point takes a BookingCaller from one of the
// require* functions in bookings.ts (role from profiles.role; 403 for the wrong role, admins
// included). The booking id from the URL is then matched against the caller's OWN rows (customer_id
// or chef_id = the session user): someone else's booking and a missing one give the same 404, and
// the body is not looked at before that. The decision itself is the database function
// change_booking, which locks the booking row FOR UPDATE, re-checks the status and the party
// under that lock and writes in one transaction, so two changes (or a change and an expiry or
// auto-completion) take turns and only one wins.
//
// Free trial (A-16, D-26): applyFreeTrialEvent runs only AFTER the change is saved. The cooked
// marker for a cancellation comes back from the same transaction. A failure of the follow-up is
// logged and repaired by the next sweep (sweep_booking_changes lists finished bookings whose claim
// is still held), so it never turns a saved change into an error.
//
// MOCK: nothing here moves money. A late cancellation is only recorded (D-20).
import "server-only";
import { ApiFailure, validationFailed } from "@/lib/api/errors";
import { rejectUnknownKeys } from "@/lib/api/request";
import type { BookingDetail } from "@/lib/api/types";
import { isUuid } from "@/lib/domain/admin-chefs";
import {
  CANCEL_KEYS,
  CHANGE_REFUSALS,
  PICKUP_RANGE_MESSAGES,
  PROPOSE_KEYS,
  RESPOND_KEYS,
  parseCancelReason,
  parseDayNumber,
  parsePickupAccept,
  parseProposedAt,
} from "@/lib/domain/bookingChanges";
import type { FreeTrialEvent } from "@/lib/domain/cancellation";
import { FREE_CANCELLATION_HOURS } from "@/lib/domain/config";
import { loadBookingDetail } from "@/lib/server/booking-views";
import { sweepExpired, type BookingCaller } from "@/lib/server/bookings";
import { applyFreeTrialEvent } from "@/lib/server/free-trial";

type Row = Record<string, unknown>;

type Action =
  | "cancel"
  | "cooked"
  | "no_show"
  | "complete"
  | "pickup_propose"
  | "pickup_respond"
  | "pickup_missed"
  | "pickup_confirm";

const notFound = () => new ApiFailure("NOT_FOUND", "Booking not found.");

/** The booking must be one of the caller's own (as the role they have); otherwise 404. */
async function requireOwn(
  caller: BookingCaller,
  id: string,
  as: "customer" | "chef" | "either",
): Promise<void> {
  if (!isUuid(id)) throw notFound();
  let q = caller.admin.from("bookings").select("id").eq("id", id);
  if (as === "customer") q = q.eq("customer_id", caller.userId);
  else if (as === "chef") q = q.eq("chef_id", caller.userId);
  else q = q.or(`customer_id.eq.${caller.userId},chef_id.eq.${caller.userId}`);
  const r = await q.maybeSingle();
  if (r.error) throw new Error("booking lookup failed");
  if (!r.data) throw notFound();
}

function dayOr404(raw: string): number {
  const n = parseDayNumber(raw);
  if (n === null) throw new ApiFailure("NOT_FOUND", "Day not found.");
  return n;
}

async function followClaim(
  caller: BookingCaller,
  id: string,
  event: FreeTrialEvent,
  anyDayCooked: boolean,
): Promise<void> {
  try {
    await applyFreeTrialEvent(id, event, { db: caller.admin, anyDayCooked });
  } catch (e) {
    console.error(
      "bookings: free-trial update failed:",
      e instanceof Error ? e.message : "unknown",
    );
  }
}

/** Calls change_booking and turns its answer into an error or the saved booking's detail. */
async function run(
  caller: BookingCaller,
  id: string,
  action: Action,
  args: Record<string, unknown>,
): Promise<BookingDetail> {
  // Lazy expiry and auto-completion first, so a stale booking is judged in its real state.
  await sweepExpired(caller.admin, caller.userId);
  const r = await caller.admin.rpc("change_booking", {
    p_booking: id,
    p_actor: caller.userId,
    p_action: action,
    p_args: args,
  });
  if (r.error) throw new Error(`change_booking failed: ${r.error.message}`);
  const out = r.data as Row;
  switch (out.result) {
    case "ok": {
      const status = out.status as FreeTrialEvent;
      // Only these change the claim; cooked, propose and respond leave the booking `accepted`.
      // T-081: a pickup confirm that picks up the last day completes the booking (D-81), and a
      // completed booking uses the free trial; applied after the save like every other change.
      if (
        action === "cancel" ||
        action === "no_show" ||
        action === "complete" ||
        action === "pickup_missed" ||
        (action === "pickup_confirm" && status === "completed")
      )
        await followClaim(caller, id, status, out.cooked === true);
      return loadBookingDetail(caller.supabase, caller.userId, id);
    }
    case "not_found":
      throw notFound();
    case "day_not_found":
      throw new ApiFailure("NOT_FOUND", "Day not found.");
    case "invalid_state": {
      const reason = String(out.reason ?? "wrong_status");
      throw new ApiFailure(
        "INVALID_STATE",
        CHANGE_REFUSALS[reason] ?? CHANGE_REFUSALS.wrong_status,
        { reason },
      );
    }
    case "out_of_range": {
      const reason = String(out.reason ?? "");
      const err = validationFailed({
        proposedAt: PICKUP_RANGE_MESSAGES[reason] ?? "Pick another time.",
      });
      throw new ApiFailure(err.code, err.message, {
        ...err.extra,
        latest:
          typeof out.latest === "string"
            ? new Date(out.latest).toISOString()
            : undefined,
      });
    }
    default:
      throw new Error("change_booking returned an unknown result");
  }
}

// ---------------------------------------------------------------------------
// POST /api/bookings/:id/cancel   (customer or chef)
// ---------------------------------------------------------------------------
export async function cancelBooking(
  caller: BookingCaller,
  id: string,
  body: Record<string, unknown>,
): Promise<BookingDetail> {
  await requireOwn(caller, id, "either");
  rejectUnknownKeys(body, [...CANCEL_KEYS]);
  const p = parseCancelReason(body);
  if ("contact" in p)
    throw new ApiFailure(
      "CONTACT_DETAILS_NOT_ALLOWED",
      "Do not put phone numbers, email addresses or links in the reason. Contact details are shared after a booking is accepted.",
      {
        fields: { reason: "Remove phone numbers, email addresses and links." },
      },
    );
  if ("error" in p) throw validationFailed({ reason: p.error });
  return run(caller, id, "cancel", {
    reason: p.value,
    free_hours: FREE_CANCELLATION_HOURS,
  });
}

// ---------------------------------------------------------------------------
// POST /api/bookings/:id/days/:dayNumber/cooked   (chef)
// ---------------------------------------------------------------------------
export async function markDayCooked(
  caller: BookingCaller,
  id: string,
  dayNumber: string,
): Promise<BookingDetail> {
  await requireOwn(caller, id, "chef");
  return run(caller, id, "cooked", { day_number: dayOr404(dayNumber) });
}

// ---------------------------------------------------------------------------
// POST /api/bookings/:id/no-show   (chef reports the customer, customer reports the chef)
// ---------------------------------------------------------------------------
export async function reportNoShow(
  caller: BookingCaller,
  id: string,
): Promise<BookingDetail> {
  await requireOwn(caller, id, "either");
  return run(caller, id, "no_show", {});
}

// ---------------------------------------------------------------------------
// POST /api/bookings/:id/complete   (chef: "visit done", D-33)
// ---------------------------------------------------------------------------
export async function completeVisit(
  caller: BookingCaller,
  id: string,
): Promise<BookingDetail> {
  await requireOwn(caller, id, "chef");
  return run(caller, id, "complete", {});
}

// ---------------------------------------------------------------------------
// Missed pickup (D-29), chef's-home bookings
// ---------------------------------------------------------------------------
export async function proposePickup(
  caller: BookingCaller,
  id: string,
  dayNumber: string,
  body: Record<string, unknown>,
): Promise<BookingDetail> {
  await requireOwn(caller, id, "customer");
  const day = dayOr404(dayNumber);
  rejectUnknownKeys(body, [...PROPOSE_KEYS]);
  const t = parseProposedAt(body.proposedAt);
  if ("error" in t) throw validationFailed({ proposedAt: t.error });
  return run(caller, id, "pickup_propose", {
    day_number: day,
    proposed_at: t.value.toISOString(),
  });
}

export async function respondPickup(
  caller: BookingCaller,
  id: string,
  dayNumber: string,
  body: Record<string, unknown>,
): Promise<BookingDetail> {
  await requireOwn(caller, id, "chef");
  const day = dayOr404(dayNumber);
  rejectUnknownKeys(body, [...RESPOND_KEYS]);
  const a = parsePickupAccept(body);
  if ("error" in a) throw validationFailed({ accept: a.error });
  return run(caller, id, "pickup_respond", {
    day_number: day,
    accept: a.value,
  });
}

export async function markPickupMissed(
  caller: BookingCaller,
  id: string,
): Promise<BookingDetail> {
  await requireOwn(caller, id, "chef");
  return run(caller, id, "pickup_missed", {});
}

// ---------------------------------------------------------------------------
// POST /api/bookings/:id/days/:dayNumber/pickup/confirm   (customer, T-071, D-55)
// "I picked up my meals". No body. After this the chef cannot mark the pickup missed.
// ---------------------------------------------------------------------------
export async function confirmPickup(
  caller: BookingCaller,
  id: string,
  dayNumber: string,
): Promise<BookingDetail> {
  await requireOwn(caller, id, "customer");
  return run(caller, id, "pickup_confirm", { day_number: dayOr404(dayNumber) });
}
