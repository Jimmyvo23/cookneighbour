// T-048: the admin lists and decisions through the real routes (contract 7D). LOCAL Supabase (CI).
// D-54 (the admin picks the final status), D-57 (a no_day_cooked flag is decided the same way),
// D-67 (a decision unfreezes), the free trial following the status, and what nobody else may see.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as sendRoute } from "@/app/api/bookings/[id]/messages/route";
import {
  BOOKING_DECIDED_TITLE,
  bookingDecidedBody,
} from "@/lib/domain/reviews";
import { Browser, freshLimits, type Reply } from "./harness";
import {
  accept,
  cancel,
  bookingCustomer,
  claimOf,
  complete,
  cooked,
  decline,
  getBooking,
  notesFor,
  shiftDays,
  bookingRow,
} from "./booking-helpers";
import { newAdmin, newChef } from "./chef-helpers";
import { rejectOf } from "./admin-helpers";
import {
  acceptedBooking,
  adminBlocks,
  adminBookings,
  adminMessages,
  adminReports,
  adminReviews,
  allKeys,
  completedBooking,
  dismissReport,
  getReports,
  getReviews,
  postReport,
  postReview,
  reportBody,
  requestedBooking,
  resolveFlag,
  resolveReport,
  svc,
  type Fixture,
} from "./engagement-helpers";

beforeEach(() => freshLimits());

const NOTE = "Checked with both sides, all fine.";
const unknown = "00000000-0000-4000-8000-000000000000";

async function report(f: Fixture, by: "cust" | "chef" = "cust") {
  const r = await postReport(f[by].b, f.id, reportBody());
  expect(r.status, r.text).toBe(201);
  return r.body.id as string;
}
async function rejectChef(chefId: string) {
  const admin = await newAdmin();
  const r = await admin.b.call(rejectOf(chefId), {
    body: { reason: "Documents did not pass." },
  });
  expect(r.status, r.text).toBe(200);
}
const send = (b: Browser, id: string, text: string): Promise<Reply> =>
  b.call((r) => sendRoute(r, { params: Promise.resolve({ id }) }), {
    body: { clientId: randomUUID(), body: text },
  });

// ---------------------------------------------------------------------------
describe("access: every admin route is admin only", () => {
  it("anon 401, customer 403, chef 403, for every route and also for ids that do not exist", async () => {
    const f = await acceptedBooking();
    const rep = await report(f);
    const customer = await bookingCustomer();
    const chef = await newChef("Not an admin");
    const anon = new Browser();
    const admin = await newAdmin();
    const calls: [string, (b: Browser) => Promise<Reply>][] = [
      ["bookings", (b) => adminBookings(b)],
      ["reports", (b) => adminReports(b)],
      ["blocks", (b) => adminBlocks(b)],
      ["reviews", (b) => adminReviews(b)],
      ["messages", (b) => adminMessages(b, f.id)],
      ["messages unknown", (b) => adminMessages(b, unknown)],
      ["resolve", (b) => resolveReport(b, rep, { note: NOTE })],
      ["resolve unknown", (b) => resolveReport(b, unknown, { note: NOTE })],
      ["dismiss", (b) => dismissReport(b, rep, { note: NOTE })],
      [
        "resolve-flag",
        (b) => resolveFlag(b, f.id, { finalStatus: "cancelled", note: NOTE }),
      ],
      [
        "resolve-flag unknown",
        (b) =>
          resolveFlag(b, unknown, { finalStatus: "cancelled", note: NOTE }),
      ],
    ];
    for (const [name, call] of calls) {
      expect((await call(anon)).status, `${name} anon`).toBe(401);
      expect((await call(customer.b)).status, `${name} customer`).toBe(403);
      expect((await call(f.cust.b)).status, `${name} booking customer`).toBe(
        403,
      );
      expect((await call(chef.b)).status, `${name} chef`).toBe(403);
      expect((await call(f.chef.b)).status, `${name} booking chef`).toBe(403);
    }
    // Nothing was decided by any of those calls.
    expect((await bookingRow(f.id)).status).toBe("accepted");
    const r = await svc.from("reports").select("status").eq("id", rep).single();
    expect(r.data?.status).toBe("open");
    // The admin gets the 404 for ids that do not exist.
    expect((await adminMessages(admin.b, unknown)).status).toBe(404);
    expect((await resolveReport(admin.b, unknown, { note: NOTE })).status).toBe(
      404,
    );
    expect(
      (await dismissReport(admin.b, "not-a-uuid", { note: NOTE })).status,
    ).toBe(404);
    expect(
      (
        await resolveFlag(admin.b, unknown, {
          finalStatus: "cancelled",
          note: NOTE,
        })
      ).status,
    ).toBe(404);
  });

  it("the chat message routes stay 403 for the admin (the admin reads through its own route)", async () => {
    const f = await acceptedBooking();
    const admin = await newAdmin();
    const r = await send(admin.b, f.id, "hello from admin");
    expect(r.status).toBe(403);
  });

  it("content type is 400 on the decision routes, and the report is checked before the body", async () => {
    const f = await acceptedBooking();
    const rep = await report(f);
    const admin = await newAdmin();
    expect(
      (
        await resolveReport(
          admin.b,
          rep,
          { note: NOTE },
          { contentType: "text/plain" },
        )
      ).status,
    ).toBe(400);
    expect(
      (await resolveFlag(admin.b, f.id, { note: NOTE }, { contentType: null }))
        .status,
    ).toBe(400);
    // unknown report with an invalid body is still 404
    expect(
      (await resolveReport(admin.b, unknown, { nonsense: true })).status,
    ).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("D-54: resolving a report", () => {
  it("an accepted booking needs a final status; without one nothing changes", async () => {
    const f = await acceptedBooking({ trial: true });
    const rep = await report(f);
    const admin = await newAdmin();
    const r = await resolveReport(admin.b, rep, { note: NOTE });
    expect(r.status, r.text).toBe(409);
    expect(r.body.error).toMatchObject({
      code: "INVALID_STATE",
      reason: "final_status_required",
    });
    expect((await bookingRow(f.id)).status).toBe("accepted");
    expect((await claimOf(f.id))?.state).toBe("held");
    const list = await adminReports(admin.b, "status=open&limit=50");
    expect(
      list.body.items.find((x: { id: string }) => x.id === rep),
    ).toBeTruthy();
  });

  it("completed: consumes the free trial, opens reviews, tells both parties neutrally", async () => {
    const f = await acceptedBooking({ trial: true });
    const rep = await report(f);
    const admin = await newAdmin();
    const r = await resolveReport(admin.b, rep, {
      finalStatus: "completed",
      note: NOTE,
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({
      reportId: rep,
      booking: { id: f.id, status: "completed" },
      decision: {
        kind: "report_resolved",
        finalStatus: "completed",
        note: NOTE,
      },
      freeTrial: "consumed",
    });
    expect((await claimOf(f.id))?.state).toBe("consumed");
    const row = await bookingRow(f.id);
    expect(row.status).toBe("completed");
    expect(row.completed_at).toBeTruthy();
    // Reviews open from now.
    const g = await getReviews(f.cust.b, f.id);
    expect(g.body.allowance.allowed).toBe(true);
    expect((await postReview(f.cust.b, f.id, { rating: 5 })).status).toBe(201);
    // Both parties got the same neutral notice, and nothing about a report.
    for (const who of [f.cust, f.chef]) {
      const notes = await notesFor(who.id, "booking_decided");
      expect(notes).toEqual([
        {
          type: "booking_decided",
          title: BOOKING_DECIDED_TITLE,
          body: bookingDecidedBody("completed"),
          booking_id: f.id,
        },
      ]);
    }
    // The report is resolved for its reporter.
    const mine = await getReports(f.cust.b, f.id);
    expect(mine.body.items[0]).toMatchObject({ id: rep, status: "resolved" });
  });

  it.each([
    ["cancelled", false, "released"],
    ["cancelled", true, "consumed"],
    ["no_show_customer", false, "consumed"],
    ["no_show_customer", true, "consumed"],
    ["no_show_chef", false, "released"],
    ["no_show_chef", true, "consumed"],
    ["completed", true, "consumed"],
  ] as const)(
    "%s (a day was cooked: %s) leaves the free trial %s",
    async (finalStatus, anyCooked, trial) => {
      const f = await acceptedBooking({ trial: true });
      if (anyCooked) {
        await shiftDays(f.id, 3);
        expect((await cooked(f.chef.b, f.id, 1)).status).toBe(200);
      }
      const rep = await report(f);
      const admin = await newAdmin();
      const r = await resolveReport(admin.b, rep, { finalStatus, note: NOTE });
      expect(r.status, r.text).toBe(200);
      expect(r.body.booking.status).toBe(finalStatus);
      expect(r.body.freeTrial).toBe(trial);
      expect((await claimOf(f.id))?.state).toBe(trial);
      const row = await bookingRow(f.id);
      expect(row.status).toBe(finalStatus);
      if (finalStatus === "cancelled") {
        // Cancelled by the system; the admin's note is not the cancel reason.
        expect(row.cancelled_by).toBeNull();
        expect(row.cancel_reason).toBeNull();
        expect(row.cancelled_at).toBeTruthy();
      }
      if (finalStatus.startsWith("no_show")) {
        expect(row.no_show_reported_at).toBeTruthy();
        const d = await getBooking(f.cust.b, f.id);
        expect(d.body.noShow).toMatchObject({ dayNumber: 1 });
      }
    },
  );

  it("a cancelled booking frees the chef's dates", async () => {
    const f = await acceptedBooking();
    const rep = await report(f);
    const admin = await newAdmin();
    expect(
      (
        await resolveReport(admin.b, rep, {
          finalStatus: "cancelled",
          note: NOTE,
        })
      ).status,
    ).toBe(200);
    const days = await svc
      .from("booking_days")
      .select("is_active")
      .eq("booking_id", f.id);
    expect(days.data?.every((d) => d.is_active === false)).toBe(true);
  });

  it("a booking that is neither accepted nor completed keeps its status: a final status is refused, closing without one works", async () => {
    const f = await completedBooking({ trial: true });
    const rep = await report(f, "chef");
    const admin = await newAdmin();
    // T-048: a completed booking now accepts a final status; "completed" means leave it.
    const same = await resolveReport(admin.b, rep, {
      finalStatus: "completed",
      note: NOTE,
    });
    expect(same.status, same.text).toBe(200);
    expect(same.body.booking.status).toBe("completed");
    expect((await bookingRow(f.id)).status).toBe("completed");
    expect((await claimOf(f.id))?.state).toBe("consumed");
    const g = await completedBooking({ trial: true });
    const rep2 = await report(g, "chef");
    const ok = await resolveReport(admin.b, rep2, { note: NOTE });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.booking.status).toBe("completed");
    expect((await bookingRow(g.id)).status).toBe("completed");
    expect((await claimOf(g.id))?.state).toBe("consumed");
    // Leaving a completed booking as it is sends no booking notice.
    for (const x of [f, g])
      for (const who of [x.cust, x.chef])
        expect((await notesFor(who.id, "booking_decided")).length).toBe(0);
    // A requested booking behaves the same.
    const rq = await requestedBooking();
    const rq1 = await report(rq);
    const r2 = await resolveReport(admin.b, rq1, {
      finalStatus: "completed",
      note: NOTE,
    });
    expect(r2.body.error.reason).toBe("status_not_open");
    expect((await resolveReport(admin.b, rq1, { note: NOTE })).status).toBe(
      200,
    );
    expect((await bookingRow(rq.id)).status).toBe("requested");
  });

  it("a report that was decided cannot be decided again; two decisions at once, exactly one wins", async () => {
    const f = await acceptedBooking();
    const rep = await report(f);
    // One browser (cookie jar) for both calls: the test harness keeps one "current jar" at a time.
    const a1 = await newAdmin();
    const both = await Promise.all([
      resolveReport(a1.b, rep, {
        finalStatus: "cancelled",
        note: "First admin decision.",
      }),
      resolveReport(a1.b, rep, {
        finalStatus: "completed",
        note: "Second admin decision.",
      }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = both.find((r) => r.status === 409)!;
    expect(loser.body.error.reason).toBe("already_decided");
    const winner = both.find((r) => r.status === 200)!;
    expect((await bookingRow(f.id)).status).toBe(winner.body.booking.status);
    const audit = await svc
      .from("admin_decisions")
      .select("id")
      .eq("report_id", rep);
    expect(audit.data?.length).toBe(1);
    // Sequential repeat.
    const again = await resolveReport(a1.b, rep, {
      finalStatus: "completed",
      note: NOTE,
    });
    expect(again.body.error.reason).toBe("already_decided");
    const dismissed = await dismissReport(a1.b, rep, { note: NOTE });
    expect(dismissed.body.error.reason).toBe("already_decided");
  });

  it("the note and the decision stay with the admin: never in a party's reads", async () => {
    const f = await acceptedBooking();
    const rep = await report(f);
    const admin = await newAdmin();
    const secret = `SECRET-NOTE-${randomUUID()}`;
    const r = await resolveReport(admin.b, rep, {
      finalStatus: "no_show_chef",
      note: secret,
    });
    expect(r.status, r.text).toBe(200);
    const reads = [
      await getBooking(f.cust.b, f.id),
      await getBooking(f.chef.b, f.id),
      await getReports(f.cust.b, f.id),
      await getReports(f.chef.b, f.id),
      await getReviews(f.cust.b, f.id),
    ];
    for (const read of reads) expect(read.text).not.toContain(secret);
    for (const who of [f.cust, f.chef])
      for (const n of await notesFor(who.id))
        expect(`${n.title} ${n.body}`).not.toContain(secret);
    // The reporter's view of the report has no decision fields.
    const keys = allKeys((await getReports(f.cust.b, f.id)).body);
    for (const k of [
      "note",
      "adminNote",
      "finalStatus",
      "decision",
      "decidedAt",
    ])
      expect(keys.has(k)).toBe(false);
    // The audit row has it, with the admin who decided.
    const audit = await svc
      .from("admin_decisions")
      .select("kind, admin_id, final_status, note, booking_id, report_id")
      .eq("report_id", rep)
      .single();
    expect(audit.data).toMatchObject({
      kind: "report_resolved",
      admin_id: admin.id,
      final_status: "no_show_chef",
      note: secret,
      booking_id: f.id,
    });
    // Only the admin list shows the decision.
    const list = await adminReports(admin.b, "status=resolved&limit=50");
    const item = list.body.items.find((x: { id: string }) => x.id === rep);
    expect(item.decision).toMatchObject({
      kind: "report_resolved",
      finalStatus: "no_show_chef",
      note: secret,
    });
  });

  it("validation: note 3 to 500 safe characters, finalStatus one of the four, unknown keys; nothing changes", async () => {
    const f = await acceptedBooking();
    const rep = await report(f);
    const admin = await newAdmin();
    for (const [body, field] of [
      [{ finalStatus: "cancelled" }, "note"],
      [{ finalStatus: "cancelled", note: "ab" }, "note"],
      [{ finalStatus: "cancelled", note: "x".repeat(501) }, "note"],
      [{ finalStatus: "cancelled", note: "bad\u0000note" }, "note"],
      [{ finalStatus: "accepted", note: NOTE }, "finalStatus"],
      [{ finalStatus: "expired", note: NOTE }, "finalStatus"],
      [{ finalStatus: "declined", note: NOTE }, "finalStatus"],
      [{ finalStatus: 5, note: NOTE }, "finalStatus"],
      [{ finalStatus: "cancelled", note: NOTE, status: "completed" }, "status"],
    ] as [Record<string, unknown>, string][]) {
      const r = await resolveReport(admin.b, rep, body);
      expect(r.status, `${field}: ${r.text}`).toBe(422);
      expect(r.body.error.fields[field]).toBeTruthy();
    }
    expect((await bookingRow(f.id)).status).toBe("accepted");
    const ok = await resolveReport(admin.b, rep, {
      finalStatus: "cancelled",
      note: "x".repeat(500),
    });
    expect(ok.status, ok.text).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("dismissing a report", () => {
  it("closes the report and changes nothing else; the chef could finish the visit before and after", async () => {
    const f = await acceptedBooking({ trial: true });
    const rep = await report(f);
    const admin = await newAdmin();
    const d = await dismissReport(admin.b, rep, { note: "No action needed." });
    expect(d.status, d.text).toBe(200);
    expect(d.body).toMatchObject({
      reportId: rep,
      booking: { id: f.id, status: "accepted" },
      decision: { kind: "report_dismissed", finalStatus: null },
      freeTrial: "held",
    });
    expect((await bookingRow(f.id)).status).toBe("accepted");
    expect((await notesFor(f.cust.id, "booking_decided")).length).toBe(0);
    expect((await notesFor(f.chef.id, "booking_decided")).length).toBe(0);
    await shiftDays(f.id, 3);
    expect((await cooked(f.chef.b, f.id, 1)).status).toBe(200);
    const done = await complete(f.chef.b, f.id);
    expect(done.status, done.text).toBe(200);
  });

  it("T-048: with the report still open the chef finishes the visit; dismissing it afterwards leaves the completed booking and its consumed trial", async () => {
    const f = await acceptedBooking({ trial: true });
    await shiftDays(f.id, 3);
    expect((await cooked(f.chef.b, f.id, 1)).status).toBe(200);
    const rep = await report(f);
    const done = await complete(f.chef.b, f.id);
    expect(done.status, done.text).toBe(200);
    const admin = await newAdmin();
    const d = await dismissReport(admin.b, rep, { note: "No action needed." });
    expect(d.status, d.text).toBe(200);
    expect(d.body).toMatchObject({
      booking: { id: f.id, status: "completed" },
      freeTrial: "consumed",
    });
    expect((await bookingRow(f.id)).status).toBe("completed");
    expect((await notesFor(f.chef.id, "booking_decided")).length).toBe(0);
  });

  it("does not accept a final status", async () => {
    const f = await acceptedBooking();
    const rep = await report(f);
    const admin = await newAdmin();
    const r = await dismissReport(admin.b, rep, {
      note: NOTE,
      finalStatus: "cancelled",
    });
    expect(r.status, r.text).toBe(422);
    expect(r.body.error.fields.finalStatus).toBeTruthy();
    expect((await bookingRow(f.id)).status).toBe("accepted");
  });

  it("does not touch a flag: a frozen booking stays frozen", async () => {
    const f = await acceptedBooking();
    await rejectChef(f.chef.id);
    const rep = await report(f);
    const admin = await newAdmin();
    expect((await dismissReport(admin.b, rep, { note: NOTE })).status).toBe(
      200,
    );
    expect((await getBooking(f.cust.b, f.id)).body.frozen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("D-57 and D-67: deciding a flagged booking unfreezes it", () => {
  it("a chef_rejected flag: the admin picks the status, the booking is no longer frozen, the trial follows", async () => {
    const f = await acceptedBooking({ trial: true });
    await rejectChef(f.chef.id);
    expect((await getBooking(f.cust.b, f.id)).body.frozen).toBe(true);
    const admin = await newAdmin();
    const list = await adminBookings(admin.b, "flag=open&limit=50");
    expect(list.status, list.text).toBe(200);
    const item = list.body.items.find((x: { id: string }) => x.id === f.id);
    expect(item.flag).toMatchObject({
      reason: "chef_rejected",
      resolvedAt: null,
    });
    const r = await resolveFlag(admin.b, f.id, {
      finalStatus: "cancelled",
      note: NOTE,
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({
      reportId: null,
      booking: { id: f.id, status: "cancelled" },
      decision: { kind: "flag_resolved", finalStatus: "cancelled" },
      freeTrial: "released",
    });
    const after = await getBooking(f.cust.b, f.id);
    expect(after.body).toMatchObject({ status: "cancelled", frozen: false });
    const flag = await svc
      .from("booking_flags")
      .select("resolved_at")
      .eq("booking_id", f.id)
      .single();
    expect(flag.data?.resolved_at).toBeTruthy();
    // The open-flag filter no longer lists it; the unfiltered list shows the resolved flag.
    const open = await adminBookings(admin.b, "flag=open&limit=50");
    expect(open.body.items.some((x: { id: string }) => x.id === f.id)).toBe(
      false,
    );
    const all = await adminBookings(admin.b, "status=cancelled&limit=50");
    const again = all.body.items.find((x: { id: string }) => x.id === f.id);
    expect(again.flag.resolvedAt).toBeTruthy();
    // Deciding again: no open flag, and the booking is no longer open.
    const second = await resolveFlag(admin.b, f.id, {
      finalStatus: "completed",
      note: NOTE,
    });
    expect(second.status).toBe(409);
    expect(second.body.error.reason).toBe("no_open_flag");
  });

  it("a no_day_cooked flag (D-36): the admin picks the status; no cooked day releases the trial on a no-show by the chef", async () => {
    const f = await acceptedBooking({ trial: true });
    await shiftDays(f.id, 5);
    // The read runs the lazy sweep, which flags the booking (nothing was cooked).
    expect((await getBooking(f.cust.b, f.id)).body.status).toBe("accepted");
    const flag = await svc
      .from("booking_flags")
      .select("reason, resolved_at")
      .eq("booking_id", f.id)
      .single();
    expect(flag.data).toMatchObject({
      reason: "no_day_cooked",
      resolved_at: null,
    });
    const admin = await newAdmin();
    const r = await resolveFlag(admin.b, f.id, {
      finalStatus: "no_show_chef",
      note: NOTE,
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.booking.status).toBe("no_show_chef");
    expect(r.body.freeTrial).toBe("released");
    expect((await claimOf(f.id))?.state).toBe("released");
    const after = await svc
      .from("booking_flags")
      .select("resolved_at")
      .eq("booking_id", f.id)
      .single();
    expect(after.data?.resolved_at).toBeTruthy();
  });

  it("a flagged booking needs a final status; a booking with no open flag, or one that is not accepted, is refused", async () => {
    const f = await acceptedBooking();
    await rejectChef(f.chef.id);
    const admin = await newAdmin();
    const missing = await resolveFlag(admin.b, f.id, { note: NOTE });
    expect(missing.status).toBe(422);
    expect(missing.body.error.fields.finalStatus).toBeTruthy();
    expect((await getBooking(f.cust.b, f.id)).body.frozen).toBe(true);
    const clean = await acceptedBooking();
    const none = await resolveFlag(admin.b, clean.id, {
      finalStatus: "completed",
      note: NOTE,
    });
    expect(none.status).toBe(409);
    expect(none.body.error.reason).toBe("no_open_flag");
    expect((await bookingRow(clean.id)).status).toBe("accepted");
  });

  it("a final status also resolves the flag when a report is resolved on a frozen booking", async () => {
    const f = await acceptedBooking();
    await rejectChef(f.chef.id);
    const rep = await report(f);
    const admin = await newAdmin();
    const r = await resolveReport(admin.b, rep, {
      finalStatus: "completed",
      note: NOTE,
    });
    expect(r.status, r.text).toBe(200);
    const after = await getBooking(f.cust.b, f.id);
    expect(after.body).toMatchObject({ status: "completed", frozen: false });
  });
});

// ---------------------------------------------------------------------------
describe("the admin lists", () => {
  it("bookings: status filter, flag filter, report count, names and no private data", async () => {
    const a = await acceptedBooking({ trial: true });
    const d = await requestedBooking();
    expect((await decline(d.chef.b, d.id)).status).toBe(200);
    await report(a);
    await report(a, "chef");
    const admin = await newAdmin();
    const list = await adminBookings(admin.b, "limit=50");
    expect(list.status, list.text).toBe(200);
    const item = list.body.items.find((x: { id: string }) => x.id === a.id);
    expect(item).toMatchObject({
      id: a.id,
      status: "accepted",
      isFreeTrial: true,
      flag: null,
      openReportCount: 2,
      anyDayCooked: false,
      customer: { id: a.cust.id },
      chef: { id: a.chef.id },
    });
    expect(item.dates.length).toBe(1);
    expect(item.firstDay).toBe(item.dates[0]);
    expect(typeof item.customer.displayName).toBe("string");
    const keys = allKeys(list.body);
    for (const k of [
      "phone",
      "phoneE164",
      "phone_e164",
      "email",
      "phoneHash",
      "addressHash",
      "address",
      "line",
      "postalCode",
      "hash",
    ])
      expect(keys.has(k), k).toBe(false);
    const declined = await adminBookings(admin.b, "status=declined&limit=50");
    const ids = declined.body.items.map((x: { id: string }) => x.id);
    expect(ids).toContain(d.id);
    expect(ids).not.toContain(a.id);
    expect(
      declined.body.items.every(
        (x: { status: string }) => x.status === "declined",
      ),
    ).toBe(true);
  });

  it("an upgraded flag shows its original time (T-064 INFO-1) and reason chef_rejected", async () => {
    const f = await acceptedBooking();
    await shiftDays(f.id, 5);
    await getBooking(f.cust.b, f.id); // sweep: no_day_cooked flag
    const first = await svc
      .from("booking_flags")
      .select("created_at")
      .eq("booking_id", f.id)
      .single();
    await rejectChef(f.chef.id); // upgrades the flag to chef_rejected
    const admin = await newAdmin();
    const list = await adminBookings(admin.b, "flag=open&limit=50");
    const item = list.body.items.find((x: { id: string }) => x.id === f.id);
    expect(item.flag.reason).toBe("chef_rejected");
    expect(new Date(item.flag.flaggedAt).getTime()).toBe(
      new Date(first.data?.created_at as string).getTime(),
    );
  });

  it("reports: default active, status filters, newest first, paging with no repeats", async () => {
    const admin = await newAdmin();
    const f1 = await acceptedBooking();
    const f2 = await acceptedBooking();
    const f3 = await acceptedBooking();
    const r1 = await report(f1);
    const r2 = await report(f2);
    const r3 = await report(f3);
    await dismissReport(admin.b, r2, { note: NOTE });
    const active = await adminReports(admin.b, "limit=50");
    const ids = active.body.items.map((x: { id: string }) => x.id);
    expect(ids).toContain(r1);
    expect(ids).toContain(r3);
    expect(ids).not.toContain(r2);
    const dismissed = await adminReports(admin.b, "status=dismissed&limit=50");
    expect(dismissed.body.items.map((x: { id: string }) => x.id)).toContain(r2);
    const item = dismissed.body.items.find((x: { id: string }) => x.id === r2);
    expect(item.decision).toMatchObject({
      kind: "report_dismissed",
      finalStatus: null,
    });
    expect(item.booking).toMatchObject({ status: "accepted", frozen: false });
    const times = active.body.items.map(
      (x: { createdAt: string }) => x.createdAt,
    );
    expect(times).toEqual([...times].sort().reverse());
    // Paging by one: every page has one item, no id repeats, the cursor walks on.
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 3; i++) {
      const p: Reply = await adminReports(
        admin.b,
        `status=all&limit=1${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(p.status, p.text).toBe(200);
      expect(p.body.items.length).toBe(1);
      seen.push(p.body.items[0].id);
      cursor = p.body.nextCursor;
      expect(cursor).toBeTruthy();
    }
    expect(new Set(seen).size).toBe(3);
    for (const qs of [
      "status=nope",
      "limit=0",
      "limit=51",
      "cursor=x",
      "foo=1",
      "status=open&status=all",
    ]) {
      expect((await adminReports(admin.b, qs)).status, qs).toBe(422);
    }
  });

  it("free-trial blocks: the real reason and how often it happened", async () => {
    const admin = await newAdmin();
    const c = await bookingCustomer();
    const other = await bookingCustomer();
    const ins = await svc
      .from("free_trial_blocks")
      .insert([
        { customer_id: c.id, reason: "phone" },
        { customer_id: c.id, reason: "phone" },
        { customer_id: c.id, reason: "address" },
        { customer_id: other.id, reason: "customer" },
      ])
      .select("id, reason, customer_id");
    expect(ins.error).toBeNull();
    const list = await adminBlocks(admin.b, "limit=50");
    expect(list.status, list.text).toBe(200);
    const mine = list.body.items.filter(
      (x: { customer: { id: string } }) => x.customer.id === c.id,
    );
    expect(mine.length).toBe(3);
    expect(
      mine
        .filter((x: { reason: string }) => x.reason === "phone")
        .every((x: { attempts: number }) => x.attempts === 2),
    ).toBe(true);
    expect(
      mine.find((x: { reason: string }) => x.reason === "address").attempts,
    ).toBe(1);
    const theirs = list.body.items.find(
      (x: { customer: { id: string } }) => x.customer.id === other.id,
    );
    expect(theirs).toMatchObject({ reason: "customer", attempts: 1 });
    expect(Object.keys(theirs).sort()).toEqual([
      "attempts",
      "createdAt",
      "customer",
      "id",
      "reason",
    ]);
    expect((await adminBlocks(admin.b, "limit=0")).status).toBe(422);
  });

  it("admin chat read: oldest first, with the sender's role, for any status, and paged", async () => {
    const f = await acceptedBooking();
    expect((await send(f.cust.b, f.id, "First from customer")).status).toBe(
      201,
    );
    expect((await send(f.chef.b, f.id, "Second from chef")).status).toBe(201);
    expect((await send(f.cust.b, f.id, "Third from customer")).status).toBe(
      201,
    );
    const admin = await newAdmin();
    const r = await adminMessages(admin.b, f.id);
    expect(r.status, r.text).toBe(200);
    expect(r.body.items.map((m: { body: string }) => m.body)).toEqual([
      "First from customer",
      "Second from chef",
      "Third from customer",
    ]);
    expect(
      r.body.items.map((m: { senderRole: string }) => m.senderRole),
    ).toEqual(["customer", "chef", "customer"]);
    expect(r.body.items[0]).toMatchObject({
      senderId: f.cust.id,
      bookingId: f.id,
    });
    expect(typeof r.body.items[0].senderName).toBe("string");
    const p1 = await adminMessages(admin.b, f.id, "limit=2");
    expect(p1.body.items.length).toBe(2);
    const p2 = await adminMessages(
      admin.b,
      f.id,
      `limit=2&cursor=${p1.body.nextCursor}`,
    );
    expect(p2.body.items.map((m: { body: string }) => m.body)).toEqual([
      "Third from customer",
    ]);
    expect(p2.body.nextCursor).toBeNull();
    // A cancelled booking's chat is hidden from the parties but not from the admin.
    const { POST: cancelRoute } =
      await import("@/app/api/bookings/[id]/cancel/route");
    const c = await f.cust.b.call(
      (rq) => cancelRoute(rq, { params: Promise.resolve({ id: f.id }) }),
      {
        body: { reason: "My plans changed." },
      },
    );
    expect(c.status, c.text).toBe(200);
    expect((await send(f.cust.b, f.id, "after")).status).toBe(409);
    const still = await adminMessages(admin.b, f.id);
    expect(still.body.items.length).toBe(3);
    expect((await adminMessages(admin.b, f.id, "limit=100")).status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
describe("completing through the party route is unchanged by T-048", () => {
  it("a completed booking can be reviewed and a resolved report does not re-open it", async () => {
    const f = await completedBooking();
    const rep = await report(f);
    const admin = await newAdmin();
    expect((await resolveReport(admin.b, rep, { note: NOTE })).status).toBe(
      200,
    );
    expect((await postReview(f.cust.b, f.id, { rating: 5 })).status).toBe(201);
    expect((await bookingRow(f.id)).status).toBe("completed");
  });

  it("accept still works after a report on a requested booking was closed", async () => {
    const f = await requestedBooking();
    const rep = await report(f);
    const admin = await newAdmin();
    expect((await dismissReport(admin.b, rep, { note: NOTE })).status).toBe(
      200,
    );
    expect((await accept(f.chef.b, f.id)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// T-048 fix round (Jimmy, 2026-10-20)
// ---------------------------------------------------------------------------
describe("fix round: the admin may give a completed booking a final status", () => {
  async function wipeCooked(id: string) {
    const up = await svc
      .from("booking_days")
      .update({ cooked_at: null })
      .eq("booking_id", id);
    expect(up.error).toBeNull();
  }

  it.each([
    ["cancelled", "consumed"],
    ["no_show_chef", "consumed"],
    ["no_show_customer", "consumed"],
  ] as const)(
    "completed to %s with a cooked day: the trial stays %s; both parties get the neutral notice; reviews already written stay",
    async (finalStatus, trial) => {
      const f = await completedBooking({ trial: true });
      expect((await postReview(f.cust.b, f.id, { rating: 4 })).status).toBe(
        201,
      );
      const rep = await report(f, "chef");
      const admin = await newAdmin();
      const r = await resolveReport(admin.b, rep, { finalStatus, note: NOTE });
      expect(r.status, r.text).toBe(200);
      expect(r.body.booking.status).toBe(finalStatus);
      expect(r.body.freeTrial).toBe(trial);
      expect((await bookingRow(f.id)).status).toBe(finalStatus);
      expect((await claimOf(f.id))?.state).toBe(trial);
      for (const who of [f.cust, f.chef])
        expect(await notesFor(who.id, "booking_decided")).toEqual([
          {
            type: "booking_decided",
            title: BOOKING_DECIDED_TITLE,
            body: bookingDecidedBody(finalStatus),
            booking_id: f.id,
          },
        ]);
      // The review written earlier is still there; no new review is accepted.
      const mine = await getReviews(f.cust.b, f.id);
      expect(mine.body.mine).toMatchObject({ rating: 4 });
      expect(mine.body.allowance.allowed).toBe(false);
      const late = await postReview(f.chef.b, f.id, { rating: 3 });
      expect(late.status, late.text).toBe(409);
      expect(late.body.error.reason).toBe("not_completed");
    },
  );

  it.each(["cancelled", "no_show_chef"] as const)(
    "completed to %s with NO cooked day: the consumed trial is released again",
    async (finalStatus) => {
      const f = await completedBooking({ trial: true });
      expect((await claimOf(f.id))?.state).toBe("consumed");
      await wipeCooked(f.id);
      const rep = await report(f);
      const admin = await newAdmin();
      const r = await resolveReport(admin.b, rep, { finalStatus, note: NOTE });
      expect(r.status, r.text).toBe(200);
      expect(r.body.freeTrial).toBe("released");
      expect((await claimOf(f.id))?.state).toBe("released");
    },
  );

  it("completed to no_show_customer with no cooked day: the trial stays consumed", async () => {
    const f = await completedBooking({ trial: true });
    await wipeCooked(f.id);
    const rep = await report(f);
    const admin = await newAdmin();
    const r = await resolveReport(admin.b, rep, {
      finalStatus: "no_show_customer",
      note: NOTE,
    });
    expect(r.status, r.text).toBe(200);
    expect((await claimOf(f.id))?.state).toBe("consumed");
  });

  it("an accepted booking still needs a final status; a cancelled booking still closes with a note only", async () => {
    const f = await acceptedBooking();
    const rep = await report(f);
    const admin = await newAdmin();
    const none = await resolveReport(admin.b, rep, { note: NOTE });
    expect(none.status, none.text).toBe(409);
    expect(none.body.error.reason).toBe("final_status_required");
    const g = await requestedBooking();
    const rep2 = await report(g);
    expect(
      (await cancel(g.cust.b, g.id, { reason: "Changed my mind." })).status,
    ).toBe(200);
    const refused = await resolveReport(admin.b, rep2, {
      finalStatus: "completed",
      note: NOTE,
    });
    expect(refused.status, refused.text).toBe(409);
    expect(refused.body.error.reason).toBe("status_not_open");
    expect((await resolveReport(admin.b, rep2, { note: NOTE })).status).toBe(
      200,
    );
    expect((await bookingRow(g.id)).status).toBe("cancelled");
  });
});

describe("fix round: the reporter is told an admin closed the report, nobody else", () => {
  const TITLE = "An admin closed your problem report";

  it.each(["dismiss", "resolve"] as const)(
    "%s: one notification for the reporter, no note in it, and none for the other party",
    async (how) => {
      const f = await requestedBooking();
      const secret = `SECRET-NOTE-${randomUUID()}`;
      const rep = await report(f, "cust");
      const admin = await newAdmin();
      const r =
        how === "dismiss"
          ? await dismissReport(admin.b, rep, { note: secret })
          : await resolveReport(admin.b, rep, { note: secret });
      expect(r.status, r.text).toBe(200);
      const mine = await notesFor(f.cust.id, "report_closed");
      expect(mine.length).toBe(1);
      expect(mine[0].title).toBe(TITLE);
      expect(mine[0].booking_id).toBe(f.id);
      expect(`${mine[0].title} ${mine[0].body}`).not.toContain(secret);
      // The other party gets nothing about it, of any kind.
      expect((await notesFor(f.chef.id, "report_closed")).length).toBe(0);
      for (const n of await notesFor(f.chef.id))
        expect(`${n.type} ${n.title} ${n.body}`.toLowerCase()).not.toContain(
          "report",
        );
    },
  );

  it("a resolve with a final status: the reporter gets the closing notice and the neutral booking notice, the other party only the booking notice", async () => {
    const f = await acceptedBooking();
    const rep = await report(f, "chef");
    const admin = await newAdmin();
    const r = await resolveReport(admin.b, rep, {
      finalStatus: "cancelled",
      note: NOTE,
    });
    expect(r.status, r.text).toBe(200);
    expect((await notesFor(f.chef.id, "report_closed")).length).toBe(1);
    expect((await notesFor(f.cust.id, "report_closed")).length).toBe(0);
    expect((await notesFor(f.cust.id, "booking_decided")).length).toBe(1);
    expect((await notesFor(f.chef.id, "booking_decided")).length).toBe(1);
  });

  it("a decided report cannot be decided again and sends no second notice", async () => {
    const f = await requestedBooking();
    const rep = await report(f);
    const admin = await newAdmin();
    expect((await dismissReport(admin.b, rep, { note: NOTE })).status).toBe(
      200,
    );
    expect((await dismissReport(admin.b, rep, { note: NOTE })).status).toBe(
      409,
    );
    expect((await notesFor(f.cust.id, "report_closed")).length).toBe(1);
  });
});

describe("fix round: an open report never blocks a completion path", () => {
  it("the chef's visit done works with an open and a reviewing report", async () => {
    const f = await acceptedBooking({ trial: true });
    await shiftDays(f.id, 3);
    expect((await cooked(f.chef.b, f.id, 1)).status).toBe(200);
    const rep = await report(f);
    const up = await svc
      .from("reports")
      .update({ status: "reviewing" })
      .eq("id", rep);
    expect(up.error).toBeNull();
    const done = await complete(f.chef.b, f.id);
    expect(done.status, done.text).toBe(200);
    expect((await claimOf(f.id))?.state).toBe("consumed");
  });
});
