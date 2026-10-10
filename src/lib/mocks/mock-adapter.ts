// MOCK ADAPTER. Stands in for the auth/phone/address API routes until T-028 lands them.
// Nothing here is real: no accounts, no SMS, no storage beyond this browser tab (sessionStorage).
// Responses follow docs/api-contract.md. Switched by NEXT_PUBLIC_API_MOCK (see client.ts).
// Magic inputs for demos and tests:
//   email taken@example.com        -> 409 EMAIL_IN_USE (sign-up)
//   email confirm@example.com      -> sign-up returns signedIn:false (no session; check-your-email)
//   email limited@example.com      -> 429 RATE_LIMITED, retry 90 s (sign-up, login)
//   password "wrongpass"           -> 401 INVALID_CREDENTIALS (login)
//   phone ending 0000              -> 409 PHONE_IN_USE
//   postal code not starting M or L -> 422 "Not a GTA postal code." (MOCK approximation)
//   chef display name containing "with dish" -> the chef starts with one real mock dish that has a
//     photo (so the application can be finished without visiting the dish editor first)
//   chef display name containing "rejected" / "approved" -> that chef starts in that status
//   log-in email starting "chef" (no sign-up first) -> a demo chef
//   log-in email starting "admin" (no sign-up first) -> a demo admin with a made-up chef queue
//     (MOCK; see mock-admin.ts). Real admins cannot be created from the app.
// Dishes and availability (T-034) follow contract 5A and 5B and reuse src/lib/domain/dishes.ts.
//   MOCK dish photos are never stored; a photo path is accepted when its name is well formed.
// Public search routes (T-040) live in mock-search.ts (seeded approved chefs, real pure rules).
// Chef application rules reuse the real pure functions in src/lib/domain/chef-application.ts.
// MOCK: files are never stored (see mockUploader); a path is accepted if its name is well formed.
import type {
  AddressRequest,
  AddressResponse,
  ApiError,
  ApiErrorCode,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MeProfile,
  MeResponse,
  PhoneSubmitRequest,
  PhoneSubmitResponse,
  PhoneVerifyRequest,
  PhoneVerifyResponse,
  SignUpRequest,
  SignUpResponse,
} from "@/lib/api/types";
import type {
  AvailabilityResponse,
  ChefApplication,
  ChefDishListResponse,
  Dish,
  ChefOwnSummary,
  DocumentKind,
  RegisterDocumentRequest,
  RegisterDocumentResponse,
  RemoveDocumentRequest,
  SubmitApplicationResponse,
  UpdateChefApplicationRequest,
  UpdateMeRequest,
} from "@/lib/api/types";
import {
  MAX_KITCHEN_PHOTOS,
  UPDATE_KEYS,
  checkStoragePath,
  computeMissing,
  parseUpdateBody,
  planPrivateChange,
  planSubmit,
  type PrivateState,
} from "@/lib/domain/chef-application";
import {
  AVAILABILITY_HORIZON_DAYS,
  AVAILABILITY_KEYS,
  CREATE_DISH_KEYS,
  MAX_ACTIVE_DISHES,
  UPDATE_DISH_KEYS,
  addDays,
  parseAvailabilityBody,
  parseDishBody,
  torontoToday,
} from "@/lib/domain/dishes";
import {
  adminRoutes,
  seedAdminQueue,
  type MockQueueChef,
} from "@/lib/mocks/mock-admin";
import { searchRoutes } from "@/lib/mocks/mock-search";
import {
  displayNameProblem,
  validateAddress,
  validateCode,
  validateLogin,
  validatePhone,
  validateSignUp,
} from "@/lib/validation/auth";

interface MockState {
  profile: MeProfile | null;
  /** Masked only (e.g. "+1******0123"); the full number is never kept. */
  phone: string | null;
  phoneVerified: boolean;
  address: AddressResponse["address"] | null;
  /** MOCK chef application (chef accounts only). `missing` is recomputed on every read. */
  chef: Omit<ChefApplication, "missing"> | null;
  /** MOCK dishes of the signed-in chef (newest first). */
  dishes: Dish[];
  /** MOCK available dates (YYYY-MM-DD), ascending. */
  availability: string[];
  /** MOCK admin queue of made-up chef applications (admin accounts only). */
  adminQueue: MockQueueChef[];
}

const KEY = "cookneighbour-mock-api-state";
const EMPTY: MockState = {
  profile: null,
  phone: null,
  phoneVerified: false,
  address: null,
  chef: null,
  dishes: [],
  availability: [],
  adminQueue: [],
};
let memory: MockState = { ...EMPTY };

function load(): MockState {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    // `...EMPTY` fills fields that older saved state does not have.
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as MockState) };
  } catch {
    /* fall through to memory */
  }
  return memory;
}
function save(s: MockState) {
  memory = s;
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* memory only */
  }
}
/** Test helper. */
export function resetMockState() {
  memory = { ...EMPTY };
  try {
    globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

function json(status: number, body: unknown, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
function fail(
  status: number,
  code: ApiErrorCode,
  message: string,
  extra: Partial<ApiError["error"]> = {},
) {
  const body: ApiError = { error: { code, message, ...extra } };
  return json(
    status,
    body,
    extra.retryAfterSeconds
      ? { "Retry-After": String(extra.retryAfterSeconds) }
      : {},
  );
}
function validation(fields: Record<string, string>) {
  return fail(422, "VALIDATION_FAILED", "Check the highlighted fields.", {
    fields,
  });
}
function rateLimited() {
  return fail(429, "RATE_LIMITED", "Too many attempts.", {
    retryAfterSeconds: 90,
  });
}
function mask(e164: string) {
  return `+1******${e164.slice(-4)}`;
}
function toE164(phone: string) {
  const d = phone.replace(/\D/g, "");
  return `+1${d.length === 11 ? d.slice(1) : d}`;
}

/** MOCK: a finished sample dish with a (fake) photo. */
function sampleDish(userId: string): Dish {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-0000000000d1",
    name: "Pho bo (sample)",
    photoPath: `${userId}/dish-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`,
    description: "MOCK sample dish.",
    cuisine: "Vietnamese",
    cookMinutes: 180,
    ingredientCostCents: 2500,
    servings: 4,
    allergens: ["soy"],
    shelfLifeDays: 2,
    isActive: true,
    currency: "CAD",
    createdAt: now,
    updatedAt: now,
  };
}

function newChef(displayName: string): Omit<ChefApplication, "missing"> {
  const name = displayName.toLowerCase();
  const status = name.includes("rejected")
    ? "rejected"
    : name.includes("approved")
      ? "approved"
      : "pending";
  return {
    status,
    displayName,
    bio: null,
    photoPath: null,
    cuisines: [],
    languages: [],
    hourlyRateCents: null,
    servicePostalPrefix: null,
    serviceRadiusKm: 25,
    locationOptions: ["customer_home"],
    chefHomeEnabled: false,
    country: "CA",
    currency: "CAD",
    language: "en",
    rejectReason:
      status === "rejected"
        ? "MOCK: the ID photo was too blurry to read."
        : null,
    checks: {
      id: "not_started",
      foodHandler: "not_started",
      kitchen: "not_started",
      police: "not_started",
    },
    documents: {
      idDocumentPath: null,
      foodHandlerPath: null,
      kitchenPhotoPaths: [],
    },
    kitchenAddress: null,
    allergenAckAt: null,
    kitchenHygieneAckAt: null,
  };
}

function application(s: MockState): ChefApplication {
  const c = s.chef!;
  return {
    ...c,
    missing: computeMissing({
      displayName: c.displayName,
      bio: c.bio,
      photoPath: c.photoPath,
      cuisines: c.cuisines,
      languages: c.languages,
      hourlyRateCents: c.hourlyRateCents,
      servicePostalPrefix: c.servicePostalPrefix,
      locationOptions: c.locationOptions,
      idDocumentPath: c.documents.idDocumentPath,
      foodHandlerPath: c.documents.foodHandlerPath,
      allergenAckAt: c.allergenAckAt,
      phoneVerified: s.phoneVerified,
      sampleDishCount: s.dishes.filter((d) => d.isActive && d.photoPath).length,
      kitchenAddress: c.kitchenAddress,
      kitchenPhotoPaths: c.documents.kitchenPhotoPaths,
      kitchenHygieneAckAt: c.kitchenHygieneAckAt,
    }),
  };
}

function chefSummary(s: MockState): ChefOwnSummary | null {
  if (!s.chef) return null;
  const a = application(s);
  return {
    status: a.status,
    displayName: a.displayName,
    bio: a.bio,
    photoPath: a.photoPath,
    cuisines: a.cuisines,
    languages: a.languages,
    hourlyRateCents: a.hourlyRateCents,
    servicePostalPrefix: a.servicePostalPrefix,
    serviceRadiusKm: a.serviceRadiusKm,
    locationOptions: a.locationOptions,
    chefHomeEnabled: a.chefHomeEnabled,
    country: a.country,
    currency: a.currency,
    language: a.language,
  };
}

function me(s: MockState): MeResponse {
  return {
    profile: s.profile!,
    private: {
      phoneMasked: s.phone,
      phoneVerified: s.phoneVerified,
      address: s.address,
    },
    chef: chefSummary(s),
  };
}

function privateState(c: Omit<ChefApplication, "missing">): PrivateState {
  return {
    idDocumentPath: c.documents.idDocumentPath,
    foodHandlerPath: c.documents.foodHandlerPath,
    kitchenPhotoPaths: c.documents.kitchenPhotoPaths,
    kitchenAddress: c.kitchenAddress,
    idCheck: c.checks.id,
    foodHandlerCheck: c.checks.foodHandler,
    kitchenCheck: c.checks.kitchen,
  };
}

/** Applies planPrivateChange's columns (the real reset rules) to the mock chef. */
function applyColumns(
  c: Omit<ChefApplication, "missing">,
  cols: Record<string, unknown>,
  disableChefHome: boolean,
): Omit<ChefApplication, "missing"> {
  const n = {
    ...c,
    checks: { ...c.checks },
    documents: { ...c.documents },
  };
  if ("id_document_path" in cols)
    n.documents.idDocumentPath = cols.id_document_path as string;
  if ("food_handler_path" in cols)
    n.documents.foodHandlerPath = cols.food_handler_path as string;
  if ("kitchen_photo_paths" in cols)
    n.documents.kitchenPhotoPaths = cols.kitchen_photo_paths as string[];
  if ("kitchen_address_line" in cols)
    n.kitchenAddress = {
      line: cols.kitchen_address_line as string,
      city: cols.kitchen_city as string,
      postalCode: cols.kitchen_postal_code as string,
    };
  if ("id_check_status" in cols) n.checks.id = cols.id_check_status as never;
  if ("food_handler_status" in cols)
    n.checks.foodHandler = cols.food_handler_status as never;
  if ("kitchen_status" in cols) n.checks.kitchen = cols.kitchen_status as never;
  if (disableChefHome) n.chefHomeEnabled = false;
  return n;
}

const DOCUMENT_KINDS: DocumentKind[] = [
  "id_document",
  "food_handler",
  "kitchen_photo",
];

export async function mockFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  await new Promise((r) => setTimeout(r, 150)); // feel like a network call
  const method = init.method ?? "GET";
  const hdrs = new Headers(init.headers);
  if (hdrs.get("Content-Type") !== "application/json") {
    return fail(400, "BAD_REQUEST", "Content-Type must be application/json.");
  }
  let body: unknown = {};
  if (typeof init.body === "string") {
    try {
      body = JSON.parse(init.body);
    } catch {
      return fail(400, "BAD_REQUEST", "Malformed JSON.");
    }
  }
  // Public search routes (T-040): no session needed, so they come before every other route.
  const searched = searchRoutes(method, path);
  if (searched) return searched;

  const s = load();
  const route = `${method} ${path}`;

  if (route === "POST /api/auth/signup") {
    const b = body as SignUpRequest;
    const fields = validateSignUp(b);
    if (Object.keys(fields).length) return validation(fields);
    if (b.email.toLowerCase() === "limited@example.com") return rateLimited();
    if (b.email.toLowerCase() === "taken@example.com")
      return fail(409, "EMAIL_IN_USE", "That email already has an account.");
    if (s.profile)
      return fail(409, "INVALID_STATE", "You are already signed in.");
    const profile: MeProfile = {
      id: "mock-user-1",
      role: b.role,
      displayName: b.displayName.trim(),
      country: "CA",
      currency: "CAD",
      language: "en",
    };
    const needsConfirm = b.email.toLowerCase() === "confirm@example.com";
    if (!needsConfirm)
      save({
        ...EMPTY,
        profile,
        chef: b.role === "chef" ? newChef(profile.displayName) : null,
        dishes:
          b.role === "chef" && /with dish/i.test(profile.displayName)
            ? [sampleDish(profile.id)]
            : [],
      });
    return json(201, {
      user: profile,
      signedIn: !needsConfirm,
    } satisfies SignUpResponse);
  }

  if (route === "POST /api/auth/login") {
    const b = body as LoginRequest;
    const fields = validateLogin(b);
    if (Object.keys(fields).length) return validation(fields);
    if (b.email.toLowerCase() === "limited@example.com") return rateLimited();
    if (b.password === "wrongpass")
      return fail(
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect.",
      );
    const demoChef = !s.profile && /^chef/i.test(b.email.trim());
    const demoAdmin = !s.profile && /^admin/i.test(b.email.trim());
    const profile: MeProfile = s.profile ?? {
      id: "mock-user-1",
      role: demoAdmin ? "admin" : demoChef ? "chef" : "customer",
      displayName: demoAdmin
        ? "Demo admin"
        : demoChef
          ? "Demo chef"
          : "Demo customer",
      country: "CA",
      currency: "CAD",
      language: "en",
    };
    save({
      ...s,
      profile,
      chef: s.chef ?? (demoChef ? newChef(profile.displayName) : null),
      adminQueue: demoAdmin ? seedAdminQueue() : s.adminQueue,
    });
    return json(200, { user: profile } satisfies LoginResponse);
  }

  if (route === "POST /api/auth/logout") {
    save({ ...EMPTY });
    return json(200, { ok: true } satisfies LogoutResponse);
  }

  // Everything below needs a session.
  if (!s.profile) {
    return fail(401, "UNAUTHENTICATED", "Please log in first.");
  }

  if (route === "GET /api/me") return json(200, me(s));

  if (route === "POST /api/me/phone") {
    const b = body as PhoneSubmitRequest;
    const fields = validatePhone(b);
    if (Object.keys(fields).length) return validation(fields);
    const e164 = toE164(b.phone);
    if (e164.endsWith("0000"))
      return fail(409, "PHONE_IN_USE", "That phone number can't be used.");
    save({ ...s, phone: mask(e164), phoneVerified: false });
    return json(200, {
      phoneMasked: mask(e164),
      mock: true,
      mockHint: "MOCK: no SMS was sent. Enter any 6 digits.",
    } satisfies PhoneSubmitResponse);
  }

  if (route === "POST /api/me/phone/verify") {
    const b = body as PhoneVerifyRequest;
    const fields = validateCode(b);
    if (Object.keys(fields).length) return validation(fields);
    if (!s.phone)
      return fail(409, "PHONE_NOT_SUBMITTED", "Submit a phone number first.");
    save({ ...s, phoneVerified: true });
    return json(200, {
      phoneVerified: true,
      mock: true,
    } satisfies PhoneVerifyResponse);
  }

  if (route === "PUT /api/me/address") {
    const b = body as AddressRequest;
    const fields = validateAddress(b);
    if (!fields.postalCode && !/^[ML]/i.test(b.postalCode.trim()))
      fields.postalCode = "Not a GTA postal code.";
    if (Object.keys(fields).length) return validation(fields);
    const postalCode = b.postalCode.replace(/[\s-]/g, "").toUpperCase();
    const address = {
      line: b.line.trim(),
      city: b.city.trim(),
      postalCode,
      postalPrefix: postalCode.slice(0, 3),
    };
    save({ ...s, address });
    return json(200, { address } satisfies AddressResponse);
  }

  if (route === "PATCH /api/me") {
    const b = body as UpdateMeRequest;
    const name = typeof b.displayName === "string" ? b.displayName.trim() : "";
    const problem = displayNameProblem(name);
    if (problem) return validation({ displayName: problem });
    save({
      ...s,
      profile: { ...s.profile, displayName: name },
      chef: s.chef ? { ...s.chef, displayName: name } : null,
    });
    return json(200, { ...s.profile, displayName: name });
  }

  if (path.startsWith("/api/admin/")) {
    if (s.profile.role !== "admin")
      return fail(403, "FORBIDDEN", "Only admins can do this.");
    const r = adminRoutes(method, path, body, s.adminQueue);
    if (r.queue) save({ ...s, adminQueue: r.queue });
    return r.response;
  }

  if (path.startsWith("/api/chef/application"))
    return chefRoutes(route, body, s);
  if (path.startsWith("/api/chef/dishes")) return dishRoutes(route, body, s);
  if (path === "/api/chef/availability")
    return availabilityRoutes(route, body, s);

  return fail(404, "NOT_FOUND", "Not found.");
}

// MOCK chef application routes (contract section 5). Order of checks as in the contract:
// role (403), body fields (422), then state (404, 409).
function chefRoutes(route: string, body: unknown, s: MockState): Response {
  if (s.profile!.role !== "chef" || !s.chef)
    return fail(403, "FORBIDDEN", "Only chefs can do that.");
  const userId = s.profile!.id;
  const chef = s.chef;
  const obj = (body ?? {}) as Record<string, unknown>;

  if (route === "GET /api/chef/application") return json(200, application(s));

  if (route === "PATCH /api/chef/application") {
    const fields: Record<string, string> = {};
    for (const k of Object.keys(obj))
      if (!(UPDATE_KEYS as readonly string[]).includes(k))
        fields[k] = "Unknown field.";
    const { value, errors } = parseUpdateBody(obj);
    Object.assign(fields, errors);
    if (value.servicePostalPrefix && !/^[ML]/.test(value.servicePostalPrefix))
      fields.servicePostalPrefix = "Not a GTA postal code area.";
    if (value.kitchenAddress && !/^[ML]/.test(value.kitchenAddress.postalCode))
      fields["kitchenAddress.postalCode"] = "Not a GTA postal code.";
    if (typeof value.photoPath === "string" && !fields.photoPath) {
      const c = checkStoragePath("profile_photo", userId, value.photoPath);
      if (!c.ok && c.kind === "foreign")
        return fail(403, "FORBIDDEN", c.message);
      if (!c.ok) fields.photoPath = c.message;
    }
    if (Object.keys(fields).length) return validation(fields);

    const v = value as UpdateChefApplicationRequest;
    let next = { ...chef };
    if (v.bio !== undefined) next.bio = v.bio;
    if (v.photoPath !== undefined) next.photoPath = v.photoPath;
    if (v.cuisines) next.cuisines = v.cuisines;
    if (v.languages) next.languages = v.languages;
    if (v.hourlyRateCents !== undefined)
      next.hourlyRateCents = v.hourlyRateCents;
    if (v.servicePostalPrefix) next.servicePostalPrefix = v.servicePostalPrefix;
    if (v.serviceRadiusKm !== undefined)
      next.serviceRadiusKm = v.serviceRadiusKm;
    if (v.locationOptions) next.locationOptions = v.locationOptions;
    const now = new Date().toISOString();
    if (v.acknowledgeAllergenStatement)
      next.allergenAckAt = chef.allergenAckAt ?? now; // the first time is kept
    if (v.acknowledgeKitchenHygiene)
      next.kitchenHygieneAckAt = chef.kitchenHygieneAckAt ?? now;
    if (v.kitchenAddress) {
      const plan = planPrivateChange(privateState(next), {
        kitchenAddress: v.kitchenAddress,
      });
      next = applyColumns(next, plan.columns, plan.disableChefHome);
    }
    save({ ...s, chef: next });
    return json(200, application({ ...s, chef: next }));
  }

  if (route === "POST /api/chef/application/documents") {
    const b = obj as Partial<RegisterDocumentRequest>;
    if (!b.kind || !DOCUMENT_KINDS.includes(b.kind))
      return validation({
        kind: "Choose id_document, food_handler or kitchen_photo.",
      });
    const c = checkStoragePath(b.kind, userId, b.path);
    if (!c.ok && c.kind === "foreign") return fail(403, "FORBIDDEN", c.message);
    if (!c.ok) return validation({ path: c.message });
    const paths = chef.documents.kitchenPhotoPaths;
    let change;
    if (b.kind === "id_document") change = { idDocumentPath: c.path };
    else if (b.kind === "food_handler") change = { foodHandlerPath: c.path };
    else if (paths.includes(c.path)) change = {};
    else if (paths.length >= MAX_KITCHEN_PHOTOS)
      return fail(
        409,
        "INVALID_STATE",
        "You can add up to 10 kitchen photos. Remove one first.",
      );
    else change = { kitchenPhotoPaths: [...paths, c.path] };
    const plan = planPrivateChange(privateState(chef), change);
    const next = applyColumns(chef, plan.columns, plan.disableChefHome);
    save({ ...s, chef: next });
    return json(200, {
      application: application({ ...s, chef: next }),
    } satisfies RegisterDocumentResponse);
  }

  if (route === "DELETE /api/chef/application/documents") {
    const b = obj as Partial<RemoveDocumentRequest>;
    if (b.kind !== "kitchen_photo")
      return validation({ kind: "Only kitchen photos can be removed." });
    const c = checkStoragePath("kitchen_photo", userId, b.path);
    if (!c.ok && c.kind === "foreign") return fail(403, "FORBIDDEN", c.message);
    if (!c.ok) return validation({ path: c.message });
    const paths = chef.documents.kitchenPhotoPaths;
    if (!paths.includes(c.path))
      return fail(404, "NOT_FOUND", "That kitchen photo is not registered.");
    const plan = planPrivateChange(privateState(chef), {
      kitchenPhotoPaths: paths.filter((p) => p !== c.path),
    });
    const next = applyColumns(chef, plan.columns, plan.disableChefHome);
    save({ ...s, chef: next });
    return json(200, {
      application: application({ ...s, chef: next }),
    } satisfies RegisterDocumentResponse);
  }

  if (route === "POST /api/chef/application/submit") {
    if (chef.status === "approved")
      return fail(
        409,
        "INVALID_STATE",
        "Your application is already approved.",
      );
    const missing = application(s).missing;
    if (missing.length)
      return fail(
        409,
        "APPLICATION_INCOMPLETE",
        "The application is not complete.",
        { missing },
      );
    const plan = planSubmit({
      status: chef.status,
      idCheck: chef.checks.id,
      foodHandlerCheck: chef.checks.foodHandler,
      kitchenCheck: chef.checks.kitchen,
      locationOptions: chef.locationOptions,
    });
    let next = applyColumns(chef, plan.columns, false);
    if (plan.moveToPending)
      next = { ...next, status: "pending", rejectReason: null };
    save({ ...s, chef: next });
    return json(200, {
      application: application({ ...s, chef: next }),
      mock: true,
    } satisfies SubmitApplicationResponse);
  }

  return fail(404, "NOT_FOUND", "Not found.");
}

function chefOnly(s: MockState): Response | null {
  return s.profile!.role !== "chef" || !s.chef
    ? fail(403, "FORBIDDEN", "Only chefs can do that.")
    : null;
}

const CAP_MESSAGE = `You already have ${MAX_ACTIVE_DISHES} active dishes. Deactivate one first.`;

/**
 * MOCK dish routes (contract 5A). Order of checks as in the real routes: role (403); for PATCH the
 * dish must exist and be the caller's (404); unknown keys (422); a photo in another folder (403);
 * field errors (422); then the 50-active-dish cap (409).
 */
function dishRoutes(route: string, body: unknown, s: MockState): Response {
  const denied = chefOnly(s);
  if (denied) return denied;
  const userId = s.profile!.id;
  const obj = (body ?? {}) as Record<string, unknown>;
  const active = s.dishes.filter((d) => d.isActive).length;

  if (route === "GET /api/chef/dishes")
    return json(200, { items: s.dishes } satisfies ChefDishListResponse);

  const m = /^(POST|PATCH) \/api\/chef\/dishes(?:\/([^/]+))?$/.exec(route);
  if (!m || (m[1] === "POST") !== (m[2] === undefined))
    return fail(404, "NOT_FOUND", "Not found.");
  const mode = m[1] === "POST" ? "create" : "update";
  const current =
    mode === "update" ? s.dishes.find((d) => d.id === m[2]) : null;
  if (mode === "update" && !current)
    return fail(404, "NOT_FOUND", "Dish not found.");

  const allowed: readonly string[] =
    mode === "create" ? CREATE_DISH_KEYS : UPDATE_DISH_KEYS;
  const unknown: Record<string, string> = {};
  for (const k of Object.keys(obj))
    if (!allowed.includes(k)) unknown[k] = "Unknown field.";
  if (Object.keys(unknown).length) return validation(unknown);

  const { value, errors } = parseDishBody(obj, mode);
  if (typeof value.photoPath === "string") {
    const c = checkStoragePath("dish_photo", userId, value.photoPath);
    if (!c.ok && c.kind === "foreign") return fail(403, "FORBIDDEN", c.message);
    if (!c.ok) errors.photoPath = c.message;
  }
  if (Object.keys(errors).length) return validation(errors);

  if (mode === "create") {
    if (active >= MAX_ACTIVE_DISHES)
      return fail(409, "INVALID_STATE", CAP_MESSAGE);
    const now = new Date().toISOString();
    const dish: Dish = {
      id: crypto.randomUUID(),
      name: value.name!,
      photoPath: value.photoPath ?? null,
      description: value.description ?? null,
      cuisine: value.cuisine!,
      cookMinutes: value.cookMinutes!,
      ingredientCostCents: value.ingredientCostCents!,
      servings: value.servings!,
      allergens: value.allergens!,
      shelfLifeDays: value.shelfLifeDays!,
      isActive: true,
      currency: "CAD",
      createdAt: now,
      updatedAt: now,
    };
    save({ ...s, dishes: [dish, ...s.dishes] });
    return json(201, dish);
  }

  if (
    value.isActive === true &&
    !current!.isActive &&
    active >= MAX_ACTIVE_DISHES
  )
    return fail(409, "INVALID_STATE", CAP_MESSAGE);
  const changed = Object.keys(value).length > 0;
  const next: Dish = {
    ...current!,
    ...value,
    updatedAt: changed ? new Date().toISOString() : current!.updatedAt,
  } as Dish;
  save({ ...s, dishes: s.dishes.map((d) => (d.id === next.id ? next : d)) });
  return json(200, next);
}

/** MOCK availability routes (contract 5B). Opt-in dates; window today..today+180 (Toronto). */
function availabilityRoutes(
  route: string,
  body: unknown,
  s: MockState,
): Response {
  const denied = chefOnly(s);
  if (denied) return denied;
  const today = torontoToday();
  const view = (days: string[]): AvailabilityResponse => ({
    days: days.filter((d) => d >= today).sort(),
    today,
    lastBookableDay: addDays(today, AVAILABILITY_HORIZON_DAYS),
  });
  if (route === "GET /api/chef/availability")
    return json(200, view(s.availability));
  if (route !== "PUT /api/chef/availability")
    return fail(404, "NOT_FOUND", "Not found.");
  const obj = (body ?? {}) as Record<string, unknown>;
  const unknown: Record<string, string> = {};
  for (const k of Object.keys(obj))
    if (!(AVAILABILITY_KEYS as readonly string[]).includes(k))
      unknown[k] = "Unknown field.";
  if (Object.keys(unknown).length) return validation(unknown);
  const { add, remove, errors } = parseAvailabilityBody(obj, today);
  if (Object.keys(errors).length) return validation(errors);
  const days = new Set(s.availability);
  for (const d of add) days.add(d);
  for (const d of remove) days.delete(d);
  const next = [...days].sort();
  save({ ...s, availability: next });
  return json(200, view(next));
}
