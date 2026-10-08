// Server side of the dish and availability routes (T-032, contract sections 5A and 5B).
//
// Authorization (contract section 2): every function takes a ChefCaller from requireChef(), which
// took the identity from getUser() and the role from profiles.role. Clients cannot write dishes or
// availability any more (T-032 migration), so these functions write with the service role after the
// checks. Every write is built from a whitelist of columns and filtered by chef_id = caller, never
// by an id alone.
import "server-only";
import { ApiFailure, validationFailed } from "@/lib/api/errors";
import { rejectUnknownKeys } from "@/lib/api/request";
import type {
  AvailabilityResponse,
  Dish,
  SetAvailabilityRequest,
} from "@/lib/api/types";
import { checkStoragePath } from "@/lib/domain/chef-application";
import {
  AVAILABILITY_HORIZON_DAYS,
  AVAILABILITY_KEYS,
  CREATE_DISH_KEYS,
  UPDATE_DISH_KEYS,
  addDays,
  parseAvailabilityBody,
  parseDishBody,
  torontoToday,
  type ParsedDish,
} from "@/lib/domain/dishes";
import type { ChefCaller } from "@/lib/server/chef-application";
import { objectExists } from "@/lib/server/storage";

type Row = Record<string, unknown>;

const DISH_COLUMNS =
  "id, name, photo_path, description, cuisine, cook_minutes, ingredient_cost_cents, servings, allergens, shelf_life_days, is_active, currency, created_at, updated_at";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Postgres program_limit_exceeded, raised by the dishes_active_cap trigger. */
const CAP_CODE = "54000";

const iso = (v: unknown) => new Date(v as string).toISOString();

export function mapDish(r: Row): Dish {
  return {
    id: r.id as string,
    name: r.name as string,
    photoPath: (r.photo_path as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    cuisine: r.cuisine as string,
    cookMinutes: r.cook_minutes as number,
    ingredientCostCents: r.ingredient_cost_cents as number,
    servings: r.servings as number,
    allergens: (r.allergens as string[]) ?? [],
    shelfLifeDays: r.shelf_life_days as number,
    isActive: r.is_active as boolean,
    currency: r.currency as string,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/** Whitelisted column values for an insert or update. Only keys that were sent are included. */
function dishColumns(v: ParsedDish): Row {
  const out: Row = {};
  if (v.name !== undefined) out.name = v.name;
  if (v.cuisine !== undefined) out.cuisine = v.cuisine;
  if (v.cookMinutes !== undefined) out.cook_minutes = v.cookMinutes;
  if (v.photoPath !== undefined) out.photo_path = v.photoPath;
  if (v.description !== undefined) out.description = v.description;
  if (v.ingredientCostCents !== undefined)
    out.ingredient_cost_cents = v.ingredientCostCents;
  if (v.servings !== undefined) out.servings = v.servings;
  if (v.allergens !== undefined) out.allergens = v.allergens;
  if (v.shelfLifeDays !== undefined) out.shelf_life_days = v.shelfLifeDays;
  if (v.isActive !== undefined) out.is_active = v.isActive;
  return out;
}

function capReached(): ApiFailure {
  return new ApiFailure(
    "INVALID_STATE",
    "You already have 50 active dishes. Deactivate one first.",
  );
}

/**
 * Validates a dish body: unknown keys, field rules, then the photo (own folder and name rule, 403
 * for a foreign folder before any storage call; the object must exist in dish-photos).
 * `currentPhoto` is the stored path, so sending it again skips the storage probe.
 */
async function checkedDish(
  chef: ChefCaller,
  body: Record<string, unknown>,
  mode: "create" | "update",
  currentPhoto: string | null,
): Promise<ParsedDish> {
  rejectUnknownKeys(body, [
    ...(mode === "create" ? CREATE_DISH_KEYS : UPDATE_DISH_KEYS),
  ]);
  const { value, errors } = parseDishBody(body, mode);

  let probe: { bucket: string; path: string } | null = null;
  if (typeof value.photoPath === "string") {
    const c = checkStoragePath("dish_photo", chef.userId, value.photoPath);
    if (!c.ok) {
      if (c.kind === "foreign") throw new ApiFailure("FORBIDDEN", c.message);
      errors.photoPath = c.message;
    } else if (value.photoPath !== currentPhoto) {
      probe = { bucket: c.bucket, path: c.path };
    }
  }
  if (Object.keys(errors).length) throw validationFailed(errors);
  if (probe && !(await objectExists(chef.admin, probe.bucket, probe.path)))
    throw validationFailed({
      photoPath: "Upload the photo first, then save its path.",
    });
  return value;
}

export async function listDishes(chef: ChefCaller): Promise<Dish[]> {
  const { data, error } = await chef.supabase
    .from("dishes")
    .select(DISH_COLUMNS)
    .eq("chef_id", chef.userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true });
  if (error) throw new Error(`dishes load failed: ${error.message}`);
  return (data ?? []).map(mapDish);
}

export async function createDish(
  chef: ChefCaller,
  body: Record<string, unknown>,
): Promise<Dish> {
  const value = await checkedDish(chef, body, "create", null);
  const { data, error } = await chef.admin
    .from("dishes")
    .insert({ ...dishColumns(value), chef_id: chef.userId, is_active: true })
    .select(DISH_COLUMNS)
    .single();
  if (error?.code === CAP_CODE) throw capReached();
  if (error || !data) throw new Error(`dish insert failed: ${error?.message}`);
  return mapDish(data);
}

export async function updateDish(
  chef: ChefCaller,
  id: string,
  body: Record<string, unknown>,
): Promise<Dish> {
  const notFound = () => new ApiFailure("NOT_FOUND", "Dish not found.");
  // Ownership first: the same answer for a missing dish, another chef's dish and a bad id.
  if (!UUID_RE.test(id)) throw notFound();
  const current = await chef.supabase
    .from("dishes")
    .select(DISH_COLUMNS)
    .eq("id", id)
    .eq("chef_id", chef.userId)
    .maybeSingle();
  if (current.error)
    throw new Error(`dish load failed: ${current.error.message}`);
  if (!current.data) throw notFound();

  const value = await checkedDish(
    chef,
    body,
    "update",
    (current.data.photo_path as string | null) ?? null,
  );
  const columns = dishColumns(value);
  if (Object.keys(columns).length === 0) return mapDish(current.data);

  // One conditional statement: the id AND the owner, so a dish can never be written through a
  // guessed id, and a dish removed in between is a 404 rather than a silent no-op.
  const { data, error } = await chef.admin
    .from("dishes")
    .update(columns)
    .eq("id", id)
    .eq("chef_id", chef.userId)
    .select(DISH_COLUMNS)
    .maybeSingle();
  if (error?.code === CAP_CODE) throw capReached();
  if (error) throw new Error(`dish update failed: ${error.message}`);
  if (!data) throw notFound();
  return mapDish(data);
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------
export async function readAvailability(
  chef: ChefCaller,
  now: Date = new Date(),
): Promise<AvailabilityResponse> {
  const today = torontoToday(now);
  const { data, error } = await chef.supabase
    .from("availability")
    .select("day")
    .eq("chef_id", chef.userId)
    .eq("available", true)
    .gte("day", today)
    .order("day", { ascending: true });
  if (error) throw new Error(`availability load failed: ${error.message}`);
  return {
    days: (data ?? []).map((r) => r.day as string),
    today,
    lastBookableDay: addDays(today, AVAILABILITY_HORIZON_DAYS),
  };
}

export async function setAvailability(
  chef: ChefCaller,
  body: Record<string, unknown>,
  now: Date = new Date(),
): Promise<AvailabilityResponse> {
  rejectUnknownKeys(body, [...AVAILABILITY_KEYS]);
  const req = parseAvailabilityBody(body, torontoToday(now));
  if (Object.keys(req.errors).length) throw validationFailed(req.errors);
  const typed: SetAvailabilityRequest = { add: req.add, remove: req.remove };

  // Disjoint sets and idempotent statements: a failure between the two is fixed by sending the
  // same request again.
  if (typed.add && typed.add.length > 0) {
    const r = await chef.admin.from("availability").upsert(
      typed.add.map((day) => ({
        chef_id: chef.userId,
        day,
        available: true,
      })),
      { onConflict: "chef_id,day" },
    );
    if (r.error)
      throw new Error(`availability upsert failed: ${r.error.message}`);
  }
  if (typed.remove && typed.remove.length > 0) {
    const r = await chef.admin
      .from("availability")
      .delete()
      .eq("chef_id", chef.userId)
      .in("day", typed.remove);
    if (r.error)
      throw new Error(`availability delete failed: ${r.error.message}`);
  }
  return readAvailability(chef, now);
}
