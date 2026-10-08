// Pure helpers for the chef dish menu UI (T-034). Validation reuses the server's own pure rules
// (src/lib/domain/dishes.ts, contract 5A) so the form and the API agree; the server stays the
// authority. Money is shown in dollars and sent as integer cents.
import { ApiClientError } from "@/lib/api/client";
import type { CreateDishRequest, Dish } from "@/lib/api/types";
import {
  COOK_MINUTES_MAX,
  COOK_MINUTES_MIN,
  COST_MAX_CENTS,
  DEFAULT_SHELF_LIFE_DAYS,
  MAX_ACTIVE_DISHES,
  SERVINGS_MAX,
  SHELF_LIFE_MAX_DAYS,
  parseDishBody,
} from "@/lib/domain/dishes";
import {
  centsToDollars,
  describeError,
  dollarsToCents,
  parseList,
  type FieldErrors,
} from "@/lib/chef/form";

export { MAX_ACTIVE_DISHES };

/** The priority allergens in Canada, plus gluten. Stored lower case (contract 5A). */
export const ALLERGEN_CHOICES: { value: string; label: string }[] = [
  { value: "milk", label: "Milk" },
  { value: "eggs", label: "Eggs" },
  { value: "peanuts", label: "Peanuts" },
  { value: "tree nuts", label: "Tree nuts" },
  { value: "sesame", label: "Sesame" },
  { value: "soy", label: "Soy" },
  { value: "wheat", label: "Wheat" },
  { value: "gluten", label: "Gluten (other grains)" },
  { value: "fish", label: "Fish" },
  { value: "crustaceans", label: "Crustaceans (shrimp, crab)" },
  { value: "molluscs", label: "Molluscs (clams, squid)" },
  { value: "mustard", label: "Mustard" },
  { value: "sulphites", label: "Sulphites" },
];
const CHOICE_VALUES = new Set(ALLERGEN_CHOICES.map((c) => c.value));

export const COST_MESSAGE = `Enter an amount in dollars from $0.00 to $${(COST_MAX_CENTS / 100).toFixed(2)}.`;

export interface DishFormValues {
  name: string;
  cuisine: string;
  description: string;
  cookMinutes: string;
  /** Dollars, for example "25.00". */
  cost: string;
  servings: string;
  shelfLifeDays: string;
  /** Ticked priority allergens (lower case). */
  allergens: string[];
  /** Free text, comma separated. */
  otherAllergens: string;
}

export function emptyDishForm(): DishFormValues {
  return {
    name: "",
    cuisine: "",
    description: "",
    cookMinutes: "",
    cost: "0.00",
    servings: "1",
    shelfLifeDays: String(DEFAULT_SHELF_LIFE_DAYS),
    allergens: [],
    otherAllergens: "",
  };
}

export function dishToForm(d: Dish): DishFormValues {
  return {
    name: d.name,
    cuisine: d.cuisine,
    description: d.description ?? "",
    cookMinutes: String(d.cookMinutes),
    cost: centsToDollars(d.ingredientCostCents),
    servings: String(d.servings),
    shelfLifeDays: String(d.shelfLifeDays),
    allergens: d.allergens.filter((a) => CHOICE_VALUES.has(a)),
    otherAllergens: d.allergens.filter((a) => !CHOICE_VALUES.has(a)).join(", "),
  };
}

/** Whole numbers only; anything else becomes NaN so the shared rule reports its own message. */
const wholeNumber = (t: string) =>
  /^\d{1,6}$/.test(t.trim()) ? Number(t) : NaN;

/**
 * Builds the request body from the form. `photoPath` is included only when a new photo was
 * uploaded (an unchanged photo is simply not sent). Errors are keyed like the API's `fields`.
 */
export function buildDishBody(
  v: DishFormValues,
  opts: { mode: "create" | "update"; photoPath?: string },
): { body?: CreateDishRequest; errors: FieldErrors } {
  const cents = dollarsToCents(v.cost);
  const raw: Record<string, unknown> = {
    name: v.name,
    cuisine: v.cuisine,
    description: v.description,
    cookMinutes: wholeNumber(v.cookMinutes),
    ingredientCostCents: cents ?? NaN,
    servings: wholeNumber(v.servings),
    shelfLifeDays: wholeNumber(v.shelfLifeDays),
    allergens: [...v.allergens, ...parseList(v.otherAllergens)],
  };
  if (opts.photoPath) raw.photoPath = opts.photoPath;
  const { value, errors } = parseDishBody(raw, opts.mode);
  if (errors.ingredientCostCents) errors.ingredientCostCents = COST_MESSAGE;
  if (Object.keys(errors).length) return { errors };
  return { body: value as CreateDishRequest, errors: {} };
}

/** API field errors in the words the form uses (the API speaks cents, the form dollars). */
export function formFieldErrors(fields: Record<string, string>): FieldErrors {
  const out = { ...fields };
  if (out.ingredientCostCents) out.ingredientCostCents = COST_MESSAGE;
  return out;
}

export function describeDishError(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === "INVALID_STATE")
      return `You already have ${MAX_ACTIVE_DISHES} active dishes. Deactivate one first, then try again.`;
    if (err.code === "NOT_FOUND")
      return "That dish could not be found. Reload the page.";
    if (
      err.code === "FORBIDDEN" &&
      err.status === 403 &&
      /folder/.test(err.message)
    )
      return "The photo was not accepted. Choose the photo and try again.";
  }
  return describeError(err);
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function eatByText(days: number): string {
  if (days === 0) return "Eat the same day";
  return `Eat within ${days} ${days === 1 ? "day" : "days"} of cooking`;
}

export function activeCount(dishes: Pick<Dish, "isActive">[]): number {
  return dishes.filter((d) => d.isActive).length;
}

/** Public URL of a dish photo (bucket dish-photos is public). Null in mock mode or without config. */
export function dishPhotoUrl(
  path: string | null,
  supabaseUrl?: string,
): string | null {
  if (!path || !supabaseUrl) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/dish-photos/${encoded}`;
}

export const LIMITS = {
  cookMinutes: [COOK_MINUTES_MIN, COOK_MINUTES_MAX],
  servings: [1, SERVINGS_MAX],
  shelfLifeDays: [0, SHELF_LIFE_MAX_DAYS],
} as const;

/** True when the server refused the uploaded photo path (403, or a photoPath field error), so the
 *  file must be uploaded again. Any other save failure keeps the upload for the retry. */
export function uploadRejected(err: unknown): boolean {
  return (
    err instanceof ApiClientError &&
    (err.status === 403 || Boolean(err.fields.photoPath))
  );
}
