// Booking request validation (CLAUDE.md 6.4, 6.5 and 10). Pure: the caller loads the chef, their
// dishes, availability and existing booked dates, and passes the server's `today` (Toronto). No
// database, no clock. Every problem is reported (not only the first) as a stable `code`, so the UI
// can show them all and tests can pin each rule. The routes (T-042) map codes to HTTP statuses.
//
// The free-trial decision is NOT here: that is T-038. The database triggers stay the last line of
// defence (double booking, past date, chef status and location rules).
import { normalizePostalCode } from "./address.ts";
import { allergyAcknowledgementIssue } from "./bookingIntake.ts";
import { AVAILABILITY_HORIZON_DAYS, addDays, isRealDate } from "./dishes.ts";
import {
  MAX_BOOKING_DAYS,
  MAX_DISH_QUANTITY,
  MIN_BOOKING_DAYS,
  VISIT_SOFT_LIMIT_MINUTES,
} from "./config.ts";
import { type AllergyConflict } from "./allergy.ts";
import {
  centreForPostal,
  distanceMetres,
  type LatLng,
  type PrefixCentres,
} from "./distance.ts";
import { checkVisitLimits, type VisitLimitWarning } from "./visitLimit.ts";

export type LocationType = "customer_home" | "chef_home";

export type BookingIssueCode =
  | "DAYS_COUNT"
  | "DATE_INVALID"
  | "DATE_DUPLICATE"
  | "DATE_IN_PAST"
  | "DATE_TOO_SOON"
  | "DATE_BEYOND_WINDOW"
  | "CHEF_NOT_BOOKABLE"
  | "LOCATION_NOT_OFFERED"
  | "CHEF_HOME_NOT_ENABLED"
  | "CHEF_UNAVAILABLE"
  | "DOUBLE_BOOKED"
  | "POSTAL_NOT_GTA"
  | "CHEF_NO_SERVICE_AREA"
  | "OUTSIDE_SERVICE_AREA"
  | "NO_DISHES"
  | "DISH_NOT_FOUND"
  | "DISH_INACTIVE"
  | "DISH_DUPLICATE"
  | "QUANTITY_INVALID"
  | "VISIT_TOO_LONG"
  | "INTAKE_MISSING"
  | "ALLERGY_NOT_ACKNOWLEDGED";

export interface BookingIssue {
  code: BookingIssueCode;
  message: string;
  /** Zero-based day index when the issue belongs to one day. */
  dayIndex?: number;
  dishId?: string;
}

export interface BookableDish {
  id: string;
  chefId: string;
  name: string;
  isActive: boolean;
  cookMinutes: number;
  ingredientCostCents: number;
  allergens: readonly string[];
  shelfLifeDays: number;
}

export interface BookingChef {
  id: string;
  status: "pending" | "approved" | "rejected";
  locationOptions: readonly LocationType[];
  chefHomeEnabled: boolean;
  serviceRadiusKm: number;
  /** Centre of the chef's service postal prefix (A-1); null when not set. */
  serviceCentre: LatLng | null;
  /** Dates the chef marked bookable (D-15, opt-in). */
  availableDates: ReadonlySet<string> | readonly string[];
  dishes: readonly BookableDish[];
}

export interface BookingRequest {
  locationType: LocationType;
  /** Cooking address postal code; required for customer_home. */
  customerPostal?: string;
  days: { date: string; dishes: { dishId: string; quantity: number }[] }[];
  /** The mandatory intake form (CLAUDE.md 6.4 step 2). */
  intake?: { allergies: string; dietaryNotes: string };
  allergyConflictAcknowledged?: boolean;
}

export interface BookingContext {
  /** Today's date in Toronto, from the server (torontoToday). */
  today: string;
  /** The chef's dates already held by a requested, accepted, completed or no-show booking (A-9). */
  chefBookedDates: ReadonlySet<string> | readonly string[];
  centres: PrefixCentres;
  softLimitMinutes?: number;
}

export interface ResolvedDay {
  date: string;
  dishes: {
    id: string;
    name: string;
    quantity: number;
    cookMinutes: number;
    ingredientCostCents: number;
    allergens: readonly string[];
    shelfLifeDays: number;
  }[];
}

export interface BookingValidation {
  ok: boolean;
  errors: BookingIssue[];
  /** Per-day soft-limit warnings; each also appears as a VISIT_TOO_LONG error. */
  warnings: VisitLimitWarning[];
  allergyConflicts: AllergyConflict[];
  /** Chef to customer distance in metres for customer_home, else null. */
  distanceMetres: number | null;
  /** Resolved dishes per day, ready for estimateBooking. Empty when ok is false for dish reasons. */
  days: ResolvedDay[];
}

const has = (s: ReadonlySet<string> | readonly string[], v: string) =>
  Array.isArray(s) ? s.includes(v) : (s as ReadonlySet<string>).has(v);

export function validateBooking(
  req: BookingRequest,
  chef: BookingChef,
  ctx: BookingContext,
): BookingValidation {
  const errors: BookingIssue[] = [];
  const add = (
    code: BookingIssueCode,
    message: string,
    extra: Pick<BookingIssue, "dayIndex" | "dishId"> = {},
  ) => errors.push({ code, message, ...extra });
  const result = (
    extra: Partial<BookingValidation> = {},
  ): BookingValidation => ({
    ok: errors.length === 0,
    errors,
    warnings: [],
    allergyConflicts: [],
    distanceMetres: null,
    days: [],
    ...extra,
  });

  // A pending or rejected chef must never be bookable (and never reveal more than that).
  if (chef.status !== "approved") {
    add("CHEF_NOT_BOOKABLE", "This chef is not available for booking.");
    return result();
  }

  // Location.
  if (!chef.locationOptions.includes(req.locationType))
    add(
      "LOCATION_NOT_OFFERED",
      req.locationType === "chef_home"
        ? "This chef does not cook at their own home."
        : "This chef does not cook at the customer's home.",
    );
  else if (req.locationType === "chef_home" && !chef.chefHomeEnabled)
    add(
      "CHEF_HOME_NOT_ENABLED",
      "This chef's home kitchen has not been approved yet.",
    );

  // Service area, customer's home only (chef's-home bookings have no travel).
  let distance: number | null = null;
  if (req.locationType === "customer_home") {
    const here =
      typeof req.customerPostal === "string" &&
      normalizePostalCode(req.customerPostal) // a full postal code, not just a prefix
        ? centreForPostal(ctx.centres, req.customerPostal)
        : null;
    if (!here)
      add("POSTAL_NOT_GTA", "Enter a postal code in the Greater Toronto Area.");
    else if (!chef.serviceCentre)
      add("CHEF_NO_SERVICE_AREA", "This chef has not set a service area.");
    else {
      distance = distanceMetres(chef.serviceCentre, here);
      if (distance > chef.serviceRadiusKm * 1000)
        add(
          "OUTSIDE_SERVICE_AREA",
          `This chef travels up to ${chef.serviceRadiusKm} km and your address is farther away.`,
        );
    }
  }

  // Days.
  const days = Array.isArray(req.days) ? req.days : [];
  if (days.length < MIN_BOOKING_DAYS || days.length > MAX_BOOKING_DAYS) {
    add("DAYS_COUNT", `Book ${MIN_BOOKING_DAYS} to ${MAX_BOOKING_DAYS} days.`);
    if (days.length === 0 || !Array.isArray(req.days))
      return result({ distanceMetres: distance });
  }
  const last = addDays(ctx.today, AVAILABILITY_HORIZON_DAYS);
  const seenDates = new Set<string>();
  const dishById = new Map(chef.dishes.map((d) => [d.id, d]));
  const resolved: ResolvedDay[] = [];

  days.forEach((day, dayIndex) => {
    const date = day?.date;
    if (!isRealDate(date)) {
      add("DATE_INVALID", "Enter a real date like 2026-10-08.", { dayIndex });
    } else {
      if (seenDates.has(date))
        add("DATE_DUPLICATE", "Each day must be a different date.", {
          dayIndex,
        });
      seenDates.add(date);
      if (date < ctx.today)
        add("DATE_IN_PAST", "That date has already passed.", { dayIndex });
      // D-27: no same-day bookings; the earliest day 1 is tomorrow (Toronto).
      else if (date === ctx.today)
        add(
          "DATE_TOO_SOON",
          "Bookings start tomorrow at the earliest. Pick a later date.",
          { dayIndex },
        );
      else if (date > last)
        add("DATE_BEYOND_WINDOW", `Dates can be up to ${last}.`, { dayIndex });
      else if (!has(chef.availableDates, date))
        add("CHEF_UNAVAILABLE", "The chef is not available on that date.", {
          dayIndex,
        });
      else if (has(ctx.chefBookedDates, date))
        add("DOUBLE_BOOKED", "The chef is already booked on that date.", {
          dayIndex,
        });
    }

    const picked = Array.isArray(day?.dishes) ? day.dishes : [];
    if (picked.length === 0)
      add("NO_DISHES", "Pick at least one dish for each day.", { dayIndex });
    const seenDish = new Set<string>();
    const out: ResolvedDay["dishes"] = [];
    for (const p of picked) {
      const dish = dishById.get(p?.dishId);
      if (!dish || dish.chefId !== chef.id) {
        add("DISH_NOT_FOUND", "That dish is not on this chef's menu.", {
          dayIndex,
          dishId: p?.dishId,
        });
        continue;
      }
      if (!dish.isActive) {
        add("DISH_INACTIVE", "That dish is no longer offered.", {
          dayIndex,
          dishId: dish.id,
        });
        continue;
      }
      if (seenDish.has(dish.id)) {
        add("DISH_DUPLICATE", "Use the quantity instead of repeating a dish.", {
          dayIndex,
          dishId: dish.id,
        });
        continue;
      }
      seenDish.add(dish.id);
      if (
        !Number.isInteger(p.quantity) ||
        p.quantity < 1 ||
        p.quantity > MAX_DISH_QUANTITY
      ) {
        add(
          "QUANTITY_INVALID",
          `Quantity must be a whole number from 1 to ${MAX_DISH_QUANTITY}.`,
          { dayIndex, dishId: dish.id },
        );
        continue;
      }
      out.push({
        id: dish.id,
        name: dish.name,
        quantity: p.quantity,
        cookMinutes: dish.cookMinutes,
        ingredientCostCents: dish.ingredientCostCents,
        allergens: dish.allergens,
        shelfLifeDays: dish.shelfLifeDays,
      });
    }
    resolved.push({ date: isRealDate(date) ? date : "", dishes: out });
  });

  // 6 hour soft limit per visit: the customer must remove dishes or split across days.
  const warnings = checkVisitLimits(
    resolved.map((d) =>
      d.dishes.reduce((s, x) => s + x.cookMinutes * x.quantity, 0),
    ),
    ctx.softLimitMinutes ?? VISIT_SOFT_LIMIT_MINUTES,
  );
  for (const w of warnings)
    add(
      "VISIT_TOO_LONG",
      `This day is ${w.minutes} minutes, ${w.overByMinutes} over the visit limit. Remove dishes or split across days.`,
      { dayIndex: w.dayIndex },
    );

  // Mandatory intake form and allergy conflicts (warn, require acknowledgement).
  const intake = allergyAcknowledgementIssue(
    req.intake,
    resolved.flatMap((d) =>
      d.dishes.map((x) => ({ id: x.id, name: x.name, allergens: x.allergens })),
    ),
    req.allergyConflictAcknowledged === true,
  );
  if (intake.error) add(intake.error.code, intake.error.message);

  return result({
    warnings,
    allergyConflicts: intake.conflicts,
    distanceMetres: distance,
    days: resolved,
  });
}
