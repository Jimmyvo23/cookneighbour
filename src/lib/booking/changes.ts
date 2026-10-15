// Pure helpers for the booking changes and grocery screens (T-045): the chef dashboard, the
// customer's pickup proposals and the receipts. No I/O. Rules come from docs/api-contract.md
// sections 7A ("Booking changes") and 7B; the server stays the judge, these only word things and
// avoid sending requests that cannot work.
import { ApiClientError } from "@/lib/api/client";
import type {
  BookingDayView,
  BookingDetail,
  BookingStatus,
  ReceiptView,
} from "@/lib/api/types";
import { freeTrialEffect, torontoStartOfDay } from "@/lib/domain/cancellation";
import { addDays } from "@/lib/domain/dishes";
import { CHANGE_REFUSALS } from "@/lib/domain/bookingChanges";
import { RECEIPT_EXTENSIONS, RECEIPT_REFUSALS } from "@/lib/domain/groceries";
import { formatWhen } from "@/lib/booking/form";
import { formatDollars } from "@/lib/chef/dishes";

// ---------------------------------------------------------------------------
// Error words
// ---------------------------------------------------------------------------

/**
 * T-077 (D-53): the one neutral sentence both parties see on a frozen booking. It is the server's
 * own refusal text, so the notice and a stale-page 409 read the same. It does not say why.
 */
export const FROZEN_TEXT = CHANGE_REFUSALS.frozen;

/** D-59: one wording for the UI and the mock server, so the two cannot drift. */
export const KITCHEN_ADDRESS_MISSING_MESSAGE =
  "Your kitchen address is missing, so this booking cannot be accepted. Adding a kitchen address switches cooking at your home off until an admin checks it again, so declining this request is the practical choice.";

/** Extra texts for the reasons that CHANGE_REFUSALS does not word for people. */
const EXTRA_REASONS: Record<string, string> = {
  // D-59: accept is refused while chef's home is on but no kitchen address is saved.
  kitchen_address_missing: KITCHEN_ADDRESS_MISSING_MESSAGE,
  chef_home_not_enabled:
    "Cooking at your home was switched off after this request came in, so it cannot be accepted. Decline it instead and say why.",
  kitchen_in_use:
    "You have an accepted booking at your home, so your kitchen address is locked until it is finished.",
};

/**
 * One sentence for a failed booking change (accept, decline, cooked, complete, pickup). Uses the
 * stable `error.reason` of a 409 `INVALID_STATE` (T-063); falls back to the server message.
 */
export function changeErrorText(err: unknown): string {
  if (!(err instanceof ApiClientError))
    return "Something went wrong. Please try again.";
  if (err.code === "REQUEST_EXPIRED")
    return "This request expired before it was answered, so it can no longer be accepted or declined. Reload to see its status.";
  if (err.code === "CONTACT_DETAILS_NOT_ALLOWED")
    return "Please leave phone numbers, emails and links out. They are shared only after a booking is accepted.";
  if (err.code === "INVALID_STATE" && err.reason) {
    const text = EXTRA_REASONS[err.reason] ?? CHANGE_REFUSALS[err.reason];
    if (text) return text;
  }
  if (err.code === "INVALID_STATE")
    return "That is not possible in this booking's current state. Reload the page to see its status.";
  if (err.code === "NOT_FOUND") return "This booking could not be found.";
  if (err.code === "NETWORK") return err.message;
  return err.message;
}

/**
 * Words for a refused chef cancel (contract 7A, `POST .../cancel`). `wrong_status` and the contact
 * guard are worded for this action; the other reasons use the shared words.
 */
export function cancelBookingErrorText(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === "INVALID_STATE" && err.reason === "wrong_status")
      return "This booking is not accepted any more, so it cannot be cancelled. Reload the page to see its status.";
    if (err.code === "CONTACT_DETAILS_NOT_ALLOWED")
      return "Please leave phone numbers, emails and links out of the reason. The customer reads it, and these are shared only after a booking is accepted.";
    if (err.status === 422 && err.fields.reason) return err.fields.reason;
  }
  return changeErrorText(err);
}

/** Words for a refused customer no-show report (contract 7A, `POST .../no-show`). */
export function noShowErrorText(err: unknown): string {
  if (
    err instanceof ApiClientError &&
    err.code === "INVALID_STATE" &&
    err.reason === "wrong_status"
  )
    return "This booking is not accepted any more, so a no-show cannot be reported. Reload the page to see its status.";
  return changeErrorText(err);
}

/** Words for a refused pickup proposal; `latest` is the first instant that is too late. */
export function proposalErrorText(err: unknown): string {
  if (
    err instanceof ApiClientError &&
    err.status === 422 &&
    err.fields.proposedAt
  ) {
    return err.latest
      ? `${err.fields.proposedAt} Choose a time before ${formatWhen(err.latest)} (Toronto time).`
      : err.fields.proposedAt;
  }
  return changeErrorText(err);
}

/** Words for a refused receipt upload or answer (contract 7B reasons). */
export function receiptErrorText(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === "INVALID_STATE" && err.reason) {
      const t = RECEIPT_REFUSALS[err.reason];
      if (t) return t;
    }
    if (err.code === "NOT_FOUND")
      return "This receipt or booking could not be found. Reload the page.";
  }
  return changeErrorText(err);
}

// ---------------------------------------------------------------------------
// Toronto time
// ---------------------------------------------------------------------------
const TZ_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Toronto's offset from UTC, in minutes, at the instant `t` (for example -240 in summer). */
function torontoOffsetMinutes(t: Date): number {
  const p = Object.fromEntries(
    TZ_PARTS.formatToParts(t).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - Math.floor(t.getTime() / 1000) * 1000) / 60000);
}

/**
 * A `datetime-local` value ("2026-10-20T15:30") read as Toronto wall-clock time, as an ISO 8601
 * string with the Toronto offset ("2026-10-20T15:30:00-04:00"), which is the shape the API
 * requires. Null when the text is not a real date and time. Pickups are arranged in Toronto time
 * (D-29), whatever zone the browser is in.
 */
export function torontoLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (
    y < 2000 ||
    y > 2100 ||
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d ||
    probe.getUTCHours() !== h
  )
    return null;
  // Two passes settle the offset around a daylight-saving change.
  let offset = torontoOffsetMinutes(probe);
  offset = torontoOffsetMinutes(new Date(probe.getTime() - offset * 60000));
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Toronto wall-clock now as a `datetime-local` value ("2026-10-20T15:30"), for the `min` of the input. */
export function torontoNowLocal(now: Date = new Date()): string {
  const p = Object.fromEntries(
    TZ_PARTS.formatToParts(now).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** The first instant a pickup can no longer be arranged for a day: the end of its deadline date. */
export function pickupEnd(deadlineDate: string): Date {
  return torontoStartOfDay(addDays(deadlineDate, 1));
}

// ---------------------------------------------------------------------------
// Days and pickups
// ---------------------------------------------------------------------------

/** The proposal that is still alive for a day (open or agreed), or null. */
export function liveProposal(day: BookingDayView) {
  return (
    day.pickups.find((p) => p.status === "proposed") ??
    day.pickups.find((p) => p.status === "accepted") ??
    null
  );
}

/** The customer may propose (again) for a cooked day with no live proposal and time left (D-29). */
export function canPropose(day: BookingDayView, now: Date): boolean {
  if (!day.cookedAt || !day.pickupDeadlineDate) return false;
  if (liveProposal(day)) return false;
  return now.getTime() < pickupEnd(day.pickupDeadlineDate).getTime();
}

/**
 * True when a cooked day's pickup window is over (the server checks the same thing: 409
 * `pickup_window_open` otherwise). It does not look at proposals: callers that care whether a
 * pickup time was agreed check that themselves.
 */
export function pickupWindowPassed(day: BookingDayView, now: Date): boolean {
  if (!day.cookedAt || !day.pickupDeadlineDate) return false;
  return now.getTime() >= pickupEnd(day.pickupDeadlineDate).getTime();
}

export function canMarkPickupMissed(b: BookingDetail, now: Date): boolean {
  return (
    b.status === "accepted" &&
    b.locationType === "chef_home" &&
    b.days.some((d) => pickupWindowPassed(d, now))
  );
}

/** Every day is cooked: "visit done" can be pressed (the server requires it, 409 days_not_cooked). */
export function allDaysCooked(b: BookingDetail): boolean {
  return b.days.length > 0 && b.days.every((d) => d.cookedAt !== null);
}

/** The visit date has come (Toronto): a day can be marked cooked from this date on (409 too_early). */
export function dayIsDue(day: BookingDayView, today: string): boolean {
  return day.date <= today;
}

/**
 * The chef can cancel an accepted booking while a visit is left: not cooked and today or later
 * (Toronto). The server decides (409 `nothing_left`); this only avoids a button that cannot work.
 */
export function canChefCancel(b: BookingDetail, today: string): boolean {
  return (
    b.status === "accepted" &&
    b.days.some((d) => d.cookedAt === null && d.date >= today)
  );
}

/**
 * Customer cancel guard (T-072 L-B): the customer can cancel a requested booking, or an accepted
 * one while a visit is left (a day dated today or later; Toronto). When every visit is past the
 * server answers 409 `nothing_left`, so the button is not shown. A requested booking can always
 * be cancelled; the server decides the rest.
 */
export function canCustomerCancel(b: BookingDetail, today: string): boolean {
  if (b.status === "requested") return true;
  return b.status === "accepted" && b.days.some((d) => d.date >= today);
}

/**
 * Where a booking stands in the contact window (D-52, D-56). The server decides; this only words
 * what it sent. `open`: phone/address shown (until `until`, Toronto time). `ended`: the booking
 * was accepted, completed or a no-show but the server no longer sends contact (7 days after the
 * last visit day). `locked`: cancelled, so contact closed at once (D-56). `later`: requested.
 * `never`: declined or expired.
 */
export type ContactWindow =
  | { kind: "open"; until: string | null }
  | { kind: "ended" }
  | { kind: "locked" }
  | { kind: "later" }
  | { kind: "never" };

export function contactWindow(b: BookingDetail): ContactWindow {
  switch (b.status) {
    case "requested":
      return { kind: "later" };
    case "cancelled":
      return { kind: "locked" };
    case "declined":
    case "expired":
      return { kind: "never" };
    default:
      return b.contact
        ? { kind: "open", until: b.contactVisibleUntil ?? null }
        : { kind: "ended" };
  }
}

export const CONTACT_RULE =
  "Phone numbers and addresses are hidden 7 days after the last visit day.";

/**
 * D-64: the server cut-off is midnight Toronto, so the last visible day is the one containing
 * (cut-off - 1 ms). Returns e.g. "Wed, Oct 21", or null when the value is missing or invalid.
 */
function lastVisibleDay(untilIso: string): string | null {
  const t = new Date(untilIso).getTime();
  if (Number.isNaN(t)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(t - 1));
}

/** The sentence under the contact details while they are visible. Null when nothing is shown. */
export function contactOpenText(w: ContactWindow): string | null {
  if (w.kind !== "open") return null;
  const day = w.until ? lastVisibleDay(w.until) : null;
  return day
    ? `Visible until the end of ${day} (Toronto time). ${CONTACT_RULE}`
    : CONTACT_RULE;
}

/** The sentence that replaces hidden contact details, for the ended and cancelled cases. */
export const CONTACT_ENDED_TEXT = `Contact details are hidden now. ${CONTACT_RULE}`;
export const CONTACT_LOCKED_TEXT =
  "Phone numbers and addresses are locked when a booking is cancelled.";

/**
 * The visit a customer no-show can be reported for: the earliest day whose date has come and that
 * was not marked cooked (contract 7A: reportable from the visit date, an ASSUMPTION there). Null
 * when none is due.
 */
export function noShowDay(
  b: BookingDetail,
  today: string,
): BookingDayView | null {
  if (b.status !== "accepted") return null;
  return (
    [...b.days]
      .sort((x, y) => x.dayNumber - y.dayNumber)
      .find((d) => d.cookedAt === null && d.date <= today) ?? null
  );
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------
const MB = 1024 * 1024;
export const RECEIPT_MAX_BYTES = 10 * MB;
export const RECEIPT_BUCKET = "receipts";
const RECEIPT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};
export const RECEIPT_ALLOWED_TEXT = "PNG, JPEG or PDF, up to 10 MB";

/** A message for the chef, or null when the file may be uploaded as a receipt. */
export function validateReceiptFile(
  file: { type: string; size: number } | null | undefined,
): string | null {
  if (!file) return "Choose the receipt file first.";
  if (!Object.prototype.hasOwnProperty.call(RECEIPT_TYPES, file.type))
    return `That file type is not allowed. Use ${RECEIPT_ALLOWED_TEXT}.`;
  if (file.size <= 0) return "That file is empty.";
  if (file.size > RECEIPT_MAX_BYTES)
    return "That file is too large. The limit is 10 MB.";
  return null;
}

/**
 * A fresh object path `<booking id>/<uuid>.<ext>` in the receipts bucket. Always a new name
 * (insert only: the storage rules allow no overwrite, and the server refuses a path used before).
 */
export function newReceiptPath(
  bookingId: string,
  mimeType: string,
  uuid: string = crypto.randomUUID(),
): string {
  const ext = RECEIPT_TYPES[mimeType];
  if (!ext || !(RECEIPT_EXTENSIONS as readonly string[]).includes(ext))
    throw new RangeError("unsupported receipt type");
  return `${bookingId}/${uuid.toLowerCase()}.${ext}`;
}

/** A link from the API is opened only when it is a plain http(s) URL. */
export function safeFileUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** "The chef spent $3.20 more than the estimate" and so on. */
export function differenceText(r: ReceiptView): string {
  const d = r.differenceCents;
  if (d === 0) return "The receipt matches the estimate.";
  const amount = formatDollars(Math.abs(d));
  return d > 0
    ? `The receipt is ${amount} more than the estimate.`
    : `The receipt is ${amount} less than the estimate.`;
}

/** The receipt that still needs an answer or counts, i.e. the newest one that is not replaced. */
export function currentReceipt(items: ReceiptView[]): ReceiptView | null {
  const live = items.filter((r) => r.status !== "superseded");
  return live.length ? live[live.length - 1] : null;
}

/** The signed link lasts 10 minutes (contract 7B); refetch a little earlier. */
export const FILE_URL_REFRESH_MS = 8 * 60 * 1000;

/**
 * An accepted booking whose visit dates are all before today (Toronto) and none was marked cooked.
 * The server keeps it for an admin to check (D-36); no field says so, so it is derived from the
 * days. The page says only that it is waiting for a check (Q-35 and Q-36 are open).
 */
export function isWaitingForCheck(b: BookingDetail, today: string): boolean {
  return (
    b.status === "accepted" &&
    b.days.length > 0 &&
    b.days.every((d) => d.cookedAt === null && d.date < today)
  );
}

/** Uncooked days of an accepted booking whose date is before today: the chef should mark them. */
export function pastUncookedDays(
  b: BookingDetail,
  today: string,
): BookingDayView[] {
  if (b.status !== "accepted") return [];
  return [...b.days]
    .sort((x, y) => x.dayNumber - y.dayNumber)
    .filter((d) => d.cookedAt === null && d.date < today);
}

/** List rows only know dates: an accepted booking with every date before today. */
export function summaryAllDatesPast(
  status: BookingStatus,
  dates: string[],
  today: string,
): boolean {
  return (
    status === "accepted" && dates.length > 0 && dates.every((d) => d < today)
  );
}

/**
 * What a chef no-show means for the customer's free first booking (D-37): used when at least one
 * day was cooked, released when none was. Null when the booking was not a free first booking.
 */
export function chefNoShowTrialText(
  isFreeTrial: boolean,
  anyDayCooked: boolean,
  viewer: "customer" | "chef" = "customer",
): string | null {
  if (!isFreeTrial) return null;
  const who = viewer === "customer" ? "your" : "the customer's";
  return freeTrialEffect("no_show_chef", { anyDayCooked }) === "consume"
    ? `A day had already been cooked, so ${who} free first booking counts as used.`
    : `No day had been cooked, so ${who} free first booking is not used up.`;
}

/** The chef's words for each booking status (the customer's page has its own). */
export const CHEF_STATUS_TEXT: Record<BookingStatus, string> = {
  requested: "Waiting for your answer",
  accepted: "You accepted this booking",
  declined: "You declined this request",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show_customer: "Closed as a customer no-show",
  no_show_chef: "Marked as a chef no-show",
  expired: "Expired: nobody answered in time",
};
