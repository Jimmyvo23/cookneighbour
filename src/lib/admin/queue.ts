// Pure helpers for the admin chef-queue UI (T-036). No I/O. Rules that the server also enforces
// (reason length, unsafe characters) come from the same shared functions in
// src/lib/domain/admin-chefs.ts, so the form and the API agree; the server stays the authority.
//
// MOCK: every check status shown or sent here is a simulated outcome. Nothing is really verified.
import { ApiClientError } from "@/lib/api/client";
import { ApiFailure } from "@/lib/api/errors";
import type {
  AdminChecksRequest,
  AdminChefListItem,
  AdminChefListQuery,
  ApplicationMissingItem,
  ChefApplication,
  ChefStatus,
  KitchenReviewRequest,
  MockCheckStatus,
  SignedDocumentUrl,
} from "@/lib/api/types";
import { parseReason, REASON_MAX, REASON_MIN } from "@/lib/domain/admin-chefs";

export { REASON_MAX, REASON_MIN };
export const PAGE_SIZE = 20;
/** Signed links last 300 seconds; they are fetched again this long before that runs out. */
export const URL_LIFETIME_SECONDS = 300;
export const URL_REFRESH_MARGIN_SECONDS = 60;

export type StatusFilter = NonNullable<AdminChefListQuery["status"]>;
export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

export interface ListFilters {
  status: StatusFilter;
  /** Only chefs with an ID, food-handler or kitchen check still waiting (the police check is ignored). */
  checksPending: boolean;
}
export const DEFAULT_FILTERS: ListFilters = {
  status: "pending",
  checksPending: false,
};

export function listPath(f: ListFilters, cursor?: string | null): string {
  const q = new URLSearchParams({ status: f.status, limit: String(PAGE_SIZE) });
  if (f.checksPending) q.set("checks", "pending");
  if (cursor) q.set("cursor", cursor);
  return `/api/admin/chefs?${q.toString()}`;
}

/** Adds a page to the list; a chef that is already shown is not shown twice. */
export function mergeItems(
  shown: AdminChefListItem[],
  next: AdminChefListItem[],
): AdminChefListItem[] {
  const seen = new Set(shown.map((i) => i.id));
  return [...shown, ...next.filter((i) => !seen.has(i.id))];
}

export function chefStatusText(s: ChefStatus): string {
  return { pending: "Pending", approved: "Approved", rejected: "Rejected" }[s];
}

export function checkStatusLabel(s: MockCheckStatus): string {
  return {
    not_started: "Not started",
    pending: "Pending review",
    verified: "Verified",
    failed: "Failed",
  }[s];
}

/** A date for the admin, in the service area's time zone. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown date";
  return d.toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ---------------------------------------------------------------------------
// Errors in plain words
// ---------------------------------------------------------------------------
const MISSING_TEXT: Record<ApplicationMissingItem, string> = {
  displayName: "the display name",
  bio: "the bio",
  photo: "the profile photo",
  cuisines: "at least one cuisine",
  languages: "at least one language",
  hourlyRate: "the hourly rate",
  servicePostalPrefix: "the service postal code area",
  locationOptions: "where the chef can cook",
  idDocument: "the government ID file",
  foodHandler: "the Food Handler Certificate file",
  allergenAcknowledgement: "the allergen-awareness acknowledgement",
  phoneVerified: "the verified phone (MOCK SMS)",
  sampleDish: "an active dish with a photo",
  kitchenAddress: "the kitchen address",
  kitchenPhotos: "a kitchen photo",
  kitchenHygieneAcknowledgement: "the kitchen-hygiene acknowledgement",
};
const FILE_ITEMS = new Set<string>([
  "photo",
  "idDocument",
  "foodHandler",
  "sampleDish",
  "kitchenPhotos",
]);

export function describeAdminMissing(item: string): string {
  return MISSING_TEXT[item as ApplicationMissingItem] ?? item;
}

export type AdminAction =
  "load" | "approve" | "reject" | "checks" | "kitchen" | "list";

/** A clear message for any API error. INVALID_STATE tells the admin the file changed and to reload. */
export function describeAdminError(
  err: unknown,
  action: AdminAction = "load",
): string {
  if (!(err instanceof ApiClientError))
    return "Something went wrong. Please try again.";
  switch (err.code) {
    case "APPLICATION_INCOMPLETE": {
      const items = err.missing ?? [];
      const list = items.map(describeAdminMissing).join("; ");
      let text = list
        ? `This application cannot be ${action === "kitchen" ? "approved for the kitchen" : "approved"} yet. Still missing: ${list}.`
        : "This application is not complete yet.";
      // The server also checks that each uploaded file still exists in storage, so an item can be
      // missing here although the chef's own list shows the file.
      if (items.some((i) => FILE_ITEMS.has(i)))
        text +=
          " The server also checks that every uploaded file still exists. If the chef's page shows a file that is named here, it has vanished from storage: ask the chef to upload it again.";
      return text;
    }
    case "INVALID_STATE":
      return `${err.message} The chef may have changed the application after you opened it, or its status moved on. Nothing was saved. Reload this application and review it again.`;
    case "NOT_FOUND":
      return "That chef application no longer exists. Go back to the queue.";
    case "FORBIDDEN":
      return "Only admins can do this. Log in as an admin.";
    case "UNAUTHENTICATED":
      return "Your session ended. Log in again.";
    case "VALIDATION_FAILED": {
      const first = Object.values(err.fields)[0];
      return first ? `${err.message} ${first}` : err.message;
    }
    case "NETWORK":
      return err.message;
    default:
      return err.message;
  }
}

// ---------------------------------------------------------------------------
// Reason and note (shown to the chef as plain text; same rule as the server)
// ---------------------------------------------------------------------------
/** A message when the text breaks the shared rule (3 to 500, no control characters or lone
 *  surrogates), else null. */
export function reasonProblem(text: string, key = "reason"): string | null {
  try {
    parseReason({ [key]: text }, key);
    return null;
  } catch (e) {
    if (e instanceof ApiFailure) return e.extra.fields?.[key] ?? e.message;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
export interface DocRow {
  /** Stable key. */
  key: string;
  kind: SignedDocumentUrl["kind"];
  label: string;
  path: string;
  /** Null when the application lists the file but the server returned no link for it. */
  url: string | null;
}

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|gif|avif)$/i.test(path);
}

function rowFor(
  kind: DocRow["kind"],
  label: string,
  path: string,
  docs: SignedDocumentUrl[],
): DocRow {
  const hit = docs.find((d) => d.kind === kind && d.path === path);
  return { key: `${kind}:${path}`, kind, label, path, url: hit?.url ?? null };
}

export function idRow(
  app: ChefApplication,
  docs: SignedDocumentUrl[],
): DocRow | null {
  const p = app.documents.idDocumentPath;
  return p ? rowFor("id_document", "Government ID", p, docs) : null;
}
export function foodHandlerRow(
  app: ChefApplication,
  docs: SignedDocumentUrl[],
): DocRow | null {
  const p = app.documents.foodHandlerPath;
  return p ? rowFor("food_handler", "Food Handler Certificate", p, docs) : null;
}
export function kitchenRows(
  app: ChefApplication,
  docs: SignedDocumentUrl[],
): DocRow[] {
  return app.documents.kitchenPhotoPaths.map((p, i) =>
    rowFor("kitchen_photo", `Kitchen photo ${i + 1}`, p, docs),
  );
}

/** True once the signed links are close enough to expiry that they should be fetched again. */
export function linksNeedRefresh(
  fetchedAtMs: number,
  nowMs: number,
  expiresInSeconds = URL_LIFETIME_SECONDS,
): boolean {
  const ttl = Math.max(
    expiresInSeconds - URL_REFRESH_MARGIN_SECONDS,
    URL_REFRESH_MARGIN_SECONDS,
  );
  return nowMs - fetchedAtMs >= ttl * 1000;
}

/** Milliseconds until the links should be fetched again, from what the server said. */
export function refreshDelayMs(docs: SignedDocumentUrl[]): number {
  const seconds = docs.length
    ? Math.min(...docs.map((d) => d.expiresInSeconds))
    : URL_LIFETIME_SECONDS;
  return Math.max(seconds - URL_REFRESH_MARGIN_SECONDS, 30) * 1000;
}

/** The files an admin must look at again if they differ between two loads of the same chef. */
export function filesSignature(app: ChefApplication): string {
  return JSON.stringify([
    app.documents.idDocumentPath,
    app.documents.foodHandlerPath,
    [...app.documents.kitchenPhotoPaths].sort(),
    app.kitchenAddress,
  ]);
}

// ---------------------------------------------------------------------------
// Request bodies: exactly what the admin reviewed
// ---------------------------------------------------------------------------
export interface CheckEdits {
  id?: MockCheckStatus;
  foodHandler?: MockCheckStatus;
  police?: MockCheckStatus;
}

/**
 * Builds the MOCK checks request from what changed. Marking the ID or food-handler check sends the
 * stored path the admin was looking at; a check cannot be marked `verified` for a file the admin
 * could not open. Returns `errors` keyed by edit name when nothing can be sent.
 */
export function buildChecksBody(
  app: ChefApplication,
  edits: CheckEdits,
  docs: SignedDocumentUrl[],
): { body?: AdminChecksRequest; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const body: AdminChecksRequest = {};
  if (edits.id !== undefined && edits.id !== app.checks.id) {
    const row = idRow(app, docs);
    if (!row) errors.id = "There is no ID file to review.";
    else if (edits.id === "verified" && !row.url)
      errors.id = "You cannot verify a file you could not open.";
    else {
      body.idCheck = edits.id;
      body.idDocumentPath = row.path;
    }
  }
  if (
    edits.foodHandler !== undefined &&
    edits.foodHandler !== app.checks.foodHandler
  ) {
    const row = foodHandlerRow(app, docs);
    if (!row) errors.foodHandler = "There is no certificate file to review.";
    else if (edits.foodHandler === "verified" && !row.url)
      errors.foodHandler = "You cannot verify a file you could not open.";
    else {
      body.foodHandlerCheck = edits.foodHandler;
      body.foodHandlerPath = row.path;
    }
  }
  if (edits.police !== undefined && edits.police !== app.checks.police)
    body.policeCheck = edits.police;
  if (!Object.keys(errors).length && !Object.keys(body).length)
    errors.form = "Change at least one status first.";
  return Object.keys(errors).length ? { errors } : { body, errors };
}

/**
 * Builds the MOCK kitchen review. It always sends every stored photo path and the stored address
 * (`null` when none), which is what the server compares against. A rejection needs a note; an
 * approval's note is optional.
 */
export function buildKitchenBody(
  app: ChefApplication,
  decision: "approve" | "reject",
  note: string,
): { body?: KitchenReviewRequest; error?: string } {
  const trimmed = note.trim();
  if (decision === "reject" || trimmed) {
    const problem = reasonProblem(note, "note");
    if (problem) return { error: problem };
  }
  return {
    body: {
      decision,
      ...(trimmed ? { note } : {}),
      reviewedPhotoPaths: [...app.documents.kitchenPhotoPaths],
      reviewedAddress: app.kitchenAddress,
    },
  };
}
