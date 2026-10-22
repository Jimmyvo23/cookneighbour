// Server side of the admin lists and decisions of T-048 (contract section 7D).
//
// Authorization (contract section 2, rule 4): every entry point takes an AdminCaller from
// requireAdmin() (src/lib/server/admin-chefs.ts): 401 without a session, 403 unless profiles.role
// is 'admin', and only then the service-role client. Reads use the service role because the admin
// may see every row; nothing private is selected: no hash, phone, email or address. The admin's
// note lives in admin_decisions (no client privilege) and is returned to admins only.
//
// The three decisions run as ONE database function, admin_decide_booking (migration
// 20261022100000), which locks the booking row, re-checks everything under the lock and writes the
// status, the flags, the report, the notices and the audit row in one transaction (D-54, D-57,
// D-67). The free trial follows AFTER the save: applyFreeTrialEvent decides hold / consume /
// release from the status (A-16, D-26, D-37); a failure is logged and repaired by the next sweep.
// Logs carry the admin id and booking id only: never a note, a description or a name.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiFailure } from "@/lib/api/errors";
import type {
  AdminBookingItem,
  AdminDecision,
  AdminDecisionResponse,
  AdminFreeTrialBlock,
  AdminMessageView,
  AdminPerson,
  AdminReportItem,
  AdminReviewItem,
  FinalBookingStatus,
  Page,
} from "@/lib/api/types";
import { isUuid } from "@/lib/domain/admin-chefs";
import type { FreeTrialEvent } from "@/lib/domain/cancellation";
import { encodeListCursor } from "@/lib/server/booking-views";
import { applyFreeTrialEvent } from "@/lib/server/free-trial";
import { parseListParams, type ListParams } from "@/lib/server/paging";
import type { AdminCaller } from "@/lib/server/admin-chefs";

type Row = Record<string, unknown>;

const iso = (v: unknown) => new Date(v as string).toISOString();
const one = (v: unknown): Row | null =>
  Array.isArray(v)
    ? ((v[0] as Row | undefined) ?? null)
    : ((v as Row | null) ?? null);

function logDecision(adminId: string, bookingId: string) {
  console.info(`api: admin decision admin=${adminId} booking=${bookingId}`);
}

/** created_at descending, id descending; a cursor continues after the last item. */
function newestFirst<T extends { or: (f: string) => T }>(
  req: T,
  q: ListParams,
) {
  return q.cursor
    ? req.or(
        `created_at.lt."${q.cursor.c}",and(created_at.eq."${q.cursor.c}",id.lt.${q.cursor.i})`,
      )
    : req;
}

function pageOf<T>(rows: Row[], limit: number, items: T[]): Page<T> {
  const last = rows[limit - 1];
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeListCursor(last.created_at as string, last.id as string)
        : null,
  };
}

async function names(
  db: SupabaseClient,
  ids: readonly string[],
): Promise<Map<string, { displayName: string; role: string }>> {
  const out = new Map<string, { displayName: string; role: string }>();
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const r = await db
    .from("profiles")
    .select("id, display_name, role")
    .in("id", unique);
  if (r.error) throw new Error("profile lookup failed");
  for (const p of (r.data ?? []) as Row[])
    out.set(p.id as string, {
      displayName: p.display_name as string,
      role: p.role as string,
    });
  return out;
}
const person = (
  m: Map<string, { displayName: string; role: string }>,
  id: string,
): AdminPerson => ({ id, displayName: m.get(id)?.displayName ?? "Unknown" });

// ---------------------------------------------------------------------------
// GET /api/admin/bookings
// ---------------------------------------------------------------------------
export const ADMIN_BOOKING_STATUSES = [
  "all",
  "requested",
  "accepted",
  "declined",
  "cancelled",
  "completed",
  "no_show_customer",
  "no_show_chef",
  "expired",
] as const;

export async function listAdminBookings(
  a: AdminCaller,
  params: URLSearchParams,
): Promise<Page<AdminBookingItem>> {
  const q = parseListParams(params, {
    status: ADMIN_BOOKING_STATUSES,
    flag: ["open"],
  });
  const flagOpen = q.values.flag === "open";
  let req = a.admin
    .from("bookings")
    .select(
      `id, customer_id, chef_id, status, location_type, grocery_option, is_free_trial, est_total_cents, currency, created_at, booking_days(visit_date, cooked_at), booking_flags${flagOpen ? "!inner" : ""}(reason, created_at, resolved_at)`,
    );
  if (flagOpen) req = req.is("booking_flags.resolved_at", null);
  if (q.values.status && q.values.status !== "all")
    req = req.eq("status", q.values.status);
  req = newestFirst(req, q);
  const res = await req
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1);
  if (res.error)
    throw new Error(`admin bookings read failed: ${res.error.message}`);
  const rows = (res.data ?? []) as unknown as Row[];
  const page = rows.slice(0, q.limit);

  const ids = page.map((r) => r.id as string);
  const open = new Map<string, number>();
  if (ids.length) {
    const rep = await a.admin
      .from("reports")
      .select("booking_id")
      .in("booking_id", ids)
      .in("status", ["open", "reviewing"]);
    if (rep.error) throw new Error("admin report count failed");
    for (const x of (rep.data ?? []) as Row[])
      open.set(
        x.booking_id as string,
        (open.get(x.booking_id as string) ?? 0) + 1,
      );
  }
  const nm = await names(
    a.admin,
    page.flatMap((r) => [r.customer_id as string, r.chef_id as string]),
  );
  const items = page.map((r): AdminBookingItem => {
    const days = ((r.booking_days ?? []) as Row[])
      .slice()
      .sort((x, y) => String(x.visit_date).localeCompare(String(y.visit_date)));
    const f = one(r.booking_flags);
    return {
      id: r.id as string,
      status: r.status as string,
      locationType: r.location_type as AdminBookingItem["locationType"],
      groceryOption: r.grocery_option as string,
      isFreeTrial: r.is_free_trial === true,
      createdAt: iso(r.created_at),
      firstDay: days.length ? (days[0].visit_date as string) : null,
      dates: days.map((d) => d.visit_date as string),
      totalCents: (r.est_total_cents as number | null) ?? 0,
      currency: r.currency as string,
      customer: person(nm, r.customer_id as string),
      chef: person(nm, r.chef_id as string),
      anyDayCooked: days.some((d) => d.cooked_at),
      flag: f
        ? {
            reason: f.reason as "chef_rejected" | "no_day_cooked",
            // The ORIGINAL creation time, also after an upgrade (T-064 INFO-1).
            flaggedAt: iso(f.created_at),
            resolvedAt: f.resolved_at ? iso(f.resolved_at) : null,
          }
        : null,
      openReportCount: open.get(r.id as string) ?? 0,
    };
  });
  return pageOf(rows, q.limit, items);
}

// ---------------------------------------------------------------------------
// GET /api/admin/reports
// ---------------------------------------------------------------------------
export const ADMIN_REPORT_STATUSES = [
  "active",
  "open",
  "reviewing",
  "resolved",
  "dismissed",
  "all",
] as const;

function mapDecision(r: Row): AdminDecision {
  return {
    kind: r.kind as AdminDecision["kind"],
    finalStatus: (r.final_status as FinalBookingStatus | null) ?? null,
    note: r.note as string,
    decidedAt: iso(r.created_at),
  };
}

export async function listAdminReports(
  a: AdminCaller,
  params: URLSearchParams,
): Promise<Page<AdminReportItem>> {
  const q = parseListParams(params, { status: ADMIN_REPORT_STATUSES });
  const status = q.values.status ?? "active";
  let req = a.admin
    .from("reports")
    .select(
      "id, booking_id, reporter_id, category, description, status, created_at, resolved_at",
    );
  if (status === "active") req = req.in("status", ["open", "reviewing"]);
  else if (status !== "all") req = req.eq("status", status);
  req = newestFirst(req, q);
  const res = await req
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1);
  if (res.error) throw new Error("admin reports read failed");
  const rows = (res.data ?? []) as Row[];
  const page = rows.slice(0, q.limit);

  const bookingIds = [...new Set(page.map((r) => r.booking_id as string))];
  const reportIds = page.map((r) => r.id as string);
  const bookings = new Map<string, Row>();
  const decisions = new Map<string, Row>();
  if (bookingIds.length) {
    const b = await a.admin
      .from("bookings")
      .select(
        "id, status, customer_id, chef_id, booking_days(visit_date, cooked_at), booking_flags(reason, resolved_at)",
      )
      .in("id", bookingIds);
    if (b.error) throw new Error("admin report bookings read failed");
    for (const x of (b.data ?? []) as unknown as Row[])
      bookings.set(x.id as string, x);
    const d = await a.admin
      .from("admin_decisions")
      .select("report_id, kind, final_status, note, created_at")
      .in("report_id", reportIds)
      .order("created_at", { ascending: false });
    if (d.error) throw new Error("admin decisions read failed");
    for (const x of (d.data ?? []) as Row[])
      if (!decisions.has(x.report_id as string))
        decisions.set(x.report_id as string, x);
  }
  const nm = await names(a.admin, [
    ...page.map((r) => r.reporter_id as string),
    ...[...bookings.values()].flatMap((x) => [
      x.customer_id as string,
      x.chef_id as string,
    ]),
  ]);
  const items = page.map((r): AdminReportItem => {
    const b = bookings.get(r.booking_id as string) ?? {};
    const days = ((b.booking_days ?? []) as Row[])
      .slice()
      .sort((x, y) => String(x.visit_date).localeCompare(String(y.visit_date)));
    const f = one(b.booking_flags);
    const dec = decisions.get(r.id as string);
    const reporter = r.reporter_id as string;
    return {
      id: r.id as string,
      bookingId: r.booking_id as string,
      category: r.category as AdminReportItem["category"],
      description: r.description as string,
      status: r.status as AdminReportItem["status"],
      createdAt: iso(r.created_at),
      resolvedAt: r.resolved_at ? iso(r.resolved_at) : null,
      reporter: {
        ...person(nm, reporter),
        role: (reporter === b.customer_id ? "customer" : "chef") as
          "customer" | "chef",
      },
      booking: {
        status: (b.status as string) ?? "unknown",
        firstDay: days.length ? (days[0].visit_date as string) : null,
        customer: person(nm, b.customer_id as string),
        chef: person(nm, b.chef_id as string),
        anyDayCooked: days.some((d) => d.cooked_at),
        // The same truth as booking_is_frozen: an open flag other than no_day_cooked.
        frozen: !!f && f.resolved_at === null && f.reason !== "no_day_cooked",
      },
      decision: dec ? mapDecision(dec) : null,
    };
  });
  return pageOf(rows, q.limit, items);
}

// ---------------------------------------------------------------------------
// GET /api/admin/free-trial-blocks
// ---------------------------------------------------------------------------
export async function listAdminFreeTrialBlocks(
  a: AdminCaller,
  params: URLSearchParams,
): Promise<Page<AdminFreeTrialBlock>> {
  const q = parseListParams(params);
  const res = await newestFirst(
    a.admin
      .from("free_trial_blocks")
      .select("id, customer_id, reason, attempts, created_at"),
    q,
  )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1);
  if (res.error) throw new Error("admin blocks read failed");
  const rows = (res.data ?? []) as Row[];
  const page = rows.slice(0, q.limit);
  const customers = [...new Set(page.map((r) => r.customer_id as string))];
  const nm = await names(a.admin, customers);
  const items = page.map((r): AdminFreeTrialBlock => ({
    id: r.id as string,
    customer: person(nm, r.customer_id as string),
    reason: r.reason as AdminFreeTrialBlock["reason"],
    createdAt: iso(r.created_at),
    // T-107: this row's own counter (one row per customer, rule and hour); createdAt is its first attempt.
    attempts: Number(r.attempts ?? 1),
  }));
  return pageOf(rows, q.limit, items);
}

// ---------------------------------------------------------------------------
// GET /api/admin/reviews
// ---------------------------------------------------------------------------
export async function listAdminReviews(
  a: AdminCaller,
  params: URLSearchParams,
): Promise<Page<AdminReviewItem>> {
  const q = parseListParams(params, { authorRole: ["customer", "chef"] });
  let req = a.admin
    .from("reviews")
    .select(
      "id, booking_id, author_id, subject_id, author_role, rating, comment, created_at",
    );
  if (q.values.authorRole) req = req.eq("author_role", q.values.authorRole);
  const res = await newestFirst(req, q)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1);
  if (res.error) throw new Error("admin reviews read failed");
  const rows = (res.data ?? []) as Row[];
  const page = rows.slice(0, q.limit);
  const nm = await names(
    a.admin,
    page.flatMap((r) => [r.author_id as string, r.subject_id as string]),
  );
  const items = page.map((r): AdminReviewItem => ({
    id: r.id as string,
    bookingId: r.booking_id as string,
    authorRole: r.author_role as AdminReviewItem["authorRole"],
    author: person(nm, r.author_id as string),
    subject: person(nm, r.subject_id as string),
    rating: r.rating as number,
    comment: (r.comment as string | null) ?? null,
    createdAt: iso(r.created_at),
  }));
  return pageOf(rows, q.limit, items);
}

// ---------------------------------------------------------------------------
// GET /api/admin/bookings/:id/messages (read only, every status; the 7C routes stay 403 for admins)
// ---------------------------------------------------------------------------
const bookingNotFound = () => new ApiFailure("NOT_FOUND", "Booking not found.");
const reportNotFound = () => new ApiFailure("NOT_FOUND", "Report not found.");

/** A booking id that is not a uuid, or names no booking, is a 404 (before any body check). */
export async function requireBookingExists(
  a: AdminCaller,
  id: string,
): Promise<void> {
  if (!isUuid(id)) throw bookingNotFound();
  const r = await a.admin
    .from("bookings")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (r.error) throw new Error("booking lookup failed");
  if (!r.data) throw bookingNotFound();
}
export async function requireReportExists(
  a: AdminCaller,
  id: string,
): Promise<void> {
  if (!isUuid(id)) throw reportNotFound();
  const r = await a.admin
    .from("reports")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (r.error) throw new Error("report lookup failed");
  if (!r.data) throw reportNotFound();
}

export async function listAdminMessages(
  a: AdminCaller,
  id: string,
  params: URLSearchParams,
): Promise<Page<AdminMessageView>> {
  if (!isUuid(id)) throw bookingNotFound();
  const q = parseListParams(params);
  const b = await a.admin
    .from("bookings")
    .select("id, customer_id, chef_id")
    .eq("id", id)
    .maybeSingle();
  if (b.error) throw new Error("booking lookup failed");
  if (!b.data) throw bookingNotFound();
  const bk = b.data as Row;
  let req = a.admin
    .from("messages")
    .select("id, booking_id, sender_id, client_id, body, created_at")
    .eq("booking_id", id);
  if (q.cursor)
    req = req.or(
      `created_at.gt."${q.cursor.c}",and(created_at.eq."${q.cursor.c}",id.gt.${q.cursor.i})`,
    );
  const res = await req
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(q.limit + 1);
  if (res.error) throw new Error("admin messages read failed");
  const rows = (res.data ?? []) as Row[];
  const page = rows.slice(0, q.limit);
  const nm = await names(a.admin, [
    bk.customer_id as string,
    bk.chef_id as string,
  ]);
  return pageOf(
    rows,
    q.limit,
    page.map((r): AdminMessageView => ({
      id: r.id as string,
      bookingId: r.booking_id as string,
      senderId: r.sender_id as string,
      senderRole: r.sender_id === bk.customer_id ? "customer" : "chef",
      senderName: nm.get(r.sender_id as string)?.displayName ?? "Unknown",
      clientId: (r.client_id as string | null) ?? null,
      body: r.body as string,
      createdAt: iso(r.created_at),
    })),
  );
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------
const REFUSALS: Record<string, string> = {
  already_decided: "This report was already decided.",
  final_status_required:
    "This booking is still open, so choose its final status (completed, cancelled, chef no-show or customer no-show).",
  status_not_open:
    "Only an accepted or completed booking can be given a final status. Close the report without a final status.",
  no_open_flag: "This booking has no open flag to resolve.",
};

export interface DecideInput {
  kind: "report_resolve" | "report_dismiss" | "flag_resolve";
  /** The report id (report decisions) or null. */
  reportId: string | null;
  /** The booking id (flag decisions) or null. */
  bookingId: string | null;
  finalStatus: FinalBookingStatus | null;
  note: string;
}

export async function decide(
  a: AdminCaller,
  input: DecideInput,
): Promise<AdminDecisionResponse> {
  const r = await a.admin.rpc("admin_decide_booking", {
    p_admin: a.userId,
    p_kind: input.kind,
    p_booking: input.bookingId,
    p_report: input.reportId,
    p_final: input.finalStatus,
    p_note: input.note,
  });
  if (r.error)
    throw new Error(`admin_decide_booking failed: ${r.error.message}`);
  const out = r.data as Row;
  if (out.result === "not_found")
    throw input.kind === "flag_resolve" ? bookingNotFound() : reportNotFound();
  if (out.result === "invalid_state") {
    const reason = String(out.reason);
    throw new ApiFailure(
      "INVALID_STATE",
      REFUSALS[reason] ?? "This cannot be decided now.",
      { reason },
    );
  }
  if (out.result !== "ok")
    throw new Error("admin_decide_booking: unexpected result");

  // The booking id comes back from the function (T-090), so no extra read of reports.
  const bookingId = out.booking_id;
  if (typeof bookingId !== "string")
    throw new Error("admin_decide_booking: no booking id");
  logDecision(a.userId, bookingId);

  const status = out.status as string;
  // Free trial (A-16, D-26, D-37) follows the saved status; after the save, like every other path.
  if (out.changed === true) {
    try {
      await applyFreeTrialEvent(bookingId, status as FreeTrialEvent, {
        db: a.admin,
        anyDayCooked: out.cooked === true,
        // T-048: a completed booking an admin cancels (or marks a chef no-show) releases its
        // consumed trial again unless a day was cooked.
        allowReopen: true,
      });
    } catch (e) {
      console.error(
        "free-trial: follow-up after admin decision failed:",
        e instanceof Error ? e.message : "unknown",
      );
    }
  }
  const claim = await a.admin
    .from("free_trial_claims")
    .select("state")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (claim.error) throw new Error("free_trial_claims lookup failed");
  const state = (claim.data as Row | null)?.state as
    "held" | "consumed" | "released" | undefined;

  return {
    reportId: input.reportId,
    booking: { id: bookingId, status },
    decision: {
      kind: out.kind as AdminDecision["kind"],
      finalStatus: input.finalStatus,
      note: input.note,
      decidedAt: iso(out.decided_at),
    },
    freeTrial: state ?? "none",
  };
}
