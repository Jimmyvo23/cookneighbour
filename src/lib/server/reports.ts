// Server side of the problem-report routes (T-048, contract section 7D).
//
// Jimmy, 2026-10-20: either party may report on a booking in any status. A report is seen by the
// admin and its reporter only: this module only ever returns the caller's OWN reports, and never a
// column that is not in ReportView (no admin note, no decision). The other party is never told.
// One open (open or reviewing) report per reporter per booking: the partial unique index
// reports_one_open_per_reporter decides, so a race or a direct insert cannot slip a second one in.
// Retry (T-075): reports.client_id is unique per reporter; the same content again returns the first
// report (200), different content with the same client id is 409 client_id_reused.
// The insert uses the service role AFTER the party check (loadPartyBooking read the booking with
// the caller's session and matched the caller's id), because client_id is not a browser column.
import "server-only";
import { ApiFailure, validationFailed } from "@/lib/api/errors";
import type { ReportList, ReportView } from "@/lib/api/types";
import { REPORT_REFUSALS, parseReportBody } from "@/lib/domain/reviews";
import type { BookingCaller } from "@/lib/server/bookings";
import { loadPartyBooking } from "@/lib/server/booking-party";

type Row = Record<string, unknown>;

const COLS =
  "id, booking_id, category, description, status, created_at, resolved_at";

function view(r: Row): ReportView {
  return {
    id: r.id as string,
    bookingId: r.booking_id as string,
    category: r.category as ReportView["category"],
    description: r.description as string,
    status: r.status as ReportView["status"],
    createdAt: new Date(r.created_at as string).toISOString(),
    resolvedAt: r.resolved_at
      ? new Date(r.resolved_at as string).toISOString()
      : null,
  };
}

const refusal = (reason: keyof typeof REPORT_REFUSALS) =>
  new ApiFailure("INVALID_STATE", REPORT_REFUSALS[reason], { reason });

// GET /api/bookings/:id/reports: the caller's own reports on this booking.
export async function listOwnReports(
  caller: BookingCaller,
  id: string,
): Promise<ReportList> {
  const b = await loadPartyBooking(caller, id);
  const r = await caller.supabase
    .from("reports")
    .select(COLS)
    .eq("booking_id", b.id)
    .eq("reporter_id", caller.userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (r.error) throw new Error("reports read failed");
  return { items: ((r.data ?? []) as Row[]).map(view) };
}

// POST /api/bookings/:id/reports
export async function createReport(
  caller: BookingCaller,
  id: string,
  readBody: () => Promise<Record<string, unknown>>,
): Promise<{ report: ReportView; duplicate: boolean }> {
  const b = await loadPartyBooking(caller, id);
  const parsed = parseReportBody(await readBody());
  if (!parsed.ok) throw validationFailed(parsed.fields);

  const findByClientId = async (): Promise<Row | null> => {
    const r = await caller.admin
      .from("reports")
      .select(COLS)
      .eq("reporter_id", caller.userId)
      .eq("client_id", parsed.clientId)
      .maybeSingle();
    if (r.error) throw new Error("report lookup failed");
    return (r.data as Row | null) ?? null;
  };
  // The same client id is a retry when the content is identical, a mistake otherwise.
  const judge = (row: Row) => {
    if (
      row.booking_id === b.id &&
      row.category === parsed.category &&
      row.description === parsed.description
    )
      return { report: view(row), duplicate: true };
    throw refusal("client_id_reused");
  };

  const before = await findByClientId();
  if (before) return judge(before);

  const ins = await caller.admin
    .from("reports")
    .insert({
      booking_id: b.id,
      reporter_id: caller.userId,
      category: parsed.category,
      description: parsed.description,
      client_id: parsed.clientId,
    })
    .select(COLS)
    .single();
  if (ins.error) {
    if (ins.error.code === "23505") {
      // A parallel retry of the same report, or the one-open-report rule.
      const now = await findByClientId();
      if (now) return judge(now);
      throw refusal("report_open");
    }
    throw new Error(`report insert failed: ${ins.error.code}`);
  }
  return { report: view(ins.data as Row), duplicate: false };
}
