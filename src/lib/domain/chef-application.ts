// Chef application rules (T-031, contract sections 2 and 5). Pure functions, no I/O and no server
// imports, so they are unit-tested without a database and the routes stay thin.
//
// Everything about ID, food-handler, kitchen and police checks is MOCK: the statuses below are
// simulated outcomes recorded by an admin, never real verification.
import type {
  ApplicationMissingItem,
  ChefStatus,
  DocumentKind,
  LocationType,
  MockCheckStatus,
} from "../api/types.ts";
import { normalizePostalCode } from "./address.ts";
import { hasUnsafeText } from "./text-safety.ts";

// ---------------------------------------------------------------------------
// Limits (contract section 5; the bounds marked ASSUMPTION there are not requirements)
// ---------------------------------------------------------------------------
export const BIO_MAX = 2000;
export const LIST_MIN = 1;
export const LIST_MAX = 10;
export const LIST_ENTRY_MAX = 40;
export const HOURLY_RATE_MIN_CENTS = 500;
export const HOURLY_RATE_MAX_CENTS = 20000;
export const RADIUS_MIN_KM = 1;
export const RADIUS_MAX_KM = 200;
export const MAX_KITCHEN_PHOTOS = 10;
export const LOCATION_OPTIONS: readonly LocationType[] = [
  "customer_home",
  "chef_home",
];
/** handle_new_user() gives this name to a sign-up without one; it is a placeholder, not a name. */
export const PLACEHOLDER_DISPLAY_NAME = "New user";

// ---------------------------------------------------------------------------
// Storage paths (contract section 2, rule 7)
// ---------------------------------------------------------------------------
export type StorageTarget = DocumentKind | "profile_photo";
/** `dish_photo` (T-032) is checked here too; it is not an upload target of the application page. */
export type PathTarget = StorageTarget | "dish_photo";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp"];
const DOCUMENT_EXTS = ["jpg", "jpeg", "png", "pdf"];

/** Bucket, file-name prefix and allowed extensions per target. Mirrors the bucket MIME limits. */
const STORAGE_RULES: Record<
  PathTarget,
  { bucket: string; prefix: string; exts: string[] }
> = {
  id_document: { bucket: "chef-documents", prefix: "id", exts: DOCUMENT_EXTS },
  food_handler: {
    bucket: "chef-documents",
    prefix: "food-handler",
    exts: DOCUMENT_EXTS,
  },
  kitchen_photo: {
    bucket: "kitchen-photos",
    prefix: "kitchen",
    exts: IMAGE_EXTS,
  },
  profile_photo: {
    bucket: "profile-photos",
    prefix: "photo",
    exts: IMAGE_EXTS,
  },
  dish_photo: { bucket: "dish-photos", prefix: "dish", exts: IMAGE_EXTS },
};

export type PathCheck =
  | { ok: true; bucket: string; path: string }
  | { ok: false; kind: "invalid" | "foreign"; message: string };

/**
 * A path is accepted only if it is a string, has no "..", no leading "/", no backslash or control
 * character, lives in the caller's own folder "<chefId>/" and the file name is
 * "<prefix>-<uuid>.<ext>" for its kind. "foreign" means a different folder (the route answers 403
 * without touching storage); "invalid" means a malformed path (422).
 * Whether the object really exists is the route's job (it needs the service role).
 */
export function checkStoragePath(
  target: PathTarget,
  chefId: string,
  raw: unknown,
): PathCheck {
  const invalid = (message: string): PathCheck => ({
    ok: false,
    kind: "invalid",
    message,
  });
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200)
    return invalid("Enter the path of the uploaded file.");
  if (
    raw.includes("..") ||
    raw.startsWith("/") ||
    /[\u0000-\u001f\u007f\\]/.test(raw)
  )
    return invalid("That file path is not allowed.");
  const prefix = `${chefId}/`;
  if (!raw.startsWith(prefix))
    return {
      ok: false,
      kind: "foreign",
      message: "That file is not in your folder.",
    };
  const rule = STORAGE_RULES[target];
  // Lower case only (no `i` flag): the app generates these names (crypto.randomUUID() and a
  // lower-case extension), so a differently cased name is never legitimate (T-031 tester F6).
  const name = new RegExp(
    `^${rule.prefix}-${UUID}\\.(${rule.exts.join("|")})$`,
  );
  if (!name.test(raw.slice(prefix.length)))
    return invalid(
      `The file name must look like ${rule.prefix}-<uuid>.<${rule.exts.join("|")}>.`,
    );
  return { ok: true, bucket: rule.bucket, path: raw };
}

// ---------------------------------------------------------------------------
// MOCK re-verification (contract section 2, N1) and the check state we plan changes against
// ---------------------------------------------------------------------------
/**
 * MOCK: a changed document or kitchen invalidates an earlier verdict, so a `verified` check goes
 * back to `pending`. A `failed` check also goes to `pending` (Planner decision for T-031: the chef
 * has re-uploaded after the admin failed it). `not_started` and `pending` stay as they are.
 */
export function resetMockCheck(status: MockCheckStatus): MockCheckStatus {
  return status === "verified" || status === "failed" ? "pending" : status;
}

export interface KitchenAddress {
  line: string;
  city: string;
  postalCode: string;
}

export function sameKitchenAddress(
  a: KitchenAddress | null,
  b: KitchenAddress | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.line === b.line && a.city === b.city && a.postalCode === b.postalCode
  );
}

function sameSet(a: string[], b: string[]): boolean {
  return (
    a.length === b.length &&
    [...a].sort().join("\n") === [...b].sort().join("\n")
  );
}

export interface PrivateState {
  idDocumentPath: string | null;
  foodHandlerPath: string | null;
  kitchenPhotoPaths: string[];
  kitchenAddress: KitchenAddress | null;
  /** MOCK. */
  idCheck: MockCheckStatus;
  /** MOCK. */
  foodHandlerCheck: MockCheckStatus;
  /** MOCK. */
  kitchenCheck: MockCheckStatus;
}

export interface PrivateChange {
  idDocumentPath?: string;
  foodHandlerPath?: string;
  kitchenPhotoPaths?: string[];
  kitchenAddress?: KitchenAddress;
}

export interface PrivatePlan {
  /** chef_private columns to write (snake_case). Empty means nothing changes. */
  columns: Record<string, unknown>;
  /** True when the kitchen photos or address change: chefs.chef_home_enabled must become false. */
  disableChefHome: boolean;
}

/**
 * Plans a change to the documents or kitchen and applies the N1 reset in the same set of columns.
 * Only real changes count: registering the same path again, or sending the same address, resets
 * nothing. A kitchen change always switches chef's home off until an admin enables it again.
 */
export function planPrivateChange(
  current: PrivateState,
  change: PrivateChange,
): PrivatePlan {
  const columns: Record<string, unknown> = {};

  if (
    change.idDocumentPath !== undefined &&
    change.idDocumentPath !== current.idDocumentPath
  ) {
    columns.id_document_path = change.idDocumentPath;
    const next = resetMockCheck(current.idCheck); // MOCK
    if (next !== current.idCheck) columns.id_check_status = next;
  }

  if (
    change.foodHandlerPath !== undefined &&
    change.foodHandlerPath !== current.foodHandlerPath
  ) {
    columns.food_handler_path = change.foodHandlerPath;
    const next = resetMockCheck(current.foodHandlerCheck); // MOCK
    if (next !== current.foodHandlerCheck) columns.food_handler_status = next;
  }

  let kitchenChanged = false;
  if (
    change.kitchenPhotoPaths !== undefined &&
    !sameSet(change.kitchenPhotoPaths, current.kitchenPhotoPaths)
  ) {
    columns.kitchen_photo_paths = change.kitchenPhotoPaths;
    kitchenChanged = true;
  }
  if (
    change.kitchenAddress !== undefined &&
    !sameKitchenAddress(change.kitchenAddress, current.kitchenAddress)
  ) {
    columns.kitchen_address_line = change.kitchenAddress.line;
    columns.kitchen_city = change.kitchenAddress.city;
    columns.kitchen_postal_code = change.kitchenAddress.postalCode;
    kitchenChanged = true;
  }
  if (kitchenChanged) {
    const next = resetMockCheck(current.kitchenCheck); // MOCK
    if (next !== current.kitchenCheck) columns.kitchen_status = next;
  }

  return { columns, disableChefHome: kitchenChanged };
}

// ---------------------------------------------------------------------------
// Submit (contract section 5, N2 and B3)
// ---------------------------------------------------------------------------
export interface SubmitInput {
  status: ChefStatus;
  /** MOCK. */
  idCheck: MockCheckStatus;
  /** MOCK. */
  foodHandlerCheck: MockCheckStatus;
  /** MOCK. */
  kitchenCheck: MockCheckStatus;
  locationOptions: LocationType[];
}

function startCheck(status: MockCheckStatus): boolean {
  return status === "not_started" || status === "failed";
}

/**
 * Submit moves only checks that are `not_started` or `failed` to `pending` (the kitchen only when
 * chef's home is offered). It never overwrites `verified` or an already `pending` check (N2) and
 * never touches the police check. A `rejected` chef goes back to `pending` and the reason is cleared (B3).
 * MOCK: nothing is verified here; an admin records the outcome later.
 */
export function planSubmit(i: SubmitInput): {
  columns: Record<string, unknown>;
  moveToPending: boolean;
} {
  const columns: Record<string, unknown> = {};
  if (startCheck(i.idCheck)) columns.id_check_status = "pending";
  if (startCheck(i.foodHandlerCheck)) columns.food_handler_status = "pending";
  if (i.locationOptions.includes("chef_home") && startCheck(i.kitchenCheck))
    columns.kitchen_status = "pending";
  const moveToPending = i.status === "rejected";
  if (moveToPending) columns.reject_reason = null;
  return { columns, moveToPending };
}

// ---------------------------------------------------------------------------
// What is still missing (contract section 5, GET /api/chef/application)
// ---------------------------------------------------------------------------
export interface MissingInput {
  displayName: string;
  bio: string | null;
  photoPath: string | null;
  cuisines: string[];
  languages: string[];
  hourlyRateCents: number | null;
  servicePostalPrefix: string | null;
  locationOptions: LocationType[];
  idDocumentPath: string | null;
  foodHandlerPath: string | null;
  allergenAckAt: string | null;
  phoneVerified: boolean;
  /** Active dishes of this chef that have a photo ("sample menu with photos", CLAUDE.md 6.7). */
  sampleDishCount: number;
  kitchenAddress: KitchenAddress | null;
  kitchenPhotoPaths: string[];
  kitchenHygieneAckAt: string | null;
}

export function computeMissing(i: MissingInput): ApplicationMissingItem[] {
  const m: ApplicationMissingItem[] = [];
  const name = i.displayName.trim();
  if (name === "" || name === PLACEHOLDER_DISPLAY_NAME) m.push("displayName");
  if (!i.bio || i.bio.trim() === "") m.push("bio");
  if (!i.photoPath) m.push("photo");
  if (i.cuisines.length === 0) m.push("cuisines");
  if (i.languages.length === 0) m.push("languages");
  if (i.hourlyRateCents === null) m.push("hourlyRate");
  if (!i.servicePostalPrefix) m.push("servicePostalPrefix");
  if (i.locationOptions.length === 0) m.push("locationOptions");
  if (!i.idDocumentPath) m.push("idDocument");
  if (!i.foodHandlerPath) m.push("foodHandler");
  if (!i.allergenAckAt) m.push("allergenAcknowledgement");
  if (!i.phoneVerified) m.push("phoneVerified"); // MOCK SMS verification
  if (i.sampleDishCount < 1) m.push("sampleDish");
  if (i.locationOptions.includes("chef_home")) {
    if (!i.kitchenAddress) m.push("kitchenAddress");
    if (i.kitchenPhotoPaths.length === 0) m.push("kitchenPhotos");
    if (!i.kitchenHygieneAckAt) m.push("kitchenHygieneAcknowledgement");
  }
  return m;
}

// ---------------------------------------------------------------------------
// PATCH body parsing (contract section 5). Shape and range only; whether a postal prefix exists
// or a photo object exists is checked by the route.
// ---------------------------------------------------------------------------
export interface ParsedUpdate {
  bio?: string | null;
  photoPath?: string | null;
  cuisines?: string[];
  languages?: string[];
  hourlyRateCents?: number;
  servicePostalPrefix?: string;
  serviceRadiusKm?: number;
  locationOptions?: LocationType[];
  kitchenAddress?: KitchenAddress;
  acknowledgeAllergenStatement?: true;
  acknowledgeKitchenHygiene?: true;
}

export const UPDATE_KEYS = [
  "bio",
  "photoPath",
  "cuisines",
  "languages",
  "hourlyRateCents",
  "servicePostalPrefix",
  "serviceRadiusKm",
  "locationOptions",
  "kitchenAddress",
  "acknowledgeAllergenStatement",
  "acknowledgeKitchenHygiene",
] as const;

export { hasUnsafeText } from "./text-safety.ts";

function parseTextList(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length < LIST_MIN || v.length > LIST_MAX)
    return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of v) {
    if (typeof e !== "string") return null;
    const t = e.trim();
    if (t.length < 1 || t.length > LIST_ENTRY_MAX || hasUnsafeText(t))
      return null;
    // Case-insensitive de-duplication keeps the first spelling.
    if (!seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

function parseKitchenAddress(
  v: unknown,
  errors: Record<string, string>,
): KitchenAddress | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    errors.kitchenAddress = "Enter the kitchen address.";
    return undefined;
  }
  const o = v as Record<string, unknown>;
  let bad = false;
  for (const k of Object.keys(o))
    if (!["line", "city", "postalCode"].includes(k)) {
      errors[`kitchenAddress.${k}`] = "Unknown field.";
      bad = true;
    }
  const line = typeof o.line === "string" ? o.line.trim() : "";
  const city = typeof o.city === "string" ? o.city.trim() : "";
  if (line.length < 1 || line.length > 120 || hasUnsafeText(line)) {
    errors["kitchenAddress.line"] = "Enter 1 to 120 characters.";
    bad = true;
  }
  if (city.length < 1 || city.length > 80 || hasUnsafeText(city)) {
    errors["kitchenAddress.city"] = "Enter 1 to 80 characters.";
    bad = true;
  }
  const postalCode =
    typeof o.postalCode === "string" ? normalizePostalCode(o.postalCode) : null;
  if (!postalCode) {
    errors["kitchenAddress.postalCode"] =
      "Enter a valid postal code, for example L5B 1A1.";
    bad = true;
  }
  return bad ? undefined : { line, city, postalCode: postalCode as string };
}

export function parseUpdateBody(body: Record<string, unknown>): {
  value: ParsedUpdate;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const value: ParsedUpdate = {};
  const has = (k: (typeof UPDATE_KEYS)[number]) =>
    Object.prototype.hasOwnProperty.call(body, k);

  if (has("bio")) {
    const v = body.bio;
    if (v === null) value.bio = null;
    else if (typeof v !== "string" || v.trim().length > BIO_MAX)
      errors.bio = `Enter up to ${BIO_MAX} characters.`;
    else if (hasUnsafeText(v, true))
      errors.bio = "Use plain text. Control characters are not allowed.";
    else value.bio = v.trim() === "" ? null : v.trim();
  }

  if (has("photoPath")) {
    const v = body.photoPath;
    if (v === null) value.photoPath = null;
    else if (typeof v === "string" && v.length > 0) value.photoPath = v;
    else errors.photoPath = "Enter the path of the uploaded photo, or null.";
  }

  for (const key of ["cuisines", "languages"] as const) {
    if (!has(key)) continue;
    const list = parseTextList(body[key]);
    if (list) value[key] = list;
    else
      errors[key] =
        `Enter ${LIST_MIN} to ${LIST_MAX} items, each 1 to ${LIST_ENTRY_MAX} characters.`;
  }

  if (has("hourlyRateCents")) {
    const v = body.hourlyRateCents;
    if (
      typeof v === "number" &&
      Number.isInteger(v) &&
      v >= HOURLY_RATE_MIN_CENTS &&
      v <= HOURLY_RATE_MAX_CENTS
    )
      value.hourlyRateCents = v;
    else
      errors.hourlyRateCents =
        "Enter a rate between $5.00 and $200.00 an hour.";
  }

  if (has("servicePostalPrefix")) {
    const v = body.servicePostalPrefix;
    const p = typeof v === "string" ? v.trim().toUpperCase() : "";
    if (/^[A-Z][0-9][A-Z]$/.test(p)) value.servicePostalPrefix = p;
    else
      errors.servicePostalPrefix =
        "Enter the first 3 characters of a postal code, for example L5B.";
  }

  if (has("serviceRadiusKm")) {
    const v = body.serviceRadiusKm;
    if (
      typeof v === "number" &&
      Number.isInteger(v) &&
      v >= RADIUS_MIN_KM &&
      v <= RADIUS_MAX_KM
    )
      value.serviceRadiusKm = v;
    else
      errors.serviceRadiusKm = `Enter a whole number of kilometres from ${RADIUS_MIN_KM} to ${RADIUS_MAX_KM}.`;
  }

  if (has("locationOptions")) {
    const v = body.locationOptions;
    if (
      Array.isArray(v) &&
      v.length >= 1 &&
      v.every((x) => LOCATION_OPTIONS.includes(x as LocationType))
    )
      value.locationOptions = [...new Set(v)] as LocationType[];
    else
      errors.locationOptions =
        "Choose at least one place: the customer's home or your own home.";
  }

  if (has("kitchenAddress")) {
    const a = parseKitchenAddress(body.kitchenAddress, errors);
    if (a) value.kitchenAddress = a;
  }

  for (const key of [
    "acknowledgeAllergenStatement",
    "acknowledgeKitchenHygiene",
  ] as const) {
    if (!has(key)) continue;
    if (body[key] === true) value[key] = true;
    else errors[key] = "Only true is accepted.";
  }

  return { value, errors };
}
