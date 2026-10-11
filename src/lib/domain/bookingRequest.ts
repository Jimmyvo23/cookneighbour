// Booking request parsing (T-042, contract section 7A). Pure: no I/O, no clock. Turns the JSON
// body of POST /api/bookings and /api/bookings/estimate into the typed request the domain rules
// (bookingValidation.ts) understand, reporting every shape problem at once with dotted field keys.
// What is allowed (dates, dishes, service area, availability) is NOT decided here: that is
// validateBooking's job and comes back as issue codes.
//
// D-23: the intake form needs an explicit answer for allergies and for dietary needs. "No
// allergies" is a deliberate tick (`noAllergies`), never an empty box. The allergy text is built
// from the picker values (ALLERGEN_CHOICES) plus free text, so the same words feed the allergy
// conflict check and the chef's view.
import {
  INTAKE_ALLERGY_NOTES_MAX,
  INTAKE_DIETARY_NOTES_MAX,
  REQUEST_EXPIRY_HOURS,
} from "./config.ts";
import { normalizePostalCode } from "./address.ts";
import { isUuid } from "./admin-chefs.ts";
import { torontoStartOfDay } from "./cancellation.ts";
import { ALLERGEN_CHOICES } from "./dishes.ts";
import type { BookingIssue, LocationType } from "./bookingValidation.ts";
import { hasUnsafeText } from "./text-safety.ts";

export const BOOKING_KEYS = [
  "chefId",
  "locationType",
  "address",
  "days",
  "groceryOption",
  "intake",
  "allergyConflictAcknowledged",
  "useFreeTrial",
] as const;

export type GroceryOption = "customer_buys" | "chef_shops";

export interface ParsedBooking {
  chefId: string;
  locationType: LocationType;
  /** Normalized cooking address for customer_home; null otherwise. */
  address: { line: string; city: string; postalCode: string } | null;
  /** In the order sent: issue day indexes refer to this order. */
  days: { date: string; dishes: { dishId: string; quantity: number }[] }[];
  groceryOption: GroceryOption;
  /** undefined when the form is missing or incomplete while estimating (the domain says INTAKE_MISSING). */
  intake: { allergies: string; dietaryNotes: string } | undefined;
  allergyConflictAcknowledged: boolean;
  useFreeTrial: boolean;
}

const MAX_DAYS_SENT = 10;
const MAX_DISHES_PER_DAY = 30;
const UNSAFE = "Remove control or invalid characters.";
const ALLERGEN_VALUES = new Set(ALLERGEN_CHOICES.map((c) => c.value));

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A trimmed string of 1..max safe characters, or records the error under `key`. */
function text(
  errors: Record<string, string>,
  key: string,
  v: unknown,
  max: number,
  allowWhitespace = false,
): string {
  if (typeof v !== "string") {
    errors[key] = "Required.";
    return "";
  }
  const t = v.trim();
  if (t.length < 1 || t.length > max)
    errors[key] = `Enter 1 to ${max} characters.`;
  else if (hasUnsafeText(t, allowWhitespace)) errors[key] = UNSAFE;
  return t;
}

function parseAddress(
  errors: Record<string, string>,
  v: unknown,
): ParsedBooking["address"] {
  if (!isObject(v)) {
    errors.address = "Enter the address where the chef will cook.";
    return null;
  }
  for (const k of Object.keys(v))
    if (!["line", "city", "postalCode"].includes(k))
      errors[`address.${k}`] = "Unknown field.";
  const line = text(errors, "address.line", v.line, 120);
  const city = text(errors, "address.city", v.city, 80);
  const postal =
    typeof v.postalCode === "string" ? normalizePostalCode(v.postalCode) : null;
  if (!postal)
    errors["address.postalCode"] =
      "Enter a valid postal code, for example L5B 1A1.";
  if (Object.keys(errors).some((k) => k.startsWith("address."))) return null;
  return { line, city, postalCode: postal as string };
}

interface IntakeResult {
  value?: { allergies: string; dietaryNotes: string };
  /** What is missing or inconsistent. Only reported when creating. */
  incomplete: Record<string, string>;
  /** Unsafe or too long text, unknown values: reported in both modes. */
  invalid: Record<string, string>;
}

function parseIntake(v: unknown): IntakeResult {
  const incomplete: Record<string, string> = {};
  const invalid: Record<string, string> = {};
  if (!isObject(v)) {
    invalid.intake = "Answer the allergies and dietary questions.";
    return { incomplete, invalid };
  }
  for (const k of Object.keys(v))
    if (
      ![
        "noAllergies",
        "allergens",
        "allergyNotes",
        "noDietaryNeeds",
        "dietaryNotes",
      ].includes(k)
    )
      invalid[`intake.${k}`] = "Unknown field.";

  const flag = (key: string): boolean => {
    const x = v[key];
    if (x === undefined) return false;
    if (typeof x !== "boolean") {
      invalid[`intake.${key}`] = "Use true or false.";
      return false;
    }
    return x;
  };
  const noAllergies = flag("noAllergies");
  const noDietaryNeeds = flag("noDietaryNeeds");

  // Picked allergens: only the picker's values, distinct, lower case.
  const picked: string[] = [];
  if (v.allergens !== undefined) {
    if (!Array.isArray(v.allergens) || v.allergens.length > 50)
      invalid["intake.allergens"] = "Pick allergens from the list.";
    else
      for (const a of v.allergens) {
        const n = typeof a === "string" ? a.trim().toLowerCase() : "";
        if (!ALLERGEN_VALUES.has(n)) {
          invalid["intake.allergens"] = "Pick allergens from the list.";
          break;
        }
        if (!picked.includes(n)) picked.push(n);
      }
  }

  const optionalText = (key: string, max: number): string => {
    const x = v[key];
    if (x === undefined) return "";
    if (typeof x !== "string") {
      invalid[`intake.${key}`] = "Enter text.";
      return "";
    }
    const t = x.trim();
    if (t.length > max)
      invalid[`intake.${key}`] = `Use ${max} characters or fewer.`;
    else if (hasUnsafeText(t, true)) invalid[`intake.${key}`] = UNSAFE;
    return t;
  };
  const allergyNotes = optionalText("allergyNotes", INTAKE_ALLERGY_NOTES_MAX);
  const dietaryNotes = optionalText("dietaryNotes", INTAKE_DIETARY_NOTES_MAX);

  const hasAllergyText = picked.length > 0 || allergyNotes !== "";
  if (noAllergies && hasAllergyText)
    invalid["intake.noAllergies"] =
      'Untick "no allergies", or remove the allergens you listed.';
  else if (!noAllergies && !hasAllergyText)
    incomplete["intake.allergies"] =
      "Say which allergies you have, or confirm that you have none.";
  if (noDietaryNeeds && dietaryNotes !== "")
    invalid["intake.noDietaryNeeds"] =
      'Untick "no dietary needs", or remove the notes.';
  else if (!noDietaryNeeds && dietaryNotes === "")
    incomplete["intake.dietaryNotes"] =
      "Describe your dietary needs, or confirm that you have none.";

  if (Object.keys(invalid).length || Object.keys(incomplete).length)
    return { incomplete, invalid };
  return {
    incomplete,
    invalid,
    value: {
      allergies: noAllergies
        ? "None"
        : [...picked, allergyNotes].filter(Boolean).join(", "),
      dietaryNotes: noDietaryNeeds ? "None" : dietaryNotes,
    },
  };
}

export function parseBookingBody(
  body: Record<string, unknown>,
  mode: "estimate" | "create",
): { value?: ParsedBooking; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  const chefId = typeof body.chefId === "string" ? body.chefId.trim() : "";
  if (!isUuid(chefId)) errors.chefId = "Pick a chef.";

  const locationType = body.locationType;
  if (locationType !== "customer_home" && locationType !== "chef_home")
    errors.locationType = "Use customer_home or chef_home.";
  const groceryOption = body.groceryOption;
  if (groceryOption !== "customer_buys" && groceryOption !== "chef_shops")
    errors.groceryOption = "Use customer_buys or chef_shops.";

  // Days and dishes. Counts outside 1..3 are the domain's DAYS_COUNT, not a shape error.
  const days: ParsedBooking["days"] = [];
  if (!Array.isArray(body.days) || body.days.length > MAX_DAYS_SENT) {
    errors.days = "Send the days as a list of at most 10.";
  } else {
    body.days.forEach((d, i) => {
      if (!isObject(d)) {
        errors[`days.${i}`] = "Each day needs a date and dishes.";
        return;
      }
      if (typeof d.date !== "string")
        errors[`days.${i}.date`] = "Enter a date.";
      const dishes: { dishId: string; quantity: number }[] = [];
      if (!Array.isArray(d.dishes)) {
        errors[`days.${i}.dishes`] = "Send the dishes as a list.";
      } else if (d.dishes.length > MAX_DISHES_PER_DAY) {
        errors[`days.${i}.dishes`] =
          `Use at most ${MAX_DISHES_PER_DAY} dishes a day.`;
      } else {
        d.dishes.forEach((x, j) => {
          const k = `days.${i}.dishes.${j}`;
          if (
            !isObject(x) ||
            typeof x.dishId !== "string" ||
            !isUuid(x.dishId.trim())
          ) {
            errors[`${k}.dishId`] = "Pick a dish from the menu.";
            return;
          }
          if (x.quantity !== undefined && typeof x.quantity !== "number") {
            errors[`${k}.quantity`] = "Use a whole number.";
            return;
          }
          dishes.push({
            dishId: x.dishId.trim().toLowerCase(),
            quantity: x.quantity === undefined ? 1 : x.quantity,
          });
        });
      }
      days.push({ date: typeof d.date === "string" ? d.date : "", dishes });
    });
  }

  // Address: customer_home only.
  let address: ParsedBooking["address"] = null;
  if (locationType === "customer_home") {
    if (body.address === undefined || body.address === null) {
      if (mode === "create")
        errors.address = "Enter the address where the chef will cook.";
    } else address = parseAddress(errors, body.address);
  } else if (locationType === "chef_home") {
    if (body.address !== undefined && body.address !== null)
      errors.address =
        "Do not send an address for a booking at the chef's home.";
  }

  // Intake.
  let intake: ParsedBooking["intake"];
  if (body.intake === undefined) {
    if (mode === "create")
      errors.intake = "Answer the allergies and dietary questions.";
  } else {
    const r = parseIntake(body.intake);
    Object.assign(errors, r.invalid);
    if (mode === "create") Object.assign(errors, r.incomplete);
    intake = r.value;
  }

  let allergyConflictAcknowledged = false;
  if (body.allergyConflictAcknowledged !== undefined) {
    if (typeof body.allergyConflictAcknowledged !== "boolean")
      errors.allergyConflictAcknowledged = "Use true or false.";
    else allergyConflictAcknowledged = body.allergyConflictAcknowledged;
  }
  let useFreeTrial = false;
  if (body.useFreeTrial !== undefined) {
    if (typeof body.useFreeTrial !== "boolean")
      errors.useFreeTrial = "Use true or false.";
    else useFreeTrial = body.useFreeTrial;
  }

  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    value: {
      chefId,
      locationType: locationType as LocationType,
      address,
      days,
      groceryOption: groceryOption as GroceryOption,
      intake,
      allergyConflictAcknowledged,
      useFreeTrial,
    },
  };
}

/**
 * D-19 and D-27: a request expires 72 hours after it is made, or at 00:00 Toronto on day 1,
 * whichever is sooner (so a request for tomorrow expires at midnight if the chef has not answered).
 */
export function requestExpiry(
  now: Date,
  firstDay: string,
  hours = REQUEST_EXPIRY_HOURS,
): Date {
  const byHours = now.getTime() + hours * 3_600_000;
  const byDayOne = torontoStartOfDay(firstDay).getTime();
  return new Date(Math.min(byHours, byDayOne));
}

export type IssueOutcome = "ok" | "hidden" | "double_booked" | "validation";

/**
 * How a list of domain issues answers a create request: a chef who cannot be booked is the same
 * 404 as an unknown chef; only double bookings is a 409 conflict; anything else is a 422 that
 * lists every issue (a double booking included).
 */
export function classifyIssues(issues: readonly BookingIssue[]): IssueOutcome {
  if (issues.length === 0) return "ok";
  if (issues.some((i) => i.code === "CHEF_NOT_BOOKABLE")) return "hidden";
  if (issues.every((i) => i.code === "DOUBLE_BOOKED")) return "double_booked";
  return "validation";
}

/** Field keys for a 422 body. The first message wins when two issues share a key. */
export function issuesToFields(
  issues: readonly BookingIssue[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (k: string, m: string) => {
    if (!(k in out)) out[k] = m;
  };
  for (const i of issues) {
    const d = i.dayIndex ?? 0;
    switch (i.code) {
      case "DAYS_COUNT":
        set("days", i.message);
        break;
      case "DATE_INVALID":
      case "DATE_DUPLICATE":
      case "DATE_IN_PAST":
      case "DATE_TOO_SOON":
      case "DATE_BEYOND_WINDOW":
      case "CHEF_UNAVAILABLE":
      case "DOUBLE_BOOKED":
        set(`days.${d}.date`, i.message);
        break;
      case "NO_DISHES":
      case "DISH_NOT_FOUND":
      case "DISH_INACTIVE":
      case "DISH_DUPLICATE":
      case "QUANTITY_INVALID":
      case "VISIT_TOO_LONG":
        set(`days.${d}.dishes`, i.message);
        break;
      case "LOCATION_NOT_OFFERED":
      case "CHEF_HOME_NOT_ENABLED":
        set("locationType", i.message);
        break;
      case "POSTAL_NOT_GTA":
      case "CHEF_NO_SERVICE_AREA":
      case "OUTSIDE_SERVICE_AREA":
        set("address.postalCode", i.message);
        break;
      case "INTAKE_MISSING":
        set("intake", i.message);
        break;
      case "ALLERGY_NOT_ACKNOWLEDGED":
        set("allergyConflictAcknowledged", i.message);
        break;
      case "CHEF_NOT_BOOKABLE":
        set("chefId", i.message);
        break;
    }
  }
  return out;
}
