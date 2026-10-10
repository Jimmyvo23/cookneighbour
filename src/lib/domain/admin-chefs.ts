// Admin chef-queue rules (T-035, contract section 6). Pure functions, no I/O and no server
// imports, so they are unit-tested without a database and the routes stay thin.
//
// MOCK: every check status here is a simulated outcome recorded by an admin. Nothing verifies a
// real document.
import { validationFailed } from "../api/errors.ts";
import { Fields } from "../api/validate.ts";
import type {
  ChefStatus,
  MockCheckStatus,
  PoliceCheckStatus,
} from "../api/types.ts";
import { normalizePostalCode } from "./address.ts";
import type { KitchenAddress } from "./chef-application.ts";

export const REASON_MIN = 3;
export const REASON_MAX = 500;
export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 50;
/** Same cap as the chef-side route (MAX_KITCHEN_PHOTOS). */
const MAX_PHOTOS = 10;
const PATH_MAX = 200;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (v: string) => UUID_RE.test(v);

const MOCK_STATUSES: MockCheckStatus[] = [
  "not_started",
  "pending",
  "verified",
  "failed",
];
const POLICE_STATUSES: PoliceCheckStatus[] = [
  "not_started",
  "pending",
  "verified",
  "failed",
];

// ---------------------------------------------------------------------------
// Flag for the admin list (D-21a)
// ---------------------------------------------------------------------------
export type CheckName = "id" | "foodHandler" | "kitchen" | "police";
const CHECK_ORDER: CheckName[] = ["id", "foodHandler", "kitchen", "police"];

/** MOCK checks that are currently `failed`, in a fixed order. */
export function failedChecks(
  checks: Record<CheckName, MockCheckStatus | PoliceCheckStatus>,
): CheckName[] {
  return CHECK_ORDER.filter((k) => checks[k] === "failed");
}

/**
 * D-21(a): an admin may reset a MOCK check at any time and an approved chef's status does not
 * change when a check fails, so the list flags an approved chef with any failed check (MOCK) for
 * the admin to look at.
 */
export function isFlagged(
  status: ChefStatus,
  checks: Record<CheckName, MockCheckStatus | PoliceCheckStatus>,
): boolean {
  return status === "approved" && failedChecks(checks).length > 0;
}

// ---------------------------------------------------------------------------
// GET /api/admin/chefs query
// ---------------------------------------------------------------------------
export interface ListCursor {
  /** Exactly as the database returned it (microseconds kept), with "+00:00" written as "Z". */
  createdAt: string;
  id: string;
}
export interface ParsedListQuery {
  status: ChefStatus | "all";
  /** True when only chefs with at least one MOCK check (ID, food handler, kitchen) still `pending`. */
  checksPending: boolean;
  limit: number;
  cursor: ListCursor | null;
}

// The cursor value goes into a PostgREST filter string, so it is matched against a strict shape
// before use: only digits, "-", ":", "T", ".", "Z" or a numeric offset can get through.
const TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export function encodeCursor(createdAt: string, id: string): string {
  const t = createdAt.replace(/\+00:00$/, "Z");
  return Buffer.from(JSON.stringify({ t, id })).toString("base64url");
}

export function decodeCursor(raw: string): ListCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(raw) || raw.length > 200) return null;
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    const { t, id } = v as Record<string, unknown>;
    if (typeof t !== "string" || typeof id !== "string") return null;
    if (!TIMESTAMP_RE.test(t) || !isUuid(id)) return null;
    return { createdAt: t, id };
  } catch {
    return null;
  }
}

export function parseListQuery(params: URLSearchParams): ParsedListQuery {
  const errors: Record<string, string> = {};
  const out: ParsedListQuery = {
    status: "pending",
    checksPending: false,
    limit: LIST_DEFAULT_LIMIT,
    cursor: null,
  };

  const status = params.get("status");
  if (status !== null) {
    if (["pending", "approved", "rejected", "all"].includes(status))
      out.status = status as ParsedListQuery["status"];
    else errors.status = "Choose pending, approved, rejected or all.";
  }

  const checks = params.get("checks");
  if (checks !== null) {
    if (checks === "pending") out.checksPending = true;
    else errors.checks = "Only checks=pending is supported.";
  }

  const limit = params.get("limit");
  if (limit !== null) {
    const n = /^\d{1,3}$/.test(limit) ? Number(limit) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= LIST_MAX_LIMIT) out.limit = n;
    else errors.limit = `Enter a whole number from 1 to ${LIST_MAX_LIMIT}.`;
  }

  const cursor = params.get("cursor");
  if (cursor !== null) {
    const c = decodeCursor(cursor);
    if (c) out.cursor = c;
    else errors.cursor = "That page marker is not valid. Start again.";
  }

  if (Object.keys(errors).length) throw validationFailed(errors);
  return out;
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------
export const REJECT_KEYS = ["reason"] as const;

/** A reason or note shown to the chef: trimmed, 3 to 500 characters, no control characters. */
export function parseReason(
  body: Record<string, unknown>,
  key: string,
): string {
  const f = new Fields();
  const v = f.text(body, key, REASON_MIN, REASON_MAX);
  f.done();
  return v;
}

export const CHECKS_KEYS = [
  "idCheck",
  "idDocumentPath",
  "foodHandlerCheck",
  "foodHandlerPath",
  "policeCheck",
] as const;

export interface ParsedChecks {
  idCheck?: MockCheckStatus;
  idDocumentPath?: string;
  foodHandlerCheck?: MockCheckStatus;
  foodHandlerPath?: string;
  /** MOCK. */
  policeCheck?: PoliceCheckStatus;
}

const has = (o: Record<string, unknown>, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

function reviewedPath(
  body: Record<string, unknown>,
  key: string,
  errors: Record<string, string>,
): string | undefined {
  const v = body[key];
  if (typeof v === "string" && v.length >= 1 && v.length <= PATH_MAX) return v;
  errors[key] = "Send the path you reviewed.";
  return undefined;
}

export function parseChecksBody(body: Record<string, unknown>): ParsedChecks {
  const errors: Record<string, string> = {};
  const out: ParsedChecks = {};

  if (
    !has(body, "idCheck") &&
    !has(body, "foodHandlerCheck") &&
    !has(body, "policeCheck")
  )
    errors.idCheck = "Send at least one check.";

  for (const [check, path, outCheck, outPath] of [
    ["idCheck", "idDocumentPath", "idCheck", "idDocumentPath"],
    [
      "foodHandlerCheck",
      "foodHandlerPath",
      "foodHandlerCheck",
      "foodHandlerPath",
    ],
  ] as const) {
    if (has(body, check)) {
      if (MOCK_STATUSES.includes(body[check] as MockCheckStatus))
        out[outCheck] = body[check] as MockCheckStatus;
      else errors[check] = "Choose not_started, pending, verified or failed.";
      // B1: the admin names the file they actually looked at.
      const p = reviewedPath(body, path, errors);
      if (p !== undefined) out[outPath] = p;
    } else if (has(body, path)) {
      errors[check] = `Send ${check} together with ${path}.`;
    }
  }

  if (has(body, "policeCheck")) {
    if (POLICE_STATUSES.includes(body.policeCheck as PoliceCheckStatus))
      out.policeCheck = body.policeCheck as PoliceCheckStatus;
    else
      errors.policeCheck = "Choose not_started, pending, verified or failed.";
  }

  if (Object.keys(errors).length) throw validationFailed(errors);
  return out;
}

export const KITCHEN_REVIEW_KEYS = [
  "decision",
  "note",
  "reviewedPhotoPaths",
  "reviewedAddress",
] as const;

export interface ParsedKitchenReview {
  decision: "approve" | "reject";
  /** Required for reject. Optional for approve (then it is shown to the chef too). */
  note: string | null;
  reviewedPhotoPaths: string[];
  /** Null when the admin saw no kitchen address (none is stored). */
  reviewedAddress: KitchenAddress | null;
}

export function parseKitchenReview(
  body: Record<string, unknown>,
): ParsedKitchenReview {
  const errors: Record<string, string> = {};

  const decision = body.decision;
  if (decision !== "approve" && decision !== "reject")
    errors.decision = "Choose approve or reject.";

  let note: string | null = null;
  const noteGiven = has(body, "note") && body.note !== null;
  if (decision === "reject" || noteGiven) {
    const f = new Fields();
    const v = f.text(body, "note", REASON_MIN, REASON_MAX);
    if (f.errors.note) errors.note = f.errors.note;
    else note = v;
  }

  let photos: string[] = [];
  const rp = body.reviewedPhotoPaths;
  if (
    Array.isArray(rp) &&
    rp.length <= MAX_PHOTOS &&
    rp.every(
      (p) => typeof p === "string" && p.length >= 1 && p.length <= PATH_MAX,
    ) &&
    new Set(rp).size === rp.length
  )
    photos = rp as string[];
  else
    errors.reviewedPhotoPaths = `Send the kitchen photo paths you reviewed (up to ${MAX_PHOTOS}, no repeats).`;

  let address: KitchenAddress | null = null;
  const ra = body.reviewedAddress;
  if (ra === null) address = null;
  else if (
    typeof ra === "object" &&
    !Array.isArray(ra) &&
    Object.keys(ra).every((k) => ["line", "city", "postalCode"].includes(k))
  ) {
    const o = ra as Record<string, unknown>;
    const postal =
      typeof o.postalCode === "string"
        ? normalizePostalCode(o.postalCode)
        : null;
    if (
      typeof o.line === "string" &&
      typeof o.city === "string" &&
      postal &&
      o.line.trim() &&
      o.city.trim()
    )
      address = {
        line: o.line.trim(),
        city: o.city.trim(),
        postalCode: postal,
      };
    else
      errors.reviewedAddress =
        "Send the kitchen address you reviewed, or null.";
  } else
    errors.reviewedAddress = "Send the kitchen address you reviewed, or null.";

  if (Object.keys(errors).length) throw validationFailed(errors);
  return {
    decision: decision as "approve" | "reject",
    note,
    reviewedPhotoPaths: photos,
    reviewedAddress: address,
  };
}
