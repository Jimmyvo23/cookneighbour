// Pure rules of reviews, problem reports and admin decisions (T-048, contract section 7D). Shared
// by the real routes (src/lib/server/*) and the MOCK adapter, so the two cannot drift apart.
//
// Jimmy, 2026-10-20: a review only for a completed booking and only until REVIEW_WINDOW_DAYS after
// completion; one per author per booking; final once posted. A report is seen by the admin and its
// reporter only. D-54: the admin picks one of four final statuses.
import type {
  FinalBookingStatus,
  ReportCategory,
  ReviewAllowance,
} from "../api/types";
import { REVIEW_WINDOW_DAYS } from "./config";
import { hasUnsafeText } from "./text-safety";

export const REVIEW_KEYS = ["rating", "comment"];
export const REVIEW_COMMENT_MAX = 1000;
export const REPORT_KEYS = ["clientId", "category", "description"];
export const REPORT_DESCRIPTION_MAX = 2000;
export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  "safety",
  "food_quality",
  "no_show",
  "payment",
  "other",
];
/** D-54. */
export const FINAL_STATUSES: readonly FinalBookingStatus[] = [
  "completed",
  "cancelled",
  "no_show_chef",
  "no_show_customer",
];
export const DECISION_NOTE_MIN = 3;
export const DECISION_NOTE_MAX = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Review window
// ---------------------------------------------------------------------------
/** The last instant a review may be written (inclusive): completion + REVIEW_WINDOW_DAYS x 24 h. */
export function reviewWindowEnd(completedAt: Date | string): Date {
  const t = new Date(completedAt).getTime();
  return new Date(t + REVIEW_WINDOW_DAYS * 24 * HOUR_MS);
}

export const REVIEW_REFUSALS = {
  not_completed: "You can review a booking once it is completed.",
  window_closed: `The time to review this booking has ended (${REVIEW_WINDOW_DAYS} days after it was completed).`,
  already_reviewed:
    "You have already reviewed this booking. A posted review cannot be changed.",
} as const;

/**
 * May the caller write a review now? `alreadyReviewed` wins over the other reasons so the page
 * can show the review that exists. The database policy repeats the status and window rule.
 */
export function reviewAllowance(input: {
  status: string;
  completedAt: Date | string | null;
  now: Date;
  alreadyReviewed?: boolean;
}): ReviewAllowance {
  const closes =
    input.status === "completed" && input.completedAt
      ? reviewWindowEnd(input.completedAt)
      : null;
  const closesAt = closes ? closes.toISOString() : null;
  if (input.alreadyReviewed)
    return { allowed: false, reason: "already_reviewed", closesAt };
  if (!closes)
    return { allowed: false, reason: "not_completed", closesAt: null };
  if (input.now.getTime() > closes.getTime())
    return { allowed: false, reason: "window_closed", closesAt };
  return { allowed: true, reason: null, closesAt };
}

/**
 * Jimmy, 2026-10-20: the public chef page shows only the reviewer's FIRST NAME. The first word of
 * the trimmed display name (split on any whitespace); an empty name gives "Customer". Enforced on
 * the server, so the full name never leaves the API for anonymous readers.
 */
export function firstNameOf(displayName: string): string {
  const word = displayName.trim().split(/\s+/)[0] ?? "";
  return word === "" ? "Customer" : word;
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------
type Fail = { ok: false; fields: Record<string, string> };

function unknownKeys(
  body: Record<string, unknown>,
  allowed: readonly string[],
  fields: Record<string, string>,
) {
  for (const k of Object.keys(body))
    if (!allowed.includes(k)) fields[k] = "Unknown field.";
}

export type ParsedReview =
  { ok: true; rating: number; comment: string | null } | Fail;

export function parseReviewBody(body: Record<string, unknown>): ParsedReview {
  const fields: Record<string, string> = {};
  unknownKeys(body, REVIEW_KEYS, fields);
  const r = body.rating;
  if (typeof r !== "number" || !Number.isInteger(r) || r < 1 || r > 5)
    fields.rating = "Choose a rating from 1 to 5.";
  let comment: string | null = null;
  const c = body.comment;
  if (c !== undefined && c !== null) {
    if (typeof c !== "string") fields.comment = "Enter text.";
    else {
      const t = c.trim();
      if (t.length > REVIEW_COMMENT_MAX)
        fields.comment = `Use at most ${REVIEW_COMMENT_MAX} characters.`;
      else if (hasUnsafeText(t, true))
        fields.comment = "Remove control or invalid characters.";
      else comment = t === "" ? null : t;
    }
  }
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, rating: r as number, comment };
}

export type ParsedReport =
  | {
      ok: true;
      clientId: string;
      category: ReportCategory;
      description: string;
    }
  | Fail;

export function parseReportBody(body: Record<string, unknown>): ParsedReport {
  const fields: Record<string, string> = {};
  unknownKeys(body, REPORT_KEYS, fields);
  const id = body.clientId;
  if (typeof id !== "string" || !UUID.test(id))
    fields.clientId = "Send a new UUID (lower case) for each report.";
  let category: ReportCategory = "other";
  if (body.category !== undefined) {
    if (
      typeof body.category !== "string" ||
      !REPORT_CATEGORIES.includes(body.category as ReportCategory)
    )
      fields.category = `Choose one of: ${REPORT_CATEGORIES.join(", ")}.`;
    else category = body.category as ReportCategory;
  }
  let description = "";
  if (typeof body.description !== "string") fields.description = "Required.";
  else {
    description = body.description.trim();
    if (description.length < 1 || description.length > REPORT_DESCRIPTION_MAX)
      fields.description = `Enter 1 to ${REPORT_DESCRIPTION_MAX} characters.`;
    else if (hasUnsafeText(description, true))
      fields.description = "Remove control or invalid characters.";
  }
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, clientId: id as string, category, description };
}

export type ParsedDecision =
  { ok: true; finalStatus: FinalBookingStatus | null; note: string } | Fail;

/**
 * Body of an admin decision: `note` (3 to 500 safe characters) and `finalStatus`, which is
 * `required`, `optional` or `none` (the key is then unknown) for the route.
 */
export function parseDecisionBody(
  body: Record<string, unknown>,
  finalStatus: "required" | "optional" | "none",
): ParsedDecision {
  const fields: Record<string, string> = {};
  unknownKeys(
    body,
    finalStatus === "none" ? ["note"] : ["finalStatus", "note"],
    fields,
  );
  let note = "";
  if (typeof body.note !== "string") fields.note = "Required.";
  else {
    note = body.note.trim();
    if (note.length < DECISION_NOTE_MIN || note.length > DECISION_NOTE_MAX)
      fields.note = `Enter ${DECISION_NOTE_MIN} to ${DECISION_NOTE_MAX} characters.`;
    else if (hasUnsafeText(note, true))
      fields.note = "Remove control or invalid characters.";
  }
  let status: FinalBookingStatus | null = null;
  if (finalStatus !== "none") {
    const v = body.finalStatus;
    if (v === undefined || v === null) {
      if (finalStatus === "required")
        fields.finalStatus = `Choose one of: ${FINAL_STATUSES.join(", ")}.`;
    } else if (
      typeof v !== "string" ||
      !FINAL_STATUSES.includes(v as FinalBookingStatus)
    )
      fields.finalStatus = `Choose one of: ${FINAL_STATUSES.join(", ")}.`;
    else status = v as FinalBookingStatus;
  }
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, finalStatus: status, note };
}

// ---------------------------------------------------------------------------
// Notices (neutral: no report, flag, reporter or note, and no reason)
// ---------------------------------------------------------------------------
const STATUS_WORDS: Record<FinalBookingStatus, string> = {
  completed: "completed",
  cancelled: "cancelled",
  no_show_chef: "a chef no-show",
  no_show_customer: "a customer no-show",
};
export const BOOKING_DECIDED_TITLE = "An admin made a decision on your booking";
/** Must match the text written by the database function admin_decide_booking. */
export function bookingDecidedBody(status: FinalBookingStatus): string {
  return `An admin reviewed this booking and set it to ${STATUS_WORDS[status]}.`;
}

export const REPORT_REFUSALS = {
  report_open:
    "You already have a problem report open for this booking. Wait for an admin to answer it before sending another.",
  client_id_reused:
    "That report id was already used for a different report. Start a new report.",
} as const;
