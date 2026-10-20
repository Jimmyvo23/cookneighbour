// TODO(T-048 types): LOCAL copies of the contract section 7D types (docs/api-contract.md v1.16).
// Backend (T-048) adds these to src/lib/api/types.ts. When T-048 has merged, delete this file and
// import the same names from "@/lib/api/types" (they are meant to be identical).
import type {
  BookingStatus,
  LocationType,
  GroceryOption,
} from "@/lib/api/types";

export type FinalBookingStatus =
  "completed" | "cancelled" | "no_show_chef" | "no_show_customer";

/** A review as the two parties of a booking see it. No author or subject id. */
export interface ReviewView {
  id: string;
  bookingId: string;
  authorRole: "customer" | "chef";
  authorDisplayName: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  mine: boolean;
}

/**
 * A review on the public chef page. No author id and no booking id.
 * `authorDisplayName`: Jimmy chose "first name + rating" (2026-10-20). The server will send the
 * FIRST NAME only; until Backend changes the field the UI shows it exactly as received and never
 * builds a name itself.
 */
export interface PublicReview {
  id: string;
  authorDisplayName: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export type ReviewBlockReason =
  "not_completed" | "window_closed" | "already_reviewed";

export interface ReviewAllowance {
  allowed: boolean;
  reason: null | ReviewBlockReason;
  /** completedAt + 14 days; set whenever the booking is completed, else null. */
  closesAt: string | null;
}

export interface BookingReviews {
  bookingId: string;
  allowance: ReviewAllowance;
  mine: ReviewView | null;
  other: ReviewView | null;
}

export interface CreateReviewRequest {
  rating: number;
  comment?: string;
}

export type ReportCategory =
  "safety" | "food_quality" | "no_show" | "payment" | "other";
export type ReportStatus = "open" | "reviewing" | "resolved" | "dismissed";

/** Everything the reporter sees: no admin note, no final status, no decision text. */
export interface ReportView {
  id: string;
  bookingId: string;
  category: ReportCategory;
  description: string;
  status: ReportStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface CreateReportRequest {
  /** Lower-case UUID made once per report; sent again unchanged on a retry. */
  clientId: string;
  category?: ReportCategory;
  description: string;
}

export interface AdminPerson {
  id: string;
  displayName: string;
}

export interface AdminDecision {
  kind: "report_resolved" | "report_dismissed" | "flag_resolved";
  finalStatus: FinalBookingStatus | null;
  note: string;
  decidedAt: string;
}

export interface AdminBookingItem {
  id: string;
  status: BookingStatus;
  locationType: LocationType;
  groceryOption: GroceryOption;
  isFreeTrial: boolean;
  createdAt: string;
  firstDay: string;
  dates: string[];
  totalCents: number;
  currency: string;
  customer: AdminPerson;
  chef: AdminPerson;
  anyDayCooked: boolean;
  flag: null | {
    reason: "chef_rejected" | "no_day_cooked";
    flaggedAt: string;
    resolvedAt: string | null;
  };
  openReportCount: number;
}

export interface AdminReportItem {
  id: string;
  bookingId: string;
  category: ReportCategory;
  description: string;
  status: ReportStatus;
  createdAt: string;
  resolvedAt: string | null;
  reporter: AdminPerson & { role: "customer" | "chef" };
  booking: {
    status: BookingStatus;
    firstDay: string;
    customer: AdminPerson;
    chef: AdminPerson;
    anyDayCooked: boolean;
    frozen: boolean;
  };
  decision: null | AdminDecision;
}

export interface AdminFreeTrialBlock {
  id: string;
  customer: AdminPerson;
  reason: "customer" | "phone" | "address";
  createdAt: string;
  attempts: number;
}

export interface AdminMessageView {
  id: string;
  bookingId: string;
  senderId: string;
  senderRole: "customer" | "chef";
  senderName: string;
  clientId: string | null;
  body: string;
  createdAt: string;
}

export interface AdminDecisionResponse {
  reportId: string | null;
  booking: { id: string; status: BookingStatus };
  decision: AdminDecision;
  freeTrial: "held" | "consumed" | "released" | "none";
}

export interface DecisionRequest {
  finalStatus?: FinalBookingStatus;
  note: string;
}
