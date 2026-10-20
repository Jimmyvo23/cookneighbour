// T-048: problem reports through the real routes (contract 7D). LOCAL Supabase (CI).
// Rules (Jimmy, 2026-10-20): either party, any status; seen by the admin and the reporter only;
// at most one open report per reporter per booking; a retry with the same clientId is safe.
import { beforeEach, describe, expect, it } from "vitest";
import { Browser, freshLimits } from "./harness";
import {
  cancel,
  decline,
  getBooking,
  listBookings,
  notesFor,
} from "./booking-helpers";
import { bookingCustomer } from "./booking-helpers";
import { newAdmin } from "./chef-helpers";
import {
  acceptedBooking,
  adminReports,
  allKeys,
  completedBooking,
  dismissReport,
  getReports,
  newUuid,
  postReport,
  reportBody,
  requestedBooking,
  svc,
  type Fixture,
} from "./engagement-helpers";

beforeEach(() => freshLimits());

const REPORT_VIEW_KEYS = [
  "bookingId",
  "category",
  "createdAt",
  "description",
  "id",
  "resolvedAt",
  "status",
];

describe("either party can report, on a booking in any status", () => {
  it("requested, accepted, declined, cancelled and completed bookings all take a report from the customer and the chef", async () => {
    const requested = await requestedBooking();
    const accepted = await acceptedBooking();
    const declined = await requestedBooking();
    expect((await decline(declined.chef.b, declined.id)).status).toBe(200);
    const cancelled = await acceptedBooking();
    expect((await cancel(cancelled.cust.b, cancelled.id)).status).toBe(200);
    const completed = await completedBooking();
    for (const f of [requested, accepted, declined, cancelled, completed]) {
      for (const who of [f.cust, f.chef]) {
        const r = await postReport(who.b, f.id, reportBody());
        expect(r.status, r.text).toBe(201);
        expect(Object.keys(r.body).sort()).toEqual(REPORT_VIEW_KEYS);
        expect(r.body).toMatchObject({
          bookingId: f.id,
          status: "open",
          resolvedAt: null,
        });
      }
    }
  });

  it("the default category is other; every category is accepted", async () => {
    const f = await acceptedBooking();
    const dflt = await postReport(f.cust.b, f.id, {
      clientId: newUuid(),
      description: "No category given.",
    });
    expect(dflt.status, dflt.text).toBe(201);
    expect(dflt.body.category).toBe("other");
    for (const category of ["safety", "food_quality", "no_show", "payment"]) {
      // one open at a time: close the last one first
      await svc
        .from("reports")
        .update({ status: "dismissed", resolved_at: new Date().toISOString() })
        .eq("reporter_id", f.cust.id);
      const r = await postReport(f.cust.b, f.id, reportBody({ category }));
      expect(r.status, `${category}: ${r.text}`).toBe(201);
      expect(r.body.category).toBe(category);
    }
  });
});

describe("only the admin and the reporter see a report", () => {
  it("the other party gets no route, no notification and no field that tells them", async () => {
    const f = await acceptedBooking();
    const before = {
      chef: (await notesFor(f.chef.id)).length,
      cust: (await notesFor(f.cust.id)).length,
    };
    const chefDetailBefore = JSON.stringify(
      (await getBooking(f.chef.b, f.id)).body,
    );
    const r = await postReport(
      f.cust.b,
      f.id,
      reportBody({ description: "UNIQUE-REPORT-TEXT" }),
    );
    expect(r.status, r.text).toBe(201);

    // The chef's own report list is empty; the report does not appear anywhere in their reads.
    const chefList = await getReports(f.chef.b, f.id);
    expect(chefList.status).toBe(200);
    expect(chefList.body.items).toEqual([]);
    const chefBooking = await getBooking(f.chef.b, f.id);
    expect(chefBooking.text).not.toContain("UNIQUE-REPORT-TEXT");
    expect(JSON.stringify(chefBooking.body)).toBe(chefDetailBefore);
    expect((await listBookings(f.chef.b)).text).not.toContain(
      "UNIQUE-REPORT-TEXT",
    );
    expect((await notesFor(f.chef.id)).length).toBe(before.chef);
    expect((await notesFor(f.cust.id)).length).toBe(before.cust);
    // Straight from the table with the chef's own session: no row either (row-level security).
    const rows = await svc.from("reports").select("id").eq("booking_id", f.id);
    expect(rows.data?.length).toBe(1);
  });

  it("the reporter reads their own reports only, with no admin note or decision", async () => {
    const f = await acceptedBooking();
    const mine = await postReport(f.cust.b, f.id, reportBody());
    const theirs = await postReport(f.chef.b, f.id, reportBody());
    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);
    const list = await getReports(f.cust.b, f.id);
    expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([
      mine.body.id,
    ]);
    const keys = allKeys(list.body);
    for (const k of [
      "adminNote",
      "admin_note",
      "note",
      "finalStatus",
      "decision",
      "reporterId",
    ])
      expect(keys.has(k)).toBe(false);
    for (const item of list.body.items)
      expect(Object.keys(item).sort()).toEqual(REPORT_VIEW_KEYS);
  });

  it("the reporter sees the new status when the admin dismisses it", async () => {
    const f = await acceptedBooking();
    const rep = await postReport(f.cust.b, f.id, reportBody());
    const admin = await newAdmin();
    const d = await dismissReport(admin.b, rep.body.id, {
      note: "Nothing to act on.",
    });
    expect(d.status, d.text).toBe(200);
    const list = await getReports(f.cust.b, f.id);
    expect(list.body.items[0]).toMatchObject({
      id: rep.body.id,
      status: "dismissed",
    });
    expect(list.body.items[0].resolvedAt).toBeTruthy();
    // The other party still sees nothing, and no notification went to either party.
    expect((await getReports(f.chef.b, f.id)).body.items).toEqual([]);
    expect((await notesFor(f.chef.id, "booking_decided")).length).toBe(0);
    expect((await notesFor(f.cust.id, "booking_decided")).length).toBe(0);
  });
});

describe("one open report per reporter per booking", () => {
  it("a second report is 409 report_open until the first is resolved or dismissed; the other party may report", async () => {
    const f = await acceptedBooking();
    const first = await postReport(f.cust.b, f.id, reportBody());
    expect(first.status).toBe(201);
    const second = await postReport(
      f.cust.b,
      f.id,
      reportBody({ description: "Another one." }),
    );
    expect(second.status, second.text).toBe(409);
    expect(second.body.error).toMatchObject({
      code: "INVALID_STATE",
      reason: "report_open",
    });
    expect(second.body.error.message).toMatch(
      /already have a problem report open/i,
    );
    // The chef is a different reporter.
    expect((await postReport(f.chef.b, f.id, reportBody())).status).toBe(201);
    // Reviewing counts as open.
    await svc
      .from("reports")
      .update({ status: "reviewing" })
      .eq("id", first.body.id);
    expect((await postReport(f.cust.b, f.id, reportBody())).status).toBe(409);
    // After the admin dismisses it, a new report is allowed.
    const admin = await newAdmin();
    expect(
      (await dismissReport(admin.b, first.body.id, { note: "Closed it." }))
        .status,
    ).toBe(200);
    const third = await postReport(
      f.cust.b,
      f.id,
      reportBody({ description: "A new problem." }),
    );
    expect(third.status, third.text).toBe(201);
    const rows = await svc
      .from("reports")
      .select("id")
      .eq("reporter_id", f.cust.id);
    expect(rows.data?.length).toBe(2);
  });

  it("one open report per booking, not per customer: another booking takes a report", async () => {
    const a = await acceptedBooking();
    const b = await acceptedBooking();
    expect((await postReport(a.cust.b, a.id, reportBody())).status).toBe(201);
    expect((await postReport(b.cust.b, b.id, reportBody())).status).toBe(201);
  });

  it("two parallel reports with different client ids: exactly one wins", async () => {
    const f = await acceptedBooking();
    const both = await Promise.all([
      postReport(f.cust.b, f.id, reportBody({ description: "Parallel A" })),
      postReport(f.cust.b, f.id, reportBody({ description: "Parallel B" })),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = both.find((r) => r.status === 409)!;
    expect(loser.body.error.reason).toBe("report_open");
    const rows = await svc.from("reports").select("id").eq("booking_id", f.id);
    expect(rows.data?.length).toBe(1);
  });
});

describe("retry with the same clientId (T-075)", () => {
  it("same content: 200 and the first report, no second row, even after the first was closed", async () => {
    const f = await acceptedBooking();
    const body = reportBody({ description: "Retried." });
    const first = await postReport(f.cust.b, f.id, body);
    expect(first.status).toBe(201);
    const again = await postReport(f.cust.b, f.id, body);
    expect(again.status, again.text).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    const admin = await newAdmin();
    await dismissReport(admin.b, first.body.id, { note: "Closed." });
    const late = await postReport(f.cust.b, f.id, body);
    expect(late.status, late.text).toBe(200);
    expect(late.body.id).toBe(first.body.id);
    expect(late.body.status).toBe("dismissed");
    const rows = await svc.from("reports").select("id").eq("booking_id", f.id);
    expect(rows.data?.length).toBe(1);
  });

  it("the same clientId with other content, or on another booking, is 409 client_id_reused", async () => {
    const a = await acceptedBooking();
    const body = reportBody();
    expect((await postReport(a.cust.b, a.id, body)).status).toBe(201);
    const other = await postReport(a.cust.b, a.id, {
      ...body,
      description: "Different text.",
    });
    expect(other.status, other.text).toBe(409);
    expect(other.body.error.reason).toBe("client_id_reused");
    // Same customer, another booking, same clientId.
    const rows = await svc
      .from("reports")
      .select("id")
      .eq("client_id", body.clientId);
    expect(rows.data?.length).toBe(1);
  });

  it("another reporter may use the same clientId text (the key is per reporter)", async () => {
    const f = await acceptedBooking();
    const id = newUuid();
    expect(
      (await postReport(f.cust.b, f.id, reportBody({ clientId: id }))).status,
    ).toBe(201);
    expect(
      (await postReport(f.chef.b, f.id, reportBody({ clientId: id }))).status,
    ).toBe(201);
  });
});

describe("access and validation", () => {
  it("anon 401, admin 403, a stranger 404 (also an unknown id), for GET and POST", async () => {
    const f: Fixture = await acceptedBooking();
    const admin = await newAdmin();
    const stranger = await bookingCustomer();
    const anon = new Browser();
    const unknown = "00000000-0000-4000-8000-000000000000";
    for (const call of [
      (b: Browser, id: string) => getReports(b, id),
      (b: Browser, id: string) => postReport(b, id, reportBody()),
    ]) {
      expect((await call(anon, f.id)).status).toBe(401);
      expect((await call(admin.b, f.id)).status).toBe(403);
      expect((await call(stranger.b, f.id)).status).toBe(404);
      expect((await call(f.cust.b, unknown)).status).toBe(404);
      expect((await call(f.cust.b, "not-a-uuid")).status).toBe(404);
    }
    const rows = await svc.from("reports").select("id").eq("booking_id", f.id);
    expect(rows.data).toEqual([]);
  });

  it("body rules are 422 with the field names, nothing is written; the content type is 400", async () => {
    const f = await acceptedBooking();
    const good = reportBody();
    for (const [body, field] of [
      [{ ...good, clientId: undefined }, "clientId"],
      [{ ...good, clientId: newUuid().toUpperCase() }, "clientId"],
      [{ ...good, clientId: "abc" }, "clientId"],
      [{ ...good, category: "rude" }, "category"],
      [{ ...good, description: "   " }, "description"],
      [{ ...good, description: undefined }, "description"],
      [{ ...good, description: "x".repeat(2001) }, "description"],
      [{ ...good, description: "bad\u0007text" }, "description"],
      [{ ...good, status: "resolved" }, "status"],
      [{ ...good, reporterId: f.chef.id }, "reporterId"],
    ] as [Record<string, unknown>, string][]) {
      const r = await postReport(f.cust.b, f.id, body);
      expect(r.status, `${field}: ${r.text}`).toBe(422);
      expect(r.body.error.fields[field]).toBeTruthy();
    }
    const ct = await postReport(f.cust.b, f.id, good, {
      contentType: "text/plain",
    });
    expect(ct.status).toBe(400);
    const ok = await postReport(
      f.cust.b,
      f.id,
      reportBody({ description: "x".repeat(2000) }),
    );
    expect(ok.status, ok.text).toBe(201);
    const rows = await svc.from("reports").select("id").eq("booking_id", f.id);
    expect(rows.data?.length).toBe(1);
  });

  it("a report shows up in the admin list with who reported it", async () => {
    const f = await acceptedBooking();
    const rep = await postReport(f.chef.b, f.id, reportBody());
    const admin = await newAdmin();
    const list = await adminReports(admin.b, "limit=50");
    expect(list.status, list.text).toBe(200);
    const item = list.body.items.find(
      (x: { id: string }) => x.id === rep.body.id,
    );
    expect(item).toMatchObject({
      bookingId: f.id,
      status: "open",
      reporter: { id: f.chef.id, role: "chef" },
    });
  });
});
