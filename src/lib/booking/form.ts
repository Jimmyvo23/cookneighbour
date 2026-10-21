// Pure helpers for the booking flow (T-043). The server stays the authority (contract section 7A);
// these build the request body, run the same cheap checks in the browser so the customer gets
// help before a round trip, and word the answers. No network, no DOM, no browser clock (the
// caller passes `now`).
import type {
  BookingEstimateResponse,
  BookingIssue,
  BookingRequestBody,
  GroceryOption,
  LocationType,
  PublicDish,
} from "@/lib/api/types";
import { ApiClientError } from "@/lib/api/client";
import { normalizePostalCode } from "@/lib/domain/address";
import { cancellationTiming } from "@/lib/domain/cancellation";
import {
  INTAKE_ALLERGY_NOTES_MAX,
  INTAKE_DIETARY_NOTES_MAX,
  MAX_BOOKING_DAYS,
  MAX_DISH_QUANTITY,
  VISIT_SOFT_LIMIT_MINUTES,
} from "@/lib/domain/config";
import { findAllergyConflicts } from "@/lib/domain/allergy";
import { issuesToFields } from "@/lib/domain/bookingRequest";
import { hasUnsafeText } from "@/lib/domain/text-safety";
import { hasNoVisibleText, NO_VISIBLE_TEXT } from "@/lib/domain/text-fold";
import { formatMinutes } from "@/lib/chef/dishes";

export type FieldErrors = Record<string, string>;

export interface DayDraft {
  /** YYYY-MM-DD, or "" while not chosen. */
  date: string;
  /** dishId to quantity; a dish is on the day only while its quantity is 1 or more. */
  quantities: Record<string, number>;
}

export interface BookingDraft {
  days: DayDraft[];
  locationType: LocationType | "";
  address: { line: string; city: string; postalCode: string };
  groceryOption: GroceryOption | "";
  noAllergies: boolean;
  allergens: string[];
  allergyNotes: string;
  noDietaryNeeds: boolean;
  dietaryNotes: string;
  conflictAcknowledged: boolean;
  useFreeTrial: boolean;
}

export function emptyDraft(): BookingDraft {
  return {
    days: [{ date: "", quantities: {} }],
    locationType: "",
    address: { line: "", city: "", postalCode: "" },
    groceryOption: "",
    noAllergies: false,
    allergens: [],
    allergyNotes: "",
    noDietaryNeeds: false,
    dietaryNotes: "",
    conflictAcknowledged: false,
    useFreeTrial: true,
  };
}

/** Grows or shrinks the day list to `count` (1 to 3), keeping the days that stay. */
export function resizeDays(days: DayDraft[], count: number): DayDraft[] {
  const n = Math.min(Math.max(Math.trunc(count) || 1, 1), MAX_BOOKING_DAYS);
  const out = days.slice(0, n);
  while (out.length < n) out.push({ date: "", quantities: {} });
  return out;
}

/** Picked dishes of one day in the chef's menu order, with their quantity. */
export function pickedDishes(
  day: DayDraft,
  dishes: readonly PublicDish[],
): { dish: PublicDish; quantity: number }[] {
  return dishes
    .map((dish) => ({ dish, quantity: day.quantities[dish.id] ?? 0 }))
    .filter((p) => p.quantity >= 1);
}

export function dayMinutes(day: DayDraft, dishes: readonly PublicDish[]) {
  return pickedDishes(day, dishes).reduce(
    (s, p) => s + p.dish.cookMinutes * p.quantity,
    0,
  );
}

/** The 6 hour soft limit per visit (CLAUDE.md 6.5): null when the day is within it. */
export function visitLimitMessage(minutes: number): string | null {
  if (minutes <= VISIT_SOFT_LIMIT_MINUTES) return null;
  const over = minutes - VISIT_SOFT_LIMIT_MINUTES;
  return `This day adds up to ${formatMinutes(minutes)}, which is ${formatMinutes(over)} over the ${VISIT_SOFT_LIMIT_MINUTES / 60} hour limit for one visit. Remove dishes or move some to another day.`;
}

/** The allergy text the server stores and checks: picked allergens plus the free text. */
export function allergyText(d: BookingDraft): string {
  if (d.noAllergies) return "None";
  return [...d.allergens, d.allergyNotes.trim()].filter(Boolean).join(", ");
}

/** Dishes (over all days, each once) whose allergens match what the customer wrote (D-24). */
export function localConflicts(
  d: BookingDraft,
  dishes: readonly PublicDish[],
): { dishId: string; dishName: string; allergens: string[] }[] {
  if (d.noAllergies) return [];
  const chosen = new Map<string, PublicDish>();
  for (const day of d.days)
    for (const p of pickedDishes(day, dishes)) chosen.set(p.dish.id, p.dish);
  return findAllergyConflicts(
    allergyText(d),
    [...chosen.values()].map((x) => ({
      id: x.id,
      name: x.name,
      allergens: x.allergens,
    })),
  );
}

export function buildRequest(
  chefId: string,
  d: BookingDraft,
  dishes: readonly PublicDish[],
  useFreeTrial: boolean,
): BookingRequestBody {
  const body: BookingRequestBody = {
    chefId,
    locationType: d.locationType as LocationType,
    days: d.days.map((day) => ({
      date: day.date,
      dishes: pickedDishes(day, dishes).map((p) => ({
        dishId: p.dish.id,
        quantity: p.quantity,
      })),
    })),
    groceryOption: d.groceryOption as GroceryOption,
    intake: {
      ...(d.noAllergies
        ? { noAllergies: true }
        : { allergens: d.allergens, allergyNotes: d.allergyNotes.trim() }),
      ...(d.noDietaryNeeds
        ? { noDietaryNeeds: true }
        : { dietaryNotes: d.dietaryNotes.trim() }),
    },
    allergyConflictAcknowledged:
      localConflicts(d, dishes).length > 0 && d.conflictAcknowledged,
    useFreeTrial,
  };
  if (d.locationType === "customer_home")
    body.address = {
      line: d.address.line.trim(),
      city: d.address.city.trim(),
      postalCode: d.address.postalCode.trim(),
    };
  return body;
}

/** The two intake answers the browser can check (shared with the saved allergy profile, T-067). */
export function intakeProblems(
  d: Pick<
    BookingDraft,
    | "noAllergies"
    | "allergens"
    | "allergyNotes"
    | "noDietaryNeeds"
    | "dietaryNotes"
  >,
): FieldErrors {
  const e: FieldErrors = {};
  if (!d.noAllergies && d.allergens.length === 0 && !d.allergyNotes.trim())
    e["intake.allergies"] =
      'Pick your allergies, write them below, or tick "I have no allergies".';
  else if (d.allergyNotes.length > INTAKE_ALLERGY_NOTES_MAX)
    e["intake.allergies"] =
      `Use ${INTAKE_ALLERGY_NOTES_MAX} characters or fewer for allergy notes.`;
  else if (hasUnsafeText(d.allergyNotes, true))
    e["intake.allergies"] = "Remove control or invalid characters.";
  if (!d.noDietaryNeeds && !d.dietaryNotes.trim())
    e["intake.dietaryNotes"] =
      'Describe your dietary needs, or tick "I have no dietary needs".';
  else if (d.dietaryNotes.length > INTAKE_DIETARY_NOTES_MAX)
    e["intake.dietaryNotes"] =
      `Use ${INTAKE_DIETARY_NOTES_MAX} characters or fewer for dietary notes.`;
  else if (hasUnsafeText(d.dietaryNotes, true))
    e["intake.dietaryNotes"] = "Remove control or invalid characters.";
  return e;
}

/** Field problems the browser can find without the server. Keys are the contract's dotted keys. */
export function localProblems(
  d: BookingDraft,
  dishes: readonly PublicDish[],
  offered: readonly LocationType[],
): FieldErrors {
  const e: FieldErrors = {};
  const seen = new Set<string>();
  d.days.forEach((day, i) => {
    const n = i + 1;
    if (!day.date) e[`days.${i}.date`] = `Choose a date for day ${n}.`;
    else if (seen.has(day.date))
      e[`days.${i}.date`] = `Day ${n} needs a different date from the others.`;
    seen.add(day.date);
    const picked = pickedDishes(day, dishes);
    if (picked.length === 0)
      e[`days.${i}.dishes`] = `Pick at least one dish for day ${n}.`;
    else if (picked.some((p) => p.quantity > MAX_DISH_QUANTITY))
      e[`days.${i}.dishes`] =
        `Use a quantity from 1 to ${MAX_DISH_QUANTITY} for each dish.`;
    else {
      const over = visitLimitMessage(dayMinutes(day, dishes));
      if (over) e[`days.${i}.dishes`] = `Day ${n}: ${over}`;
    }
  });

  if (!d.locationType || !offered.includes(d.locationType))
    e.locationType = "Choose where the chef will cook.";
  if (d.locationType === "customer_home") {
    if (!d.address.line.trim())
      e["address.line"] = "Enter the street address where the chef will cook.";
    else if (hasUnsafeText(d.address.line))
      e["address.line"] = "Remove control or invalid characters.";
    else if (hasNoVisibleText(d.address.line))
      e["address.line"] = NO_VISIBLE_TEXT;
    if (!d.address.city.trim()) e["address.city"] = "Enter the city.";
    else if (hasUnsafeText(d.address.city))
      e["address.city"] = "Remove control or invalid characters.";
    else if (hasNoVisibleText(d.address.city))
      e["address.city"] = NO_VISIBLE_TEXT;
    if (!normalizePostalCode(d.address.postalCode))
      e["address.postalCode"] =
        "Enter a valid postal code, for example L5B 1A1.";
  }
  if (!d.groceryOption) e.groceryOption = "Choose who buys the groceries.";

  Object.assign(e, intakeProblems(d));

  if (localConflicts(d, dishes).length > 0 && !d.conflictAcknowledged)
    e.allergyConflictAcknowledged =
      "A dish contains an allergen you listed. Tick the box to confirm you understand, or remove the dish.";
  return e;
}

/** The DOM id of the control that carries an error key (used by the summary links). */
export function fieldDomId(key: string): string {
  return `bk-${key.replace(/\./g, "-")}`;
}

/** Errors in page order, for the summary at the top of the form. */
const ORDER = [
  /^days\.(\d+)\.date$/,
  /^days\.(\d+)\.dishes/,
  /^days$/,
  /^locationType$/,
  /^address\./,
  /^groceryOption$/,
  /^intake\.allergies$/,
  /^allergyConflictAcknowledged$/,
  /^intake\.dietaryNotes$/,
];
export function orderedErrors(
  errors: FieldErrors,
): { key: string; message: string }[] {
  const rank = (k: string) => {
    const i = ORDER.findIndex((r) => r.test(k));
    const day = /^days\.(\d+)/.exec(k);
    return (i === -1 ? 99 : i) + (day ? Number(day[1]) * 0.01 : 0);
  };
  return Object.entries(errors)
    .map(([key, message]) => ({ key, message }))
    .sort((a, b) => rank(a.key) - rank(b.key));
}

/**
 * Server field keys that have no control of their own are moved to one that does, so the summary
 * link always lands on something. `days.0.dishes.1.quantity` goes to the day's dish list.
 */
export function normalizeServerFields(fields: FieldErrors): FieldErrors {
  const out: FieldErrors = {};
  for (const [k, v] of Object.entries(fields)) {
    let key = k;
    const dish = /^(days\.\d+\.dishes)\./.exec(k);
    if (dish) key = dish[1];
    else if (k === "intake" || k === "intake.noAllergies")
      key = "intake.allergies";
    else if (k === "intake.allergens" || k === "intake.allergyNotes")
      key = "intake.allergies";
    else if (k === "intake.noDietaryNeeds") key = "intake.dietaryNotes";
    else if (k === "days") key = "days";
    if (!(key in out)) out[key] = v;
  }
  return out;
}

/** Field errors for server issues (200 estimate body or a 422/409 error). */
export function issuesToErrors(issues: readonly BookingIssue[]): FieldErrors {
  return normalizeServerFields(issuesToFields(issues));
}

/** D-20: day 1 less than 48 hours away means a cancellation is already late. */
export function isInsideLateWindow(firstDay: string, now: Date): boolean {
  return (
    cancellationTiming({
      now,
      firstVisitDate: firstDay,
      cancelledBy: "customer",
    }).timing === "late"
  );
}

export function earliestDate(d: BookingDraft): string | null {
  const dates = d.days.map((x) => x.date).filter(Boolean);
  return dates.length ? dates.sort()[0] : null;
}

/** Why the free first booking is not available, in words. null = no explanation needed. */
export function freeTrialBlockerText(
  blocker: NonNullable<BookingEstimateResponse["freeTrial"]["blocker"]>,
): string {
  switch (blocker) {
    case "PHONE_NOT_SUBMITTED":
      return "Add and verify your phone number to use your free first booking.";
    case "PHONE_NOT_VERIFIED":
      return "Verify your phone number to use your free first booking.";
    case "ADDRESS_NOT_SET":
      return "Save your home address to use your free first booking.";
    case "USED":
      return "The free first booking is not available for this account.";
  }
}

export type BookingFailure =
  | { kind: "not_found" }
  | { kind: "too_many_open"; message: string }
  | { kind: "trial_used"; message: string }
  | { kind: "phone"; message: string }
  | { kind: "address"; message: string }
  | { kind: "date_conflict"; message: string; fields: FieldErrors }
  | { kind: "fields"; message: string; fields: FieldErrors }
  | { kind: "signed_out" }
  | { kind: "other"; message: string };

/** Sorts an error from POST /api/bookings into what the screen should do about it. */
export function classifyBookingError(err: unknown): BookingFailure {
  if (!(err instanceof ApiClientError))
    return {
      kind: "other",
      message: "Something went wrong. Please try again.",
    };
  switch (err.code) {
    case "NOT_FOUND":
      return { kind: "not_found" };
    case "UNAUTHENTICATED":
      return { kind: "signed_out" };
    case "TOO_MANY_OPEN_REQUESTS":
      return { kind: "too_many_open", message: err.message };
    case "FREE_TRIAL_USED":
      return { kind: "trial_used", message: err.message };
    case "PHONE_NOT_SUBMITTED":
    case "PHONE_NOT_VERIFIED":
      return { kind: "phone", message: err.message };
    case "ADDRESS_NOT_SET":
      return { kind: "address", message: err.message };
    case "DOUBLE_BOOKED":
    case "DATE_BOOKED": {
      const fields = err.issues
        ? issuesToErrors(err.issues)
        : normalizeServerFields(err.fields);
      return {
        kind: "date_conflict",
        message:
          "The chef was booked on one of those days while you were filling this in. Choose a different date.",
        fields,
      };
    }
    case "VALIDATION_FAILED":
    case "CONTACT_DETAILS_NOT_ALLOWED": {
      const fields = {
        ...(err.issues ? issuesToErrors(err.issues) : {}),
        ...normalizeServerFields(err.fields),
      };
      return {
        kind: "fields",
        message: "Some answers need fixing before the request can be sent.",
        fields,
      };
    }
    default:
      return { kind: "other", message: err.message };
  }
}

/** True when a 200 estimate says the request could be sent as it is. */
export function estimateIsSendable(r: BookingEstimateResponse): boolean {
  return r.ok && r.estimate !== null && !r.estimate.exceedsSoftLimit;
}

const WHEN = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** A moment as Toronto wall-clock text, for example "Mon, Oct 12, 12:00 a.m.". */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : WHEN.format(d);
}
