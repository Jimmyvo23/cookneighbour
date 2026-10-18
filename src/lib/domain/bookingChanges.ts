// Booking changes (T-063): cancel, cooked marker, no-show, completion, missed pickup.
// Pure functions, no I/O. The rules that need the clock and the rows (who may do what, when) are
// decided inside the database function change_booking (one transaction, the booking row locked);
// this file holds the body parsing, the refusal texts and TypeScript mirrors of the two time rules
// (a database test compares them with the SQL helpers).
//
// Decisions behind it: D-20 (cancel timing), D-26 (cooked marker), D-29 (missed pickup), D-33
// (completion). ASSUMPTIONs are marked where the decisions leave room.
import { torontoStartOfDay } from "./cancellation.ts";
import { addDays } from "./dishes.ts";
import { findContactDetails } from "./contactDetails.ts";
import { hasUnsafeText } from "./text-safety.ts";

export const CANCEL_KEYS = ["reason"] as const;
export const PROPOSE_KEYS = ["proposedAt"] as const;
export const RESPOND_KEYS = ["accept"] as const;

const REASON_MIN = 3;
const REASON_MAX = 500;

export type ReasonResult =
  { value: string | null } | { error: string } | { contact: true };

/**
 * The optional cancel reason. Missing, null or blank is "no reason". Otherwise 3 to 500 characters
 * after trimming, the shared text-safety rules, and no phone number, email or link (the other
 * party may read it before anything is accepted: CLAUDE.md 6.8; the same best-effort filter as the
 * decline reason, D-34).
 */
export function parseCancelReason(body: Record<string, unknown>): ReasonResult {
  const r = body.reason;
  if (r === undefined || r === null) return { value: null };
  if (typeof r !== "string") return { error: "Enter text." };
  const t = r.trim();
  if (t === "") return { value: null };
  if (t.length < REASON_MIN || t.length > REASON_MAX)
    return { error: `Enter ${REASON_MIN} to ${REASON_MAX} characters.` };
  if (hasUnsafeText(t))
    return { error: "Remove control or invalid characters." };
  if (findContactDetails(t)) return { contact: true };
  return { value: t };
}

/** `:dayNumber` of a route: "1", "2" or "3" exactly. */
export function parseDayNumber(raw: string): 1 | 2 | 3 | null {
  return raw === "1" || raw === "2" || raw === "3"
    ? (Number(raw) as 1 | 2 | 3)
    : null;
}

const ISO_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/** An ISO 8601 timestamp that names its zone (Z or an offset), on a real date, years 2000 to 2100. */
export function parseProposedAt(
  raw: unknown,
): { value: Date } | { error: string } {
  const bad = {
    error: "Use a date and time like 2026-10-20T15:30:00-04:00.",
  };
  if (typeof raw !== "string") return bad;
  const m = ISO_WITH_ZONE.exec(raw);
  if (!m) return bad;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  if (y < 2000 || y > 2100 || h > 23 || mi > 59 || s > 59) return bad;
  // The calendar date must be real (no 30 February); check it in UTC arithmetic.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  )
    return bad;
  const t = new Date(raw);
  return Number.isNaN(t.getTime()) ? bad : { value: t };
}

export function parsePickupAccept(
  body: Record<string, unknown>,
): { value: boolean } | { error: string } {
  return typeof body.accept === "boolean"
    ? { value: body.accept }
    : { error: "Send true to accept or false to decline." };
}

/**
 * D-29: the instant (exclusive) after which a pickup can no longer be arranged: the end of the
 * earliest eat-by date of that day's meals, Toronto time. A 0-day dish makes it the cooking day
 * itself. Mirrors the SQL function booking_pickup_end.
 */
export function pickupDeadline(earliestEatBy: string): Date {
  return torontoStartOfDay(addDays(earliestEatBy, 1));
}

/**
 * D-33 (ASSUMPTION: "24 hours after the last day" = one calendar day after the last visit date
 * ends): when an accepted booking completes by itself. Chef's-home bookings also wait for the
 * pickup deadline of every day (SQL booking_auto_complete_at). Mirrors the SQL for customer's-home
 * bookings. T-081 (D-81): a chef's-home booking whose every day is cooked and picked up does not
 * wait for this time or the pickup deadlines; see completesOnPickup.
 */
export function completionDue(lastVisitDate: string): Date {
  return torontoStartOfDay(addDays(lastVisitDate, 2));
}

/**
 * T-081 (D-81, D-83): an accepted chef's-home booking completes right away, without waiting for the
 * pickup deadlines, once EVERY active day is cooked and has a confirmed pickup. A cancelled
 * (inactive) day is not a day to cook, so it is ignored; at least one active day is needed. If a
 * day is not cooked or not confirmed the normal rule applies (completionDue, then every pickup
 * deadline). Customer's-home bookings never use this. Mirrors the SQL function
 * booking_all_picked_up (the caller still checks status, frozen and open reports).
 */
export function completesOnPickup(
  locationType: "customer_home" | "chef_home",
  days: { isActive: boolean; cookedAt: unknown; pickedUpAt: unknown }[],
): boolean {
  if (locationType !== "chef_home") return false;
  const active = days.filter((d) => d.isActive);
  return (
    active.length > 0 && active.every((d) => !!d.cookedAt && !!d.pickedUpAt)
  );
}

/**
 * Plain-language 409 text for each reason change_booking can refuse with `invalid_state`.
 * (`out_of_range` and `day_not_found` have their own answers.)
 */
export const CHANGE_REFUSALS: Record<string, string> = {
  expired: "This request expired before it was answered.",
  wrong_status: "This booking is not in a state where that is possible.",
  chef_use_decline:
    "A request that is still waiting for your answer is declined, not cancelled. Decline it with a reason.",
  nothing_left:
    "Every remaining visit has already happened, so there is nothing left to cancel.",
  too_early: "That visit date has not arrived yet.",
  no_visit_due:
    "No visit is due yet. A no-show can be reported from the visit date.",
  days_not_cooked: "Mark each visit as cooked before closing the booking.",
  problem_reported:
    "A problem was reported for this booking. An admin will look at it first.",
  // T-064 (D-53): neutral on purpose, it does not say why.
  frozen:
    "This booking is on hold while an admin looks at it. Nothing can be changed until they decide.",
  not_chef_home: "Pickups only exist for bookings at the chef's home.",
  pickup_window_open:
    "The customer can still pick up the meals. Wait until the earliest eat-by date has passed.",
  // T-071 (D-55, A-29): the customer already said they picked the meals up.
  pickup_confirmed:
    "The customer confirmed the pickup for every visit whose pickup deadline has passed, so there is no missed pickup to report now.",
  picked_up: "You already confirmed that you picked up these meals.",
  day_not_cooked: "The chef has not marked that visit as cooked yet.",
  deadline_passed:
    "The meals from that visit have passed their eat-by date, so a new pickup cannot be arranged.",
  proposal_open: "A pickup time is already waiting for the chef's answer.",
  pickup_agreed: "A pickup time was already agreed for that visit.",
  no_open_proposal: "There is no pickup time waiting for an answer.",
  proposal_past: "That pickup time has already passed.",
};

/** Messages for `out_of_range` (a proposed pickup time that is in the past or after the deadline). */
export const PICKUP_RANGE_MESSAGES: Record<string, string> = {
  not_future: "Pick a time in the future.",
  after_deadline:
    "Pick a time no later than the earliest eat-by date of those meals.",
};
