// Server side of the chef application routes (T-031, contract section 5).
//
// Authorization (contract section 2): requireChef() takes the identity from getUser() and the role
// from profiles.role (requireCaller), answers 403 for any other role, and only then builds the
// service-role client. Reads use the user-scoped client so RLS applies; writes use the service
// role because clients can no longer UPDATE chefs or chef_private (decision D-12). Every write
// is built from a whitelist of columns, never from the request body.
//
// MOCK: the ID, food-handler, kitchen and police statuses are simulated outcomes recorded by an
// admin. Nothing here verifies a document.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiFailure, validationFailed } from "@/lib/api/errors";
import { rejectUnknownKeys } from "@/lib/api/request";
import type { ChefApplication, DocumentKind } from "@/lib/api/types";
import { postalPrefix } from "@/lib/domain/address";
import {
  MAX_KITCHEN_PHOTOS,
  UPDATE_KEYS,
  checkStoragePath,
  computeMissing,
  parseUpdateBody,
  planPrivateChange,
  planSubmit,
  type ParsedUpdate,
  type PrivateChange,
  type PrivatePlan,
  type PrivateState,
} from "@/lib/domain/chef-application";
import { requireCaller, type Caller } from "@/lib/server/caller";
import { CHEF_COLUMNS, mapChef } from "@/lib/server/me";
import { objectExists, removeObject } from "@/lib/server/storage";
import { createAdminClient } from "@/lib/supabase/admin";

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
const PRIVATE_COLUMNS =
  "reject_reason, police_check_status, id_check_status, food_handler_status, kitchen_status, id_document_path, food_handler_path, kitchen_photo_paths, kitchen_address_line, kitchen_city, kitchen_postal_code, allergen_ack_at, kitchen_hygiene_ack_at, updated_at";

export interface ChefState {
  chef: Row;
  priv: Row;
  phoneVerified: boolean;
  sampleDishCount: number;
}

export interface ChefCaller extends Caller {
  /** Service-role client. Created only after the role check; use it for the writes below. */
  admin: SupabaseClient;
  /** State as read when the request started. */
  state: ChefState;
}

/** Reads the caller's own rows (RLS applies). Null when the chefs or chef_private row is missing. */
export async function loadState(
  db: SupabaseClient,
  id: string,
): Promise<ChefState | null> {
  const [chef, priv, phone, dishes] = await Promise.all([
    db.from("chefs").select(CHEF_COLUMNS).eq("profile_id", id).maybeSingle(),
    db
      .from("chef_private")
      .select(PRIVATE_COLUMNS)
      .eq("chef_id", id)
      .maybeSingle(),
    db
      .from("profile_private")
      .select("phone_verified")
      .eq("profile_id", id)
      .maybeSingle(),
    // "Sample menu with photos" (CLAUDE.md 6.7): active dishes that have a photo.
    db
      .from("dishes")
      .select("id", { count: "exact", head: true })
      .eq("chef_id", id)
      .eq("is_active", true)
      .not("photo_path", "is", null),
  ]);
  for (const [what, r] of [
    ["chef", chef],
    ["chef_private", priv],
    ["profile_private", phone],
    ["dishes", dishes],
  ] as const)
    if (r.error) throw new Error(`${what} load failed: ${r.error.message}`);
  if (!chef.data || !priv.data) return null;
  return {
    chef: chef.data as Row,
    priv: priv.data as Row,
    phoneVerified: Boolean((phone.data as Row | null)?.phone_verified),
    sampleDishCount: dishes.count ?? 0,
  };
}

/**
 * Creates the chefs and chef_private rows idempotently (ON CONFLICT DO NOTHING) when sign-up was
 * interrupted before the route wrote them (T-028 review note N-e). Service role: clients have no
 * insert policy on these tables. The name comes from profiles, the single source.
 */
async function repairChefRows(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  const profile = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .single();
  if (profile.error || !profile.data)
    throw new Error(`profile lookup failed: ${profile.error?.message}`);
  const c1 = await admin.from("chefs").upsert(
    {
      profile_id: userId,
      status: "pending",
      display_name: profile.data.display_name,
    },
    { onConflict: "profile_id", ignoreDuplicates: true },
  );
  if (c1.error) throw new Error(`chef row repair failed: ${c1.error.message}`);
  const c2 = await admin
    .from("chef_private")
    .upsert(
      { chef_id: userId },
      { onConflict: "chef_id", ignoreDuplicates: true },
    );
  if (c2.error)
    throw new Error(`chef_private row repair failed: ${c2.error.message}`);
}

/**
 * Gate for every chef application route: signed in (401), role chef from the database (403),
 * then the service-role client, then the caller's own rows (repaired if sign-up left them out).
 * Every route repairs, not only GET, so a chef with a broken sign-up is never stuck on a 500.
 */
export async function requireChef(): Promise<ChefCaller> {
  const caller = await requireCaller();
  if (caller.role !== "chef")
    throw new ApiFailure("FORBIDDEN", "Only chef accounts can do this.");
  const admin = createAdminClient();
  let state = await loadState(caller.supabase, caller.userId);
  if (!state) {
    await repairChefRows(admin, caller.userId);
    state = await loadState(caller.supabase, caller.userId);
    if (!state) throw new Error("chef rows still missing after repair");
  }
  return { ...caller, admin, state };
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------
function iso(v: unknown): string | null {
  return typeof v === "string" ? new Date(v).toISOString() : null;
}

function kitchenAddressOf(priv: Row): PrivateState["kitchenAddress"] {
  return priv.kitchen_address_line &&
    priv.kitchen_city &&
    priv.kitchen_postal_code
    ? {
        line: priv.kitchen_address_line as string,
        city: priv.kitchen_city as string,
        postalCode: priv.kitchen_postal_code as string,
      }
    : null;
}

export function privateStateOf(priv: Row): PrivateState {
  return {
    idDocumentPath: (priv.id_document_path as string | null) ?? null,
    foodHandlerPath: (priv.food_handler_path as string | null) ?? null,
    kitchenPhotoPaths: (priv.kitchen_photo_paths as string[]) ?? [],
    kitchenAddress: kitchenAddressOf(priv),
    idCheck: priv.id_check_status as PrivateState["idCheck"],
    foodHandlerCheck:
      priv.food_handler_status as PrivateState["foodHandlerCheck"],
    kitchenCheck: priv.kitchen_status as PrivateState["kitchenCheck"],
  };
}

export function toApplication(s: ChefState): ChefApplication {
  const summary = mapChef(s.chef);
  const p = privateStateOf(s.priv);
  const allergenAckAt = iso(s.priv.allergen_ack_at);
  const kitchenHygieneAckAt = iso(s.priv.kitchen_hygiene_ack_at);
  return {
    ...summary,
    rejectReason: (s.priv.reject_reason as string | null) ?? null,
    // MOCK: simulated outcomes recorded by an admin. Read-only for the chef.
    checks: {
      id: p.idCheck,
      foodHandler: p.foodHandlerCheck,
      kitchen: p.kitchenCheck,
      police: s.priv.police_check_status as ChefApplication["checks"]["police"],
    },
    documents: {
      idDocumentPath: p.idDocumentPath,
      foodHandlerPath: p.foodHandlerPath,
      kitchenPhotoPaths: p.kitchenPhotoPaths,
    },
    kitchenAddress: p.kitchenAddress,
    allergenAckAt,
    kitchenHygieneAckAt,
    missing: computeMissing({
      displayName: summary.displayName,
      bio: summary.bio,
      photoPath: summary.photoPath,
      cuisines: summary.cuisines,
      languages: summary.languages,
      hourlyRateCents: summary.hourlyRateCents,
      servicePostalPrefix: summary.servicePostalPrefix,
      locationOptions: summary.locationOptions,
      idDocumentPath: p.idDocumentPath,
      foodHandlerPath: p.foodHandlerPath,
      allergenAckAt,
      phoneVerified: s.phoneVerified,
      sampleDishCount: s.sampleDishCount,
      kitchenAddress: p.kitchenAddress,
      kitchenPhotoPaths: p.kitchenPhotoPaths,
      kitchenHygieneAckAt,
    }),
  };
}

// ---------------------------------------------------------------------------
// Writing: one place that applies a planned change safely
// ---------------------------------------------------------------------------
// A lost race means another request committed, so a request loses at most (parallel requests - 1)
// times. 12 covers a browser registering the maximum of 10 kitchen photos all at once.
const MAX_ATTEMPTS = 12;

interface Step {
  /** chefs columns, written BEFORE the chef_private update (disabling chef's home is the safe direction). */
  chefColumns?: Record<string, unknown>;
  /** chef_private columns, written only if the row has not changed since it was read. */
  privColumns?: Record<string, unknown>;
  /** Runs after the chef_private update succeeded (used by submit to move chefs.status). */
  afterWrite?: (admin: SupabaseClient) => Promise<void>;
}

/** Test seam: lets a test change the row between the read and the write. Routes never pass it. */
export interface MutateHooks {
  afterRead?: () => Promise<void>;
}

const isEmpty = (o: Record<string, unknown> | undefined) =>
  !o || Object.keys(o).length === 0;

/**
 * Reads the caller's state, asks `build` for a Step (it may throw an ApiFailure), and writes it.
 *
 * The chef_private write is conditional on `updated_at` still being the value that was read
 * (optimistic locking). Without it, two requests, or a request racing an admin's MOCK verdict,
 * could overwrite each other: for example an admin verifying the old kitchen photos while the
 * chef adds a new one would leave a changed kitchen marked verified. On a lost race the state is
 * read again and the plan (including the N1 reset) is rebuilt from the new values.
 * The chefs write happens first and only ever switches chef's home OFF, so a failure in between
 * leaves the safe state. After MAX_ATTEMPTS lost races the request is a 409 INVALID_STATE.
 */
async function mutate(
  chef: ChefCaller,
  build: (s: ChefState) => Step,
  hooks?: MutateHooks,
): Promise<ChefState> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const s =
      attempt === 0 ? chef.state : await loadState(chef.supabase, chef.userId);
    if (!s) throw new Error("chef rows disappeared");
    const step = build(s);
    if (hooks?.afterRead) await hooks.afterRead();

    if (!isEmpty(step.chefColumns)) {
      const r = await chef.admin
        .from("chefs")
        .update(step.chefColumns!)
        .eq("profile_id", chef.userId);
      if (r.error) throw new Error(`chefs update failed: ${r.error.message}`);
    }
    if (!isEmpty(step.privColumns)) {
      const r = await chef.admin
        .from("chef_private")
        .update(step.privColumns!)
        .eq("chef_id", chef.userId)
        .eq("updated_at", s.priv.updated_at as string)
        .select("chef_id");
      if (r.error)
        throw new Error(`chef_private update failed: ${r.error.message}`);
      if (r.data.length === 0) continue; // someone else changed the row: read again
    }
    if (step.afterWrite) await step.afterWrite(chef.admin);

    const fresh = await loadState(chef.supabase, chef.userId);
    if (!fresh) throw new Error("chef rows disappeared");
    return fresh;
  }
  throw new ApiFailure(
    "INVALID_STATE",
    "Your application changed while it was being saved. Please try again.",
  );
}

function planToStep(plan: PrivatePlan): Step {
  return {
    privColumns: plan.columns,
    chefColumns: plan.disableChefHome
      ? { chef_home_enabled: false }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// PATCH /api/chef/application
// ---------------------------------------------------------------------------
/**
 * Validates the body (whitelisted keys, ranges, storage-path rule, GTA prefixes, photo exists).
 * A path in another folder is 403 and stops at once; every other problem is one 422 with fields.
 */
export async function checkedUpdate(
  chef: ChefCaller,
  body: Record<string, unknown>,
): Promise<ParsedUpdate> {
  rejectUnknownKeys(body, [...UPDATE_KEYS]);
  const { value, errors } = parseUpdateBody(body);

  let photoToCheck: { bucket: string; path: string } | null = null;
  if (typeof value.photoPath === "string") {
    const c = checkStoragePath("profile_photo", chef.userId, value.photoPath);
    if (!c.ok) {
      if (c.kind === "foreign") throw new ApiFailure("FORBIDDEN", c.message);
      errors.photoPath = c.message;
    } else if (value.photoPath !== chef.state.chef.photo_path) {
      photoToCheck = { bucket: c.bucket, path: c.path };
    }
  }

  // GTA prefixes must exist in postal_prefixes (A-1). Public reference data: user-scoped read.
  const prefixes = new Set<string>();
  if (value.servicePostalPrefix) prefixes.add(value.servicePostalPrefix);
  if (value.kitchenAddress)
    prefixes.add(postalPrefix(value.kitchenAddress.postalCode));
  if (prefixes.size > 0) {
    const r = await chef.supabase
      .from("postal_prefixes")
      .select("prefix")
      .in("prefix", [...prefixes]);
    if (r.error) throw new Error(`prefix lookup failed: ${r.error.message}`);
    const known = new Set((r.data ?? []).map((x) => x.prefix as string));
    if (value.servicePostalPrefix && !known.has(value.servicePostalPrefix))
      errors.servicePostalPrefix = "Not a GTA postal code area.";
    if (
      value.kitchenAddress &&
      !known.has(postalPrefix(value.kitchenAddress.postalCode))
    )
      errors["kitchenAddress.postalCode"] = "Not a GTA postal code.";
  }

  if (photoToCheck && !errors.photoPath) {
    if (
      !(await objectExists(chef.admin, photoToCheck.bucket, photoToCheck.path))
    )
      errors.photoPath = "Upload the photo first, then save its path.";
  }

  if (Object.keys(errors).length) throw validationFailed(errors);
  return value;
}

export async function patchApplication(
  chef: ChefCaller,
  u: ParsedUpdate,
  hooks?: MutateHooks,
): Promise<ChefState> {
  const now = new Date().toISOString(); // server clock, never from the client
  return mutate(
    chef,
    (s) => {
      const change: PrivateChange = {};
      if (u.kitchenAddress) change.kitchenAddress = u.kitchenAddress;
      const plan = planPrivateChange(privateStateOf(s.priv), change);

      // Whitelisted columns only (contract section 2, rule 6). No status, no chef_home_enabled
      // except the reset below, no ratings, no check statuses outside the N1 reset.
      const chefColumns: Record<string, unknown> = {};
      if (u.bio !== undefined) chefColumns.bio = u.bio;
      if (u.photoPath !== undefined) chefColumns.photo_path = u.photoPath;
      if (u.cuisines !== undefined) chefColumns.cuisines = u.cuisines;
      if (u.languages !== undefined) chefColumns.languages = u.languages;
      if (u.hourlyRateCents !== undefined)
        chefColumns.hourly_rate_cents = u.hourlyRateCents;
      if (u.servicePostalPrefix !== undefined)
        chefColumns.service_postal_prefix = u.servicePostalPrefix;
      if (u.serviceRadiusKm !== undefined)
        chefColumns.service_radius_km = u.serviceRadiusKm;
      if (u.locationOptions !== undefined)
        chefColumns.location_options = u.locationOptions;
      if (plan.disableChefHome) chefColumns.chef_home_enabled = false;

      // Acknowledgements: timestamped here, the first acknowledgement time is kept.
      const privColumns = { ...plan.columns };
      if (u.acknowledgeAllergenStatement && !s.priv.allergen_ack_at)
        privColumns.allergen_ack_at = now;
      if (u.acknowledgeKitchenHygiene && !s.priv.kitchen_hygiene_ack_at)
        privColumns.kitchen_hygiene_ack_at = now; // MOCK acknowledgement
      return { chefColumns, privColumns };
    },
    hooks,
  );
}

// ---------------------------------------------------------------------------
// POST and DELETE /api/chef/application/documents
// ---------------------------------------------------------------------------
const REGISTER_KINDS: DocumentKind[] = [
  "id_document",
  "food_handler",
  "kitchen_photo",
];

/**
 * Parses { kind, path }. Unknown keys and a bad kind or path shape are 422, a path outside the
 * caller's folder is 403 (checked before any storage call, so nothing about foreign files leaks).
 */
export function parseDocumentRequest(
  chef: ChefCaller,
  body: Record<string, unknown>,
  mode: "register" | "remove",
): { kind: DocumentKind; bucket: string; path: string } {
  rejectUnknownKeys(body, ["kind", "path"]);
  const errors: Record<string, string> = {};
  const allowed = mode === "register" ? REGISTER_KINDS : ["kitchen_photo"];
  const kind = body.kind as DocumentKind;
  if (typeof body.kind !== "string" || !allowed.includes(body.kind))
    errors.kind =
      mode === "register"
        ? "Choose id_document, food_handler or kitchen_photo."
        : "Only kitchen photos can be removed.";
  if (errors.kind) {
    if (typeof body.path !== "string" || body.path.length === 0)
      errors.path = "Enter the path of the file.";
    throw validationFailed(errors);
  }
  const check = checkStoragePath(kind, chef.userId, body.path);
  if (!check.ok) {
    if (check.kind === "foreign")
      throw new ApiFailure("FORBIDDEN", check.message);
    throw validationFailed({ path: check.message });
  }
  return { kind, bucket: check.bucket, path: check.path };
}

function alreadyRegistered(
  s: ChefState,
  kind: DocumentKind,
  path: string,
): boolean {
  const p = privateStateOf(s.priv);
  if (kind === "id_document") return p.idDocumentPath === path;
  if (kind === "food_handler") return p.foodHandlerPath === path;
  return p.kitchenPhotoPaths.includes(path);
}

export async function registerDocument(
  chef: ChefCaller,
  req: { kind: DocumentKind; bucket: string; path: string },
  hooks?: MutateHooks,
): Promise<ChefState> {
  // The object must really exist in the expected bucket (service-role check, not trust).
  // A path that is already registered was checked when it was registered.
  if (
    !alreadyRegistered(chef.state, req.kind, req.path) &&
    !(await objectExists(chef.admin, req.bucket, req.path))
  )
    throw new ApiFailure(
      "NOT_FOUND",
      "That file has not been uploaded yet. Upload it first, then register it.",
    );

  return mutate(
    chef,
    (s) => {
      const cur = privateStateOf(s.priv);
      let change: PrivateChange;
      if (req.kind === "id_document") change = { idDocumentPath: req.path };
      else if (req.kind === "food_handler")
        change = { foodHandlerPath: req.path };
      else if (cur.kitchenPhotoPaths.includes(req.path)) change = {};
      else if (cur.kitchenPhotoPaths.length >= MAX_KITCHEN_PHOTOS)
        throw new ApiFailure(
          "INVALID_STATE",
          `You can add up to ${MAX_KITCHEN_PHOTOS} kitchen photos. Remove one first.`,
        );
      else change = { kitchenPhotoPaths: [...cur.kitchenPhotoPaths, req.path] };
      return planToStep(planPrivateChange(cur, change));
    },
    hooks,
  );
}

export async function removeKitchenPhoto(
  chef: ChefCaller,
  req: { bucket: string; path: string },
  hooks?: MutateHooks,
): Promise<ChefState> {
  const state = await mutate(
    chef,
    (s) => {
      const cur = privateStateOf(s.priv);
      // Only a photo registered for this chef can be removed: the route never deletes an
      // object just because a path was named.
      if (!cur.kitchenPhotoPaths.includes(req.path))
        throw new ApiFailure(
          "NOT_FOUND",
          "That kitchen photo is not registered.",
        );
      return planToStep(
        planPrivateChange(cur, {
          kitchenPhotoPaths: cur.kitchenPhotoPaths.filter(
            (p) => p !== req.path,
          ),
        }),
      );
    },
    hooks,
  );
  // The database no longer points at the object; delete it now (service role).
  await removeObject(chef.admin, req.bucket, req.path);
  return state;
}

// ---------------------------------------------------------------------------
// POST /api/chef/application/submit
// ---------------------------------------------------------------------------
export async function submitApplication(
  chef: ChefCaller,
  hooks?: MutateHooks,
): Promise<ChefState> {
  return mutate(
    chef,
    (s) => {
      const status = s.chef.status as "pending" | "approved" | "rejected";
      if (status === "approved")
        throw new ApiFailure(
          "INVALID_STATE",
          "This application is already approved.",
        );
      const app = toApplication(s);
      if (app.missing.length > 0)
        throw new ApiFailure(
          "APPLICATION_INCOMPLETE",
          "Finish the missing items before you submit.",
          { missing: app.missing },
        );
      const plan = planSubmit({
        status,
        idCheck: app.checks.id,
        foodHandlerCheck: app.checks.foodHandler,
        kitchenCheck: app.checks.kitchen,
        locationOptions: app.locationOptions,
      });
      return {
        privColumns: plan.columns,
        afterWrite: plan.moveToPending
          ? async (admin) => {
              // Conditional: only a still-rejected chef moves back to pending (B3).
              const r = await admin
                .from("chefs")
                .update({ status: "pending" })
                .eq("profile_id", chef.userId)
                .eq("status", "rejected");
              if (r.error)
                throw new Error(
                  `chef status update failed: ${r.error.message}`,
                );
            }
          : undefined,
      };
    },
    hooks,
  );
}
