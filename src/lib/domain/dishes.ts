// Dish and availability rules (T-032, contract sections 5A and 5B). Pure functions, no I/O and no
// server imports, so they are unit-tested without a database and the routes stay thin.
import { hasUnsafeText } from "./text-safety.ts";

// ---------------------------------------------------------------------------
// Limits (contract 5A and 5B; bounds decided by Jimmy as D-16, some also enforced by a database check)
// ---------------------------------------------------------------------------
export const NAME_MAX = 120; // database check
export const DESCRIPTION_MAX = 1000; // database check
export const CUISINE_MAX = 40;
export const COOK_MINUTES_MIN = 5;
/** The 6 hour soft visit limit (CLAUDE.md 6.5): no single dish may be longer than a visit. */
export const COOK_MINUTES_MAX = 360;
export const COST_MAX_CENTS = 50000;
export const SERVINGS_MAX = 50;
export const ALLERGENS_MAX = 14;
export const ALLERGEN_ENTRY_MAX = 40;
export const SHELF_LIFE_MAX_DAYS = 7; // database check
export const DEFAULT_SHELF_LIFE_DAYS = 2; // A-7
/** Mirrored by the database trigger dishes_active_cap (migration T-032). */
export const MAX_ACTIVE_DISHES = 50;

export const AVAILABILITY_HORIZON_DAYS = 180;
export const MAX_DATES_PER_LIST = 200;

export const CREATE_DISH_KEYS = [
  "name",
  "cuisine",
  "cookMinutes",
  "photoPath",
  "description",
  "ingredientCostCents",
  "servings",
  "allergens",
  "shelfLifeDays",
] as const;
export const UPDATE_DISH_KEYS = [...CREATE_DISH_KEYS, "isActive"] as const;
export const AVAILABILITY_KEYS = ["add", "remove"] as const;

export interface ParsedDish {
  name?: string;
  cuisine?: string;
  cookMinutes?: number;
  photoPath?: string | null;
  description?: string | null;
  ingredientCostCents?: number;
  servings?: number;
  allergens?: string[];
  shelfLifeDays?: number;
  isActive?: boolean;
}

const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** A trimmed single-line string of min..max characters without unsafe characters, else undefined. */
function line(v: unknown, min: number, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t.length < min || t.length > max || hasUnsafeText(t)) return undefined;
  return t;
}

function allergenList(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length > ALLERGENS_MAX) return undefined;
  const seen = new Set<string>();
  for (const e of v) {
    const t = line(e, 1, ALLERGEN_ENTRY_MAX);
    if (t === undefined) return undefined;
    seen.add(t.toLowerCase());
  }
  return [...seen];
}

/**
 * Validates a dish body. Create requires name, cuisine and cookMinutes and fills the defaults;
 * update returns only the keys that were sent. Unknown keys are the route's job (rejectUnknownKeys),
 * except `isActive`, which only update accepts. `photoPath` is only checked for its type here: the
 * path rules and the object probe need the caller and storage.
 */
export function parseDishBody(
  body: Record<string, unknown>,
  mode: "create" | "update",
): { value: ParsedDish; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const value: ParsedDish = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const need = (k: string) => mode === "update" && !has(k);

  if (!need("name")) {
    const t = line(body.name, 1, NAME_MAX);
    if (t !== undefined) value.name = t;
    else
      errors.name =
        typeof body.name === "string" &&
        body.name.trim().length > 0 &&
        body.name.trim().length <= NAME_MAX
          ? "Remove control or invalid characters."
          : `Enter 1 to ${NAME_MAX} characters.`;
  }

  if (!need("cuisine")) {
    const t = line(body.cuisine, 1, CUISINE_MAX);
    if (t !== undefined) value.cuisine = t;
    else
      errors.cuisine =
        typeof body.cuisine === "string" &&
        body.cuisine.trim().length > 0 &&
        body.cuisine.trim().length <= CUISINE_MAX
          ? "Remove control or invalid characters."
          : `Enter 1 to ${CUISINE_MAX} characters.`;
  }

  if (!need("cookMinutes")) {
    if (intIn(body.cookMinutes, COOK_MINUTES_MIN, COOK_MINUTES_MAX))
      value.cookMinutes = body.cookMinutes;
    else
      errors.cookMinutes = `Enter a whole number of minutes from ${COOK_MINUTES_MIN} to ${COOK_MINUTES_MAX}.`;
  }

  if (has("description")) {
    const v = body.description;
    if (v === null) value.description = null;
    else if (typeof v !== "string" || v.trim().length > DESCRIPTION_MAX)
      errors.description = `Enter up to ${DESCRIPTION_MAX} characters.`;
    else if (hasUnsafeText(v, true))
      errors.description =
        "Use plain text. Control characters are not allowed.";
    else value.description = v.trim() === "" ? null : v.trim();
  }

  const numeric: [
    "ingredientCostCents" | "servings" | "shelfLifeDays",
    number,
    number,
    number,
    string,
  ][] = [
    [
      "ingredientCostCents",
      0,
      COST_MAX_CENTS,
      0,
      "Enter a whole number of cents from 0 to 50000.",
    ],
    [
      "servings",
      1,
      SERVINGS_MAX,
      1,
      `Enter a whole number from 1 to ${SERVINGS_MAX}.`,
    ],
    [
      "shelfLifeDays",
      0,
      SHELF_LIFE_MAX_DAYS,
      DEFAULT_SHELF_LIFE_DAYS,
      `Enter a whole number of days from 0 to ${SHELF_LIFE_MAX_DAYS}.`,
    ],
  ];
  for (const [key, min, max, dflt, message] of numeric) {
    if (has(key)) {
      if (intIn(body[key], min, max)) value[key] = body[key] as number;
      else errors[key] = message;
    } else if (mode === "create") value[key] = dflt;
  }

  if (has("allergens")) {
    const list = allergenList(body.allergens);
    if (list) value.allergens = list;
    else
      errors.allergens = `Enter up to ${ALLERGENS_MAX} allergens, each 1 to ${ALLERGEN_ENTRY_MAX} characters.`;
  } else if (mode === "create") value.allergens = [];

  if (has("photoPath")) {
    const v = body.photoPath;
    if (v === null) value.photoPath = null;
    else if (typeof v === "string" && v.length > 0) value.photoPath = v;
    else errors.photoPath = "Enter the path of the uploaded photo, or null.";
  }

  if (has("isActive")) {
    if (mode === "update" && typeof body.isActive === "boolean")
      value.isActive = body.isActive;
    else
      errors.isActive =
        mode === "update" ? "Enter true or false." : "Unknown field.";
  }

  return { value, errors };
}

// ---------------------------------------------------------------------------
// Dates (America/Toronto calendar dates, YYYY-MM-DD)
// ---------------------------------------------------------------------------
export function isRealDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  // Postgres has no year 0 (JavaScript does), so year 0000 would be a 500 at the database.
  if (v < "0001-01-01") return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today's date in Toronto, the same rule as the booking-day trigger (`now() at time zone`). */
export function torontoToday(now: Date = new Date()): string {
  // The en-CA locale formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export interface ParsedAvailability {
  add: string[];
  remove: string[];
  errors: Record<string, string>;
}

/** `today` is passed in (server clock) so the rule is testable. */
export function parseAvailabilityBody(
  body: Record<string, unknown>,
  today: string,
): ParsedAvailability {
  const errors: Record<string, string> = {};
  const last = addDays(today, AVAILABILITY_HORIZON_DAYS);
  const lists: Record<"add" | "remove", string[]> = { add: [], remove: [] };

  for (const key of AVAILABILITY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const v = body[key];
    if (!Array.isArray(v) || v.length > MAX_DATES_PER_LIST) {
      errors[key] = `Send a list of up to ${MAX_DATES_PER_LIST} dates.`;
      continue;
    }
    if (!v.every(isRealDate)) {
      errors[key] = "Every date must be a real date like 2026-10-08.";
      continue;
    }
    const days = [...new Set(v as string[])].sort();
    if (key === "add" && days.some((d) => d < today || d > last)) {
      errors.add = `Dates must be from ${today} to ${last}.`;
      continue;
    }
    lists[key] = days;
  }

  if (!errors.add && !errors.remove) {
    if (lists.add.length === 0 && lists.remove.length === 0)
      errors.add = "Send at least one date to add or remove.";
    else if (lists.add.some((d) => lists.remove.includes(d)))
      errors.remove = "A date cannot be added and removed in the same request.";
  }
  return { ...lists, errors };
}
