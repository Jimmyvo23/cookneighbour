// Cancellation timing (A-6) and what a final booking status does to the free trial (CLAUDE.md 6.6).
//
// ASSUMPTION A-6 / Q-8: cancellation is free ("on_time") until FREE_CANCELLATION_HOURS (48) before
// the first day starts; after that it is recorded as "late". Visits have no clock time in the
// model, so "the first day starts" is 00:00 on that date in Toronto (the stricter reading).
// What a late cancellation costs, and any difference for chef cancellations, is not decided (Q-8):
// this only records the timing. It never throws for a past date: a cancel after the start is late.
import { FREE_CANCELLATION_HOURS } from "./config.ts";
import { isRealDate } from "./dishes.ts";

export type CancelledBy = "customer" | "chef";

export interface CancellationResult {
  timing: "on_time" | "late";
  cancelledBy: CancelledBy;
  /** Last moment the cancellation is still on time. */
  freeUntil: Date;
  /** A cancellation before the visit never consumes the free trial (CLAUDE.md 6.6). */
  consumesFreeTrial: false;
}

const TORONTO = "America/Toronto";
const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TORONTO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The instant 00:00 on `day` (YYYY-MM-DD) in Toronto, daylight saving included. */
export function torontoStartOfDay(day: string): Date {
  if (!isRealDate(day)) throw new RangeError("day must be YYYY-MM-DD");
  const [y, m, d] = day.split("-").map(Number);
  // Toronto is UTC-5 (winter) or UTC-4 (summer): midnight is 04:00Z or 05:00Z. Pick the one that
  // really reads 00:00 on that date there.
  for (const hour of [4, 5]) {
    const t = new Date(Date.UTC(y, m - 1, d, hour));
    const p = Object.fromEntries(
      fmt.formatToParts(t).map((x) => [x.type, x.value]),
    );
    if (
      `${p.year}-${p.month}-${p.day}` === day &&
      p.hour === "00" &&
      p.minute === "00"
    )
      return t;
  }
  throw new Error("unreachable: no Toronto midnight found");
}

export function cancellationTiming(input: {
  now: Date;
  firstVisitDate: string;
  cancelledBy: CancelledBy;
  freeHours?: number;
}): CancellationResult {
  const hours = input.freeHours ?? FREE_CANCELLATION_HOURS;
  const freeUntil = new Date(
    torontoStartOfDay(input.firstVisitDate).getTime() - hours * 3_600_000,
  );
  return {
    timing: input.now.getTime() <= freeUntil.getTime() ? "on_time" : "late",
    cancelledBy: input.cancelledBy,
    freeUntil,
    consumesFreeTrial: false,
  };
}

export type BookingStatus =
  | "requested"
  | "accepted"
  | "declined"
  | "cancelled"
  | "completed"
  | "no_show_customer"
  | "no_show_chef";

/** A-16: a `requested` booking that expires (Q-11) is not a stored status yet; it releases the claim. */
export type FreeTrialEvent = BookingStatus | "expired";

/**
 * A-16 (pending Jimmy) and CLAUDE.md 6.6: a completed or customer-no-show booking consumes the free trial. A cancelled,
 * declined or chef-no-show booking never used it, so its claim is released. `requested` and
 * `accepted` keep the claim held (T-038 owns the state machine).
 */
export function freeTrialEffect(
  status: FreeTrialEvent,
): "hold" | "consume" | "release" {
  switch (status) {
    case "completed":
    case "no_show_customer":
      return "consume";
    case "declined":
    case "cancelled":
    case "no_show_chef":
    case "expired":
      return "release";
    default:
      return "hold";
  }
}
