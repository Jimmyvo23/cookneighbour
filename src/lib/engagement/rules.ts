// Pure rules and texts of the reviews, problem-report and admin-decision screens (T-049,
// contract section 7D). No I/O. The server stays the authority: these checks only save a round
// trip and word the answers. The limits are copied from the contract.
import { ApiClientError } from "@/lib/api/client";
import type { BookingStatus } from "@/lib/api/types";
import { freeTrialEffect } from "@/lib/domain/cancellation";
import { hasUnsafeText } from "@/lib/domain/text-safety";
import { formatWhen } from "@/lib/booking/form";
import type {
  CreateReportRequest,
  CreateReviewRequest,
  DecisionRequest,
  FinalBookingStatus,
  ReportCategory,
  ReportStatus,
  ReviewAllowance,
} from "./types";

// TODO(T-048 types): REVIEW_WINDOW_DAYS will live in src/lib/domain/config.ts once T-048 merges.
export const REVIEW_WINDOW_DAYS = 14;
export const COMMENT_MAX = 1000;
export const DESCRIPTION_MAX = 2000;
export const NOTE_MIN = 3;
export const NOTE_MAX = 500;

export type Fields = Record<string, string>;

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------
/** Shown before the review is sent (Jimmy 2026-10-20: final once posted). */
export const REVIEW_FINAL_TEXT =
  "A review is final once you post it. You cannot edit or delete it. If you make a mistake, use “Report a problem” and an admin will look at it.";

export function parseReviewForm(input: {
  rating: number | null;
  comment: string;
}): { ok: true; request: CreateReviewRequest } | { ok: false; fields: Fields } {
  const fields: Fields = {};
  const r = input.rating;
  if (r === null || !Number.isInteger(r) || r < 1 || r > 5)
    fields.rating = "Choose a rating from 1 to 5.";
  const comment = input.comment.trim();
  if (comment.length > COMMENT_MAX)
    fields.comment = `Use ${COMMENT_MAX} characters or fewer (${comment.length - COMMENT_MAX} too many).`;
  else if (hasUnsafeText(comment, true))
    fields.comment = "Remove the special characters from the comment.";
  if (Object.keys(fields).length) return { ok: false, fields };
  const request: CreateReviewRequest = { rating: r as number };
  if (comment) request.comment = comment;
  return { ok: true, request };
}

/** Why the form is not shown; null when a review may be written. */
export function allowanceText(a: ReviewAllowance): string | null {
  if (a.allowed) return null;
  switch (a.reason) {
    case "already_reviewed":
      return "You have already reviewed this booking. A review cannot be changed once it is posted.";
    case "window_closed":
      return `The time to write a review has ended. You can write a review for ${REVIEW_WINDOW_DAYS} days after a booking is completed${a.closesAt ? `, and that ended on ${formatWhen(a.closesAt)}` : ""}.`;
    case "not_completed":
      return "You can write a review after the booking is completed.";
    default:
      return "You cannot write a review for this booking.";
  }
}

export function reviewErrorText(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === "INVALID_STATE")
      switch (err.reason) {
        case "window_closed":
        case "already_reviewed":
        case "not_completed":
          return (
            allowanceText({
              allowed: false,
              reason: err.reason,
              closesAt: null,
            }) ?? err.message
          );
      }
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

export function starsText(n: number): string {
  return `${n} out of 5`;
}

// ---------------------------------------------------------------------------
// Problem reports
// ---------------------------------------------------------------------------
export const REPORT_CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: "safety", label: "Safety" },
  { value: "food_quality", label: "Food quality" },
  { value: "no_show", label: "Someone did not show up" },
  { value: "payment", label: "Payment or receipt" },
  { value: "other", label: "Something else" },
];
export const categoryLabel = (c: ReportCategory) =>
  REPORT_CATEGORIES.find((x) => x.value === c)?.label ?? c;

/** Only what is true by contract 7D: the reporter and an admin can read it. */
export const REPORT_PRIVACY_TEXT =
  "Only you and an admin can read your report. The other person cannot see it.";

const CATEGORY_VALUES = REPORT_CATEGORIES.map((c) => c.value as string);

export function parseReportForm(input: {
  clientId: string;
  category: string;
  description: string;
}): { ok: true; request: CreateReportRequest } | { ok: false; fields: Fields } {
  const fields: Fields = {};
  if (!CATEGORY_VALUES.includes(input.category))
    fields.category = "Choose what the problem is about.";
  const description = input.description.trim();
  if (!description) fields.description = "Tell us what went wrong.";
  else if (description.length > DESCRIPTION_MAX)
    fields.description = `Use ${DESCRIPTION_MAX} characters or fewer (${description.length - DESCRIPTION_MAX} too many).`;
  else if (hasUnsafeText(description, true))
    fields.description = "Remove the special characters from the text.";
  if (Object.keys(fields).length) return { ok: false, fields };
  return {
    ok: true,
    request: {
      clientId: input.clientId,
      category: input.category as ReportCategory,
      description,
    },
  };
}

export function reportStatusText(s: ReportStatus): string {
  switch (s) {
    case "open":
      return "Open: waiting for an admin";
    case "reviewing":
      return "An admin is looking at it";
    case "resolved":
      return "Resolved by an admin";
    case "dismissed":
      return "Closed by an admin";
  }
}
export const isReportActive = (s: ReportStatus) =>
  s === "open" || s === "reviewing";

export function reportErrorText(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.reason === "client_id_reused")
      return "This report was already sent with different text. Reload the page and write it again.";
    return err.message; // report_open: the server's own text
  }
  return "Something went wrong. Please try again.";
}

// ---------------------------------------------------------------------------
// Admin decisions (D-54, D-57, D-67)
// ---------------------------------------------------------------------------
const FINAL_LABELS: Record<FinalBookingStatus, string> = {
  completed: "Completed",
  cancelled: "Cancelled",
  no_show_chef: "Chef no-show",
  no_show_customer: "Customer no-show",
};
export const finalStatusLabel = (s: FinalBookingStatus) => FINAL_LABELS[s];
export function finalStatusChoices(): {
  value: FinalBookingStatus;
  label: string;
}[] {
  return (Object.keys(FINAL_LABELS) as FinalBookingStatus[]).map((value) => ({
    value,
    label: FINAL_LABELS[value],
  }));
}

/** What a final status does, from the contract 7D rules and the shared free-trial rule. */
export function decisionEffectText(
  status: FinalBookingStatus,
  anyDayCooked: boolean,
  isFreeTrial: boolean,
): string {
  const base: Record<FinalBookingStatus, string> = {
    completed: `The booking becomes completed. Both people can then write a review for ${REVIEW_WINDOW_DAYS} days.`,
    cancelled: "The booking is cancelled and its days are freed.",
    no_show_chef:
      "The booking is marked as a chef no-show and the days not yet cooked are freed.",
    no_show_customer:
      "The booking is marked as a customer no-show and the days not yet cooked are freed.",
  };
  let text = `${base[status]} Any open flag on it is closed.`;
  if (isFreeTrial)
    text +=
      freeTrialEffect(status, { anyDayCooked }) === "consume"
        ? " The customer's free first booking is used up."
        : " The customer's free first booking is given back.";
  return text;
}

export type DecisionKind = "resolve" | "dismiss" | "flag";

export function parseDecisionForm(input: {
  kind: DecisionKind;
  bookingStatus: BookingStatus;
  finalStatus: string;
  note: string;
}): { ok: true; request: DecisionRequest } | { ok: false; fields: Fields } {
  const fields: Fields = {};
  const note = input.note.trim();
  if (note.length < NOTE_MIN)
    fields.note = `Write a note of at least ${NOTE_MIN} characters.`;
  else if (note.length > NOTE_MAX)
    fields.note = `Use ${NOTE_MAX} characters or fewer (${note.length - NOTE_MAX} too many).`;
  else if (hasUnsafeText(note, true))
    fields.note = "Remove the special characters from the note.";
  // A report on a booking that is not accepted cannot change it (so no status is sent); a
  // dismissal never changes it; a flag always needs one.
  const needsStatus =
    input.kind === "flag" ||
    (input.kind === "resolve" && input.bookingStatus === "accepted");
  const valid = finalStatusChoices().some((c) => c.value === input.finalStatus);
  if (needsStatus && !valid)
    fields.finalStatus = "Choose the status the booking gets.";
  if (Object.keys(fields).length) return { ok: false, fields };
  const request: DecisionRequest = { note };
  if (needsStatus)
    request.finalStatus = input.finalStatus as FinalBookingStatus;
  return { ok: true, request };
}

export function decisionErrorText(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === "INVALID_STATE")
      switch (err.reason) {
        case "already_decided":
          return "Someone has already decided this. Nothing was changed. Reload the list to see the decision.";
        case "final_status_required":
          return "This booking is accepted, so choose the status it gets.";
        case "status_not_open":
          return "This booking has already finished, so its status cannot be changed. Resolve the report without a status.";
        case "no_open_flag":
          return "This booking has no open flag any more. Reload the list.";
      }
    if (err.code === "FORBIDDEN")
      return "Only admins can do this. Log in as an admin.";
    if (err.code === "UNAUTHENTICATED")
      return "Your session ended. Log in again.";
    if (err.code === "NOT_FOUND")
      return "That item no longer exists. Reload the list.";
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

export function freeTrialResultText(
  r: "held" | "consumed" | "released" | "none",
): string | null {
  switch (r) {
    case "held":
      return "The customer's free first booking is still held.";
    case "consumed":
      return "The customer's free first booking is used up.";
    case "released":
      return "The customer's free first booking was given back.";
    default:
      return null;
  }
}

export function blockReasonText(r: "customer" | "phone" | "address"): string {
  switch (r) {
    case "customer":
      return "This account already used its free first booking.";
    case "phone":
      return "Another account with the same verified phone number already used a free first booking.";
    case "address":
      return "Another account with the same home address already used a free first booking.";
  }
}

export const FLAG_REASON_TEXT = {
  chef_rejected:
    "The chef's application was rejected after this booking was accepted.",
  no_day_cooked: "All visit days passed and no day was marked as cooked.",
} as const;
