// MOCK ADMIN ROUTES (T-036). Stand in for the six /api/admin/chefs routes of docs/api-contract.md
// section 6 until the browser talks to the real ones. Nothing here is real: the "chefs" are made
// up, files are never stored (the signed links point at one sample picture), and every check
// result is a MOCK outcome.
//
// The rules are the real pure functions: query, reason, checks and kitchen-review parsing from
// src/lib/domain/admin-chefs.ts and completeness from src/lib/domain/chef-application.ts. Order of
// checks follows the contract: session (401) and role (403) are decided by the caller; then the id
// is a uuid and names a chef (404); unknown keys (422, on their own); field rules (422); then
// state (409).
// The one difference: the list cursor is a plain offset ("m<number>"), because the real cursor
// code uses Node's Buffer.
import { ApiFailure } from "@/lib/api/errors";
import type {
  AdminChefDetail,
  AdminChefListItem,
  AdminChefListResponse,
  ApiError,
  ApiErrorCode,
  ApplicationMissingItem,
  ChefApplication,
  SignedDocumentUrl,
} from "@/lib/api/types";
import {
  CHECKS_KEYS,
  KITCHEN_REVIEW_KEYS,
  REJECT_KEYS,
  isUuid,
  parseChecksBody,
  parseKitchenReview,
  parseListQuery,
  parseReason,
} from "@/lib/domain/admin-chefs";
import { normalizePostalCode } from "@/lib/domain/address";
import { computeMissing } from "@/lib/domain/chef-application";

export type MockApp = Omit<ChefApplication, "missing">;

export interface MockQueueChef {
  id: string;
  email: string;
  createdAt: string;
  phoneVerified: boolean;
  sampleDishCount: number;
  /** Files the application lists although the object is gone from storage (a vanished file). */
  vanished: ("idDocument" | "foodHandler")[];
  app: MockApp;
}

export const MOCK_FILE_URL = "/mock/sample-document.svg";
const MOCK_PAGE = "m";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function fail(
  status: number,
  code: ApiErrorCode,
  message: string,
  extra: Partial<ApiError["error"]> = {},
) {
  return json(status, {
    error: { code, message, ...extra },
  } satisfies ApiError);
}
function validation(fields: Record<string, string>) {
  return fail(422, "VALIDATION_FAILED", "Check the highlighted fields.", {
    fields,
  });
}
const notFound = () =>
  fail(404, "NOT_FOUND", "No chef application with that id.");

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fileId = (n: number) =>
  `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;

function baseApp(displayName: string): MockApp {
  return {
    status: "pending",
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
    rejectReason: null,
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

function completeApp(
  n: number,
  displayName: string,
  over: Partial<MockApp> = {},
): MockApp {
  const id = uid(n);
  return {
    ...baseApp(displayName),
    bio: "I cook Vietnamese home food for families.",
    photoPath: `${id}/photo-${fileId(n)}.png`,
    cuisines: ["Vietnamese"],
    languages: ["English", "Vietnamese"],
    hourlyRateCents: 2800,
    servicePostalPrefix: "L5B",
    serviceRadiusKm: 20,
    allergenAckAt: "2026-10-01T15:00:00.000Z",
    documents: {
      idDocumentPath: `${id}/id-${fileId(n)}.png`,
      foodHandlerPath: `${id}/food-handler-${fileId(n)}.png`,
      kitchenPhotoPaths: [],
    },
    checks: {
      id: "pending",
      foodHandler: "pending",
      kitchen: "not_started",
      police: "not_started",
    },
    ...over,
  };
}

/** The made-up queue that appears when an admin logs in to the MOCK adapter. */
export function seedAdminQueue(): MockQueueChef[] {
  const t = (day: number, hour = 12) =>
    new Date(Date.UTC(2026, 9, day, hour)).toISOString();
  const chef = (
    n: number,
    createdAt: string,
    app: MockApp,
    over: Partial<MockQueueChef> = {},
  ): MockQueueChef => ({
    id: uid(n),
    email: `mock-chef-${n}@example.com`,
    createdAt,
    phoneVerified: true,
    sampleDishCount: 1,
    vanished: [],
    app,
    ...over,
  });
  const detailed: MockQueueChef[] = [
    // Ready to review: both file checks pending, chef's home offered with a kitchen waiting.
    chef(
      901,
      t(7),
      completeApp(901, "Linh Nguyen", {
        locationOptions: ["customer_home", "chef_home"],
        kitchenAddress: {
          line: "1 Fictional Street",
          city: "Mississauga",
          postalCode: "L5B1A1",
        },
        kitchenHygieneAckAt: "2026-10-02T15:00:00.000Z",
        documents: {
          idDocumentPath: `${uid(901)}/id-${fileId(901)}.png`,
          foodHandlerPath: `${uid(901)}/food-handler-${fileId(901)}.png`,
          kitchenPhotoPaths: [
            `${uid(901)}/kitchen-${fileId(1)}.png`,
            `${uid(901)}/kitchen-${fileId(2)}.png`,
          ],
        },
        checks: {
          id: "pending",
          foodHandler: "pending",
          kitchen: "pending",
          police: "not_started",
        },
      }),
    ),
    // Missing a bio and more: approve answers APPLICATION_INCOMPLETE.
    chef(
      902,
      t(6),
      {
        ...baseApp("Incomplete Ivy"),
        cuisines: ["Thai"],
        documents: {
          idDocumentPath: `${uid(902)}/id-${fileId(902)}.png`,
          foodHandlerPath: null,
          kitchenPhotoPaths: [],
        },
        checks: {
          id: "pending",
          foodHandler: "not_started",
          kitchen: "not_started",
          police: "not_started",
        },
      },
      { phoneVerified: false, sampleDishCount: 0 },
    ),
    // Complete, but the ID file has vanished from storage (its check is still pending).
    chef(
      903,
      t(5),
      completeApp(903, "Vanished Vera", {
        checks: {
          id: "pending",
          foodHandler: "verified",
          kitchen: "not_started",
          police: "not_started",
        },
      }),
      { vanished: ["idDocument"] },
    ),
    chef(
      904,
      t(4),
      completeApp(904, "Tuan Pham", {
        status: "approved",
        checks: {
          id: "verified",
          foodHandler: "verified",
          kitchen: "not_started",
          police: "not_started",
        },
      }),
    ),
    chef(
      905,
      t(3),
      completeApp(905, "Rosa Lee", {
        status: "rejected",
        rejectReason: "MOCK: the <b>ID photo</b> was too blurry to read.",
        checks: {
          id: "failed",
          foodHandler: "pending",
          kitchen: "not_started",
          police: "not_started",
        },
      }),
    ),
  ];
  // Filler so that "Load more" has something to load (20 per page).
  const filler: MockQueueChef[] = Array.from({ length: 22 }, (_, i) =>
    chef(
      100 + i,
      new Date(Date.UTC(2026, 8, 30, 20 - i)).toISOString(),
      {
        ...baseApp(`Applicant ${String(i + 1).padStart(2, "0")}`),
        cuisines: ["Filipino"],
      },
      { phoneVerified: false, sampleDishCount: 0 },
    ),
  );
  return [...detailed, ...filler];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function application(c: MockQueueChef): ChefApplication {
  const a = c.app;
  return {
    ...a,
    missing: computeMissing({
      displayName: a.displayName,
      bio: a.bio,
      photoPath: a.photoPath,
      cuisines: a.cuisines,
      languages: a.languages,
      hourlyRateCents: a.hourlyRateCents,
      servicePostalPrefix: a.servicePostalPrefix,
      locationOptions: a.locationOptions,
      idDocumentPath: a.documents.idDocumentPath,
      foodHandlerPath: a.documents.foodHandlerPath,
      allergenAckAt: a.allergenAckAt,
      phoneVerified: c.phoneVerified,
      sampleDishCount: c.sampleDishCount,
      kitchenAddress: a.kitchenAddress,
      kitchenPhotoPaths: a.documents.kitchenPhotoPaths,
      kitchenHygieneAckAt: a.kitchenHygieneAckAt,
    }),
  };
}

/** What approve checks: the submit rule, but a file that vanished from storage counts as absent. */
function approveMissing(c: MockQueueChef): ApplicationMissingItem[] {
  const gone = new Set(c.vanished);
  return application({
    ...c,
    app: {
      ...c.app,
      documents: {
        ...c.app.documents,
        idDocumentPath: gone.has("idDocument")
          ? null
          : c.app.documents.idDocumentPath,
        foodHandlerPath: gone.has("foodHandler")
          ? null
          : c.app.documents.foodHandlerPath,
      },
    },
  }).missing;
}

function signedDocuments(c: MockQueueChef): SignedDocumentUrl[] {
  const out: SignedDocumentUrl[] = [];
  const add = (kind: SignedDocumentUrl["kind"], path: string | null) => {
    if (path)
      out.push({ kind, path, url: MOCK_FILE_URL, expiresInSeconds: 300 });
  };
  if (!c.vanished.includes("idDocument"))
    add("id_document", c.app.documents.idDocumentPath);
  if (!c.vanished.includes("foodHandler"))
    add("food_handler", c.app.documents.foodHandlerPath);
  for (const p of c.app.documents.kitchenPhotoPaths) add("kitchen_photo", p);
  return out;
}

function listItem(c: MockQueueChef): AdminChefListItem {
  return {
    id: c.id,
    displayName: c.app.displayName,
    status: c.app.status,
    cuisines: c.app.cuisines,
    createdAt: c.createdAt,
    checks: c.app.checks,
    chefHomeEnabled: c.app.chefHomeEnabled,
    locationOptions: c.app.locationOptions,
  };
}

function unknownKeys(
  body: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(body))
    if (!allowed.includes(k)) out[k] = "Unknown field.";
  return out;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));
const sameAddress = (
  a: { line: string; city: string; postalCode: string } | null,
  b: { line: string; city: string; postalCode: string } | null,
) =>
  a === null || b === null
    ? a === b
    : a.line.trim() === b.line.trim() &&
      a.city.trim() === b.city.trim() &&
      normalizePostalCode(a.postalCode) === normalizePostalCode(b.postalCode);

export interface AdminResult {
  response: Response;
  /** Set when the queue changed. */
  queue?: MockQueueChef[];
}

/**
 * Handles one admin request. The caller has already checked the session (401) and the admin role
 * (403), and that the Content-Type is JSON.
 */
export function adminRoutes(
  method: string,
  path: string,
  body: unknown,
  queue: MockQueueChef[],
): AdminResult {
  const url = new URL(path, "http://mock.local");
  const m =
    /^\/api\/admin\/chefs(?:\/([^/]+)(?:\/(approve|reject|checks|kitchen-review))?)?$/.exec(
      url.pathname,
    );
  if (!m) return { response: fail(404, "NOT_FOUND", "Not found.") };
  const [, id, action] = m;
  const obj = (body ?? {}) as Record<string, unknown>;
  try {
    if (id === undefined) {
      if (method !== "GET")
        return { response: fail(404, "NOT_FOUND", "Not found.") };
      return { response: list(url.searchParams, queue) };
    }
    const chef = isUuid(id) ? queue.find((c) => c.id === id) : undefined;
    if (!chef) return { response: notFound() };
    const save = (next: MockQueueChef): AdminResult => ({
      response: json(200, { application: application(next) }),
      queue: queue.map((c) => (c.id === next.id ? next : c)),
    });

    if (!action) {
      if (method !== "GET")
        return { response: fail(404, "NOT_FOUND", "Not found.") };
      return {
        response: json(200, {
          application: application(chef),
          email: chef.email,
          documents: signedDocuments(chef),
        } satisfies AdminChefDetail),
      };
    }
    const wanted = action === "checks" ? "PATCH" : "POST";
    if (method !== wanted)
      return { response: fail(404, "NOT_FOUND", "Not found.") };

    if (action === "approve") return approve(chef, save);
    if (action === "reject") return reject(chef, obj, save);
    if (action === "checks") return checks(chef, obj, save);
    return kitchen(chef, obj, save);
  } catch (e) {
    if (e instanceof ApiFailure && e.code === "VALIDATION_FAILED")
      return { response: validation(e.extra.fields ?? {}) };
    throw e;
  }
}

function list(params: URLSearchParams, queue: MockQueueChef[]): Response {
  const cursor = params.get("cursor");
  const rest = new URLSearchParams(params);
  rest.delete("cursor");
  let offset = 0;
  let cursorError: string | undefined;
  if (cursor !== null) {
    const c = new RegExp(`^${MOCK_PAGE}(\\d{1,4})$`).exec(cursor);
    if (c) offset = Number(c[1]);
    else cursorError = "That page marker is not valid. Start again.";
  }
  let q;
  try {
    q = parseListQuery(rest);
  } catch (e) {
    if (e instanceof ApiFailure && e.code === "VALIDATION_FAILED")
      return validation({
        ...e.extra.fields,
        ...(cursorError ? { cursor: cursorError } : {}),
      });
    throw e;
  }
  if (cursorError) return validation({ cursor: cursorError });
  const rows = queue
    .filter((c) => q.status === "all" || c.app.status === q.status)
    .filter(
      (c) =>
        !q.checksPending ||
        [
          c.app.checks.id,
          c.app.checks.foodHandler,
          c.app.checks.kitchen,
        ].includes("pending"),
    )
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
  const page = rows.slice(offset, offset + q.limit);
  const next = offset + q.limit;
  return json(200, {
    items: page.map(listItem),
    nextCursor: next < rows.length ? `${MOCK_PAGE}${next}` : null,
  } satisfies AdminChefListResponse);
}

type Save = (next: MockQueueChef) => AdminResult;

function approve(chef: MockQueueChef, save: Save): AdminResult {
  const a = chef.app;
  if (a.status !== "pending")
    return {
      response: fail(
        409,
        "INVALID_STATE",
        a.status === "approved"
          ? "This chef is already approved."
          : "This application is rejected: the chef has to update it and submit it again first.",
      ),
    };
  const missing = approveMissing(chef);
  if (missing.length)
    return {
      response: fail(
        409,
        "APPLICATION_INCOMPLETE",
        "The application is not complete.",
        {
          missing,
        },
      ),
    };
  const notVerified = [
    a.checks.id !== "verified" && "ID check",
    a.checks.foodHandler !== "verified" && "Food Handler Certificate check",
  ].filter(Boolean);
  if (notVerified.length)
    return {
      response: fail(
        409,
        "INVALID_STATE",
        `The ${notVerified.join(" and the ")} must be verified (MOCK) before approving.`,
      ),
    };
  return save({
    ...chef,
    app: { ...a, status: "approved", rejectReason: null },
  });
}

function reject(
  chef: MockQueueChef,
  body: Record<string, unknown>,
  save: Save,
): AdminResult {
  const unknown = unknownKeys(body, REJECT_KEYS);
  if (Object.keys(unknown).length) return { response: validation(unknown) };
  const reason = parseReason(body, "reason");
  if (chef.app.status === "rejected")
    return {
      response: fail(
        409,
        "INVALID_STATE",
        "This application is already rejected.",
      ),
    };
  return save({
    ...chef,
    app: { ...chef.app, status: "rejected", rejectReason: reason },
  });
}

function checks(
  chef: MockQueueChef,
  body: Record<string, unknown>,
  save: Save,
): AdminResult {
  const unknown = unknownKeys(body, CHECKS_KEYS);
  if (Object.keys(unknown).length) return { response: validation(unknown) };
  const c = parseChecksBody(body);
  const d = chef.app.documents;
  // Stale-review protection: the reviewed paths must still be the stored ones; else nothing is saved.
  if (
    (c.idCheck !== undefined && c.idDocumentPath !== d.idDocumentPath) ||
    (c.foodHandlerCheck !== undefined &&
      c.foodHandlerPath !== d.foodHandlerPath)
  )
    return {
      response: fail(
        409,
        "INVALID_STATE",
        "The chef replaced that file after you opened it. Nothing was saved.",
      ),
    };
  return save({
    ...chef,
    app: {
      ...chef.app,
      checks: {
        ...chef.app.checks,
        ...(c.idCheck !== undefined ? { id: c.idCheck } : {}),
        ...(c.foodHandlerCheck !== undefined
          ? { foodHandler: c.foodHandlerCheck }
          : {}),
        ...(c.policeCheck !== undefined ? { police: c.policeCheck } : {}),
      },
    },
  });
}

function kitchen(
  chef: MockQueueChef,
  body: Record<string, unknown>,
  save: Save,
): AdminResult {
  const unknown = unknownKeys(body, KITCHEN_REVIEW_KEYS);
  if (Object.keys(unknown).length) return { response: validation(unknown) };
  const r = parseKitchenReview(body);
  const a = chef.app;
  if (
    !sameSet(r.reviewedPhotoPaths, a.documents.kitchenPhotoPaths) ||
    !sameAddress(r.reviewedAddress, a.kitchenAddress)
  )
    return {
      response: fail(
        409,
        "INVALID_STATE",
        "The kitchen photos or address changed after you opened them. Nothing was saved.",
      ),
    };
  if (r.decision === "reject")
    return save({
      ...chef,
      app: {
        ...a,
        chefHomeEnabled: false,
        checks: { ...a.checks, kitchen: "failed" },
      },
    });
  if (!a.locationOptions.includes("chef_home"))
    return {
      response: fail(
        409,
        "INVALID_STATE",
        "This chef does not offer cooking at their own home.",
      ),
    };
  const missing: ApplicationMissingItem[] = [];
  if (!a.kitchenAddress) missing.push("kitchenAddress");
  if (a.documents.kitchenPhotoPaths.length === 0) missing.push("kitchenPhotos");
  if (!a.kitchenHygieneAckAt) missing.push("kitchenHygieneAcknowledgement");
  if (missing.length)
    return {
      response: fail(
        409,
        "APPLICATION_INCOMPLETE",
        "The kitchen is not complete.",
        {
          missing,
        },
      ),
    };
  return save({
    ...chef,
    app: {
      ...a,
      chefHomeEnabled: true,
      checks: { ...a.checks, kitchen: "verified" },
    },
  });
}
