// T-048 Tester additions (WO-5c): gaps left by the builder's suites. LOCAL Supabase (CI only).
// Covers: tight review-window edges, non-completed statuses, public privacy of reviews, a report
// staying invisible to the other party on every route they can call, report races, every final
// status on a flag with and without a cooked day, decision races, and nothing personal in logs.
// Findings F-1 and F-2 were pinned as `it.fails` and are normal passing tests since the fix round.
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as chatGet } from "@/app/api/bookings/[id]/messages/route";
import { Browser, freshLimits, type Reply } from "./harness";
import {
  bookingRow,
  cancel,
  claimOf,
  complete,
  cooked,
  decline,
  getBooking,
  listBookings,
  noShow,
  notesFor,
  shiftDays,
} from "./booking-helpers";
import { newAdmin } from "./chef-helpers";
import { rejectOf } from "./admin-helpers";
import {
  acceptedBooking,
  adminBookings,
  adminReviews,
  completedBooking,
  dismissReport,
  getReports,
  getReviews,
  postReport,
  postReview,
  publicReviews,
  reportBody,
  requestedBooking,
  resolveFlag,
  resolveReport,
  setCompletedAt,
  svc,
  type Fixture,
} from "./engagement-helpers";

beforeEach(() => freshLimits());

const DAY = 24 * 3_600_000;
const NOTE = "Tester check, decision recorded.";

async function rejectChef(chefId: string) {
  const admin = await newAdmin();
  const r = await admin.b.call(rejectOf(chefId), {
    body: { reason: "Documents did not pass." },
  });
  expect(r.status, r.text).toBe(200);
}
const chat = (b: Browser, id: string): Promise<Reply> =>
  b.call(
    (r) =>
      chatGet(new Request(`http://localhost/api/bookings/${id}/messages`, r), {
        params: Promise.resolve({ id }),
      }),
    { method: "GET" },
  );

// ---------------------------------------------------------------------------
describe("review window: tight edges and statuses", () => {
  it("30 seconds inside 14 x 24 h works and 30 seconds past is closed, for the customer and the chef", async () => {
    const inside = await completedBooking();
    const past = await completedBooking();
    await setCompletedAt(inside.id, new Date(Date.now() - 14 * DAY + 30_000));
    await setCompletedAt(past.id, new Date(Date.now() - 14 * DAY - 30_000));
    for (const who of [inside.cust, inside.chef]) {
      const r = await postReview(who.b, inside.id, { rating: 4 });
      expect(r.status, r.text).toBe(201);
    }
    for (const who of [past.cust, past.chef]) {
      const g = await getReviews(who.b, past.id);
      expect(g.body.allowance).toMatchObject({
        allowed: false,
        reason: "window_closed",
      });
      const r = await postReview(who.b, past.id, { rating: 4 });
      expect(r.status, r.text).toBe(409);
      expect(r.body.error.reason).toBe("window_closed");
    }
    const rows = await svc
      .from("reviews")
      .select("booking_id")
      .in("booking_id", [inside.id, past.id]);
    expect(rows.data?.filter((x) => x.booking_id === past.id)).toEqual([]);
    expect(rows.data?.filter((x) => x.booking_id === inside.id).length).toBe(2);
  });

  it("declined and cancelled bookings cannot be reviewed by either party", async () => {
    const declined = await requestedBooking();
    expect((await decline(declined.chef.b, declined.id)).status).toBe(200);
    const cancelled = await acceptedBooking();
    expect((await cancel(cancelled.cust.b, cancelled.id)).status).toBe(200);
    for (const f of [declined, cancelled]) {
      const g = await getReviews(f.cust.b, f.id);
      expect(g.body.allowance).toMatchObject({
        allowed: false,
        reason: "not_completed",
      });
      for (const who of [f.cust, f.chef]) {
        const r = await postReview(who.b, f.id, { rating: 5 });
        expect(r.status, r.text).toBe(409);
        expect(r.body.error.reason).toBe("not_completed");
      }
    }
    const rows = await svc
      .from("reviews")
      .select("id")
      .in("booking_id", [declined.id, cancelled.id]);
    expect(rows.data).toEqual([]);
  });

  it("a no-show booking cannot be reviewed", async () => {
    const f = await acceptedBooking();
    await shiftDays(f.id, 3);
    const n = await noShow(f.chef.b, f.id);
    expect(n.status, n.text).toBe(200);
    for (const who of [f.cust, f.chef]) {
      const r = await postReview(who.b, f.id, { rating: 1 });
      expect(r.status, r.text).toBe(409);
      expect(r.body.error.reason).toBe("not_completed");
    }
  });

  it("the chef's retry with the same content is 200 and different content is 409; the review stays final", async () => {
    const f = await completedBooking();
    const first = await postReview(f.chef.b, f.id, {
      rating: 3,
      comment: "ok",
    });
    expect(first.status).toBe(201);
    const again = await postReview(f.chef.b, f.id, {
      rating: 3,
      comment: "ok",
    });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    const edit = await postReview(f.chef.b, f.id, { rating: 5, comment: "ok" });
    expect(edit.status).toBe(409);
    expect(edit.body.error.reason).toBe("already_reviewed");
  });
});

// ---------------------------------------------------------------------------
describe("review privacy", () => {
  it("the public list never carries the full name, author id, booking id, customer id or the chef's own review", async () => {
    const f = await completedBooking();
    await svc
      .from("profiles")
      .update({ display_name: "Quillfeather Zenobia Obscura" })
      .eq("id", f.cust.id);
    const mine = await postReview(f.cust.b, f.id, {
      rating: 5,
      comment: "Wonderful food",
    });
    expect(mine.status, mine.text).toBe(201);
    const theirs = await postReview(f.chef.b, f.id, {
      rating: 2,
      comment: "CHEF-PRIVATE-OPINION",
    });
    expect(theirs.status, theirs.text).toBe(201);

    const pub = await publicReviews(new Browser(), f.chef.id, "limit=50");
    expect(pub.status, pub.text).toBe(200);
    const mineItem = pub.body.items.find(
      (x: { id: string }) => x.id === mine.body.id,
    );
    expect(mineItem.authorFirstName).toBe("Quillfeather");
    // Ids, the rest of the name, the chef's review: nowhere in the public body.
    for (const secret of [
      "Zenobia",
      "Obscura",
      f.cust.id,
      f.id,
      theirs.body.id,
      "CHEF-PRIVATE-OPINION",
      f.cust.email,
    ])
      expect(pub.text, `public body leaked ${secret}`).not.toContain(secret);
    for (const item of pub.body.items)
      expect(Object.keys(item).sort()).toEqual([
        "authorFirstName",
        "comment",
        "createdAt",
        "id",
        "rating",
      ]);
  });

  it("a chef's review of a customer is hidden from other customers, other chefs and anon; the customer and admin see it", async () => {
    const f = await completedBooking();
    const other = await completedBooking();
    const secret = `HIDDEN-${randomUUID()}`;
    const r = await postReview(f.chef.b, f.id, { rating: 1, comment: secret });
    expect(r.status, r.text).toBe(201);

    // The customer reads it as "other"; nobody else on the platform gets it.
    const mine = await getReviews(f.cust.b, f.id);
    expect(mine.body.other).toMatchObject({ comment: secret, mine: false });
    for (const stranger of [other.cust, other.chef, { b: new Browser() }]) {
      const g = await getReviews(stranger.b, f.id);
      expect([401, 404], g.text).toContain(g.status);
      expect(g.text).not.toContain(secret);
    }
    // Public routes: by chef id and by the customer's id.
    for (const id of [f.chef.id, f.cust.id]) {
      const p = await publicReviews(new Browser(), id, "limit=50");
      expect(p.text).not.toContain(secret);
    }
    // Admin sees it in the admin list, with the author's role.
    const admin = await newAdmin();
    const list = await adminReviews(admin.b, "authorRole=chef&limit=50");
    expect(list.status, list.text).toBe(200);
    expect(
      list.body.items.some((x: { id: string }) => x.id === r.body.id),
    ).toBe(true);
    // And the admin's list filter by customer does not include it.
    const cust = await adminReviews(admin.b, "authorRole=customer&limit=50");
    expect(
      cust.body.items.some((x: { id: string }) => x.id === r.body.id),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("reports stay invisible to the other party", () => {
  async function chefReads(f: Fixture) {
    return [
      await getBooking(f.chef.b, f.id),
      await listBookings(f.chef.b),
      await getReports(f.chef.b, f.id),
      await getReviews(f.chef.b, f.id),
      await chat(f.chef.b, f.id),
    ];
  }

  it("after the customer reports, no chef read, notification or chat call mentions it", async () => {
    const f = await acceptedBooking();
    const marker = `REPORT-MARKER-${randomUUID()}`;
    const beforeReads = (await chefReads(f)).map((r) => r.text);
    const before = (await notesFor(f.chef.id)).length;
    const r = await postReport(
      f.cust.b,
      f.id,
      reportBody({ description: marker, category: "safety" }),
    );
    expect(r.status, r.text).toBe(201);
    const after = await chefReads(f);
    for (const x of after) {
      expect(x.text).not.toContain(marker);
      expect(x.text).not.toContain(r.body.id);
      expect(x.text.toLowerCase()).not.toContain("problem report");
    }
    // The chef's booking detail is byte-for-byte what it was before the report.
    expect(after[0].text).toBe(beforeReads[0]);
    expect(after[2].body.items).toEqual([]);
    expect((await notesFor(f.chef.id)).length).toBe(before);
  });

  it("the customer learns nothing from the chef's report either", async () => {
    const f = await acceptedBooking();
    const marker = `CHEF-REPORT-${randomUUID()}`;
    const detail = (await getBooking(f.cust.b, f.id)).text;
    const before = (await notesFor(f.cust.id)).length;
    expect(
      (await postReport(f.chef.b, f.id, reportBody({ description: marker })))
        .status,
    ).toBe(201);
    const reads = [
      await getBooking(f.cust.b, f.id),
      await listBookings(f.cust.b),
      await getReports(f.cust.b, f.id),
      await chat(f.cust.b, f.id),
    ];
    for (const x of reads) expect(x.text).not.toContain(marker);
    expect(reads[0].text).toBe(detail);
    expect(reads[2].body.items).toEqual([]);
    expect((await notesFor(f.cust.id)).length).toBe(before);
  });

  // F-1 (fixed in the fix round): an open customer report never blocks the chef's "visit done".
  it("F-1: the chef's 'visit done' works with a customer's open report and says nothing about it", async () => {
    const f = await acceptedBooking();
    await shiftDays(f.id, 3);
    expect((await cooked(f.chef.b, f.id, 1)).status).toBe(200);
    expect((await postReport(f.cust.b, f.id, reportBody())).status).toBe(201);
    const done = await complete(f.chef.b, f.id);
    expect(done.status, done.text).toBe(200);
    expect(done.body.status).toBe("completed");
    expect(done.text).not.toContain("problem_reported");
    expect(done.text.toLowerCase()).not.toContain("report");
  });

  it("two parallel posts with the same clientId write one report (201 and 200)", async () => {
    const f = await acceptedBooking();
    const body = reportBody();
    const both = await Promise.all([
      postReport(f.cust.b, f.id, body),
      postReport(f.cust.b, f.id, body),
    ]);
    expect(
      both.map((r) => r.status).sort(),
      both.map((r) => r.text).join("|"),
    ).toEqual([200, 201]);
    expect(both[0].body.id).toBe(both[1].body.id);
    const rows = await svc.from("reports").select("id").eq("booking_id", f.id);
    expect(rows.data?.length).toBe(1);
  });

  it("a dismissed report lets the same reporter file a new one; a stranger is 404 and writes nothing", async () => {
    const f = await acceptedBooking();
    const stranger = await acceptedBooking();
    const first = await postReport(f.cust.b, f.id, reportBody());
    expect(first.status).toBe(201);
    const admin = await newAdmin();
    expect(
      (await dismissReport(admin.b, first.body.id, { note: NOTE })).status,
    ).toBe(200);
    expect((await postReport(f.cust.b, f.id, reportBody())).status).toBe(201);
    for (const s of [stranger.cust, stranger.chef]) {
      const r = await postReport(s.b, f.id, reportBody());
      expect(r.status, r.text).toBe(404);
    }
    const rows = await svc.from("reports").select("id").eq("booking_id", f.id);
    expect(rows.data?.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe("admin decisions: flags and free-trial effects", () => {
  it.each([
    ["completed", "consumed"],
    ["no_show_customer", "consumed"],
    ["no_show_chef", "released"],
    ["cancelled", "released"],
  ] as const)(
    "chef_rejected flag, nothing cooked: %s leaves the trial %s",
    async (finalStatus, trial) => {
      const f = await acceptedBooking({ trial: true });
      await rejectChef(f.chef.id);
      const admin = await newAdmin();
      const r = await resolveFlag(admin.b, f.id, { finalStatus, note: NOTE });
      expect(r.status, r.text).toBe(200);
      expect(r.body.freeTrial).toBe(trial);
      expect((await claimOf(f.id))?.state).toBe(trial);
      const d = await getBooking(f.cust.b, f.id);
      expect(d.body).toMatchObject({ status: finalStatus, frozen: false });
    },
  );

  it.each([
    ["completed", "consumed"],
    ["no_show_customer", "consumed"],
    ["cancelled", "released"],
  ] as const)(
    "no_day_cooked flag: %s leaves the trial %s",
    async (finalStatus, trial) => {
      const f = await acceptedBooking({ trial: true });
      await shiftDays(f.id, 5);
      expect((await getBooking(f.cust.b, f.id)).body.status).toBe("accepted");
      const admin = await newAdmin();
      const r = await resolveFlag(admin.b, f.id, { finalStatus, note: NOTE });
      expect(r.status, r.text).toBe(200);
      expect(r.body.freeTrial).toBe(trial);
      expect((await claimOf(f.id))?.state).toBe(trial);
    },
  );

  it("a day was cooked, then the chef was rejected: cancelling still consumes the trial", async () => {
    const f = await acceptedBooking({ trial: true });
    await shiftDays(f.id, 3);
    expect((await cooked(f.chef.b, f.id, 1)).status).toBe(200);
    await rejectChef(f.chef.id);
    const admin = await newAdmin();
    const r = await resolveFlag(admin.b, f.id, {
      finalStatus: "cancelled",
      note: NOTE,
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.freeTrial).toBe("consumed");
    expect((await claimOf(f.id))?.state).toBe("consumed");
  });

  it("two resolve-flag calls at once: exactly one wins, the other is 409 no_open_flag", async () => {
    const f = await acceptedBooking({ trial: true });
    await rejectChef(f.chef.id);
    const admin = await newAdmin();
    const both = await Promise.all([
      resolveFlag(admin.b, f.id, { finalStatus: "cancelled", note: NOTE }),
      resolveFlag(admin.b, f.id, { finalStatus: "completed", note: NOTE }),
    ]);
    expect(
      both.map((r) => r.status).sort(),
      both.map((r) => r.text).join("|"),
    ).toEqual([200, 409]);
    const loser = both.find((r) => r.status === 409)!;
    expect(loser.body.error.reason).toBe("no_open_flag");
    const winner = both.find((r) => r.status === 200)!;
    expect((await bookingRow(f.id)).status).toBe(winner.body.booking.status);
    const audit = await svc
      .from("admin_decisions")
      .select("id")
      .eq("booking_id", f.id);
    expect(audit.data?.length).toBe(1);
  });

  it("resolve and dismiss at once: exactly one wins; a dismissal win changes nothing", async () => {
    const f = await acceptedBooking({ trial: true });
    const rep = await postReport(f.cust.b, f.id, reportBody());
    const admin = await newAdmin();
    const both = await Promise.all([
      resolveReport(admin.b, rep.body.id, {
        finalStatus: "cancelled",
        note: NOTE,
      }),
      dismissReport(admin.b, rep.body.id, { note: NOTE }),
    ]);
    expect(
      both.map((r) => r.status).sort(),
      both.map((r) => r.text).join("|"),
    ).toEqual([200, 409]);
    expect(both.find((r) => r.status === 409)!.body.error.reason).toBe(
      "already_decided",
    );
    const row = await bookingRow(f.id);
    const dismissWon = both.find((r) => r.status === 200)!.body.decision.kind;
    if (dismissWon === "report_dismissed") {
      expect(row.status).toBe("accepted");
      expect((await claimOf(f.id))?.state).toBe("held");
    } else {
      expect(row.status).toBe("cancelled");
      expect((await claimOf(f.id))?.state).toBe("released");
    }
    const audit = await svc
      .from("admin_decisions")
      .select("id")
      .eq("report_id", rep.body.id);
    expect(audit.data?.length).toBe(1);
  });

  it("dismissing a report on a requested or completed booking changes neither the booking nor the trial", async () => {
    const admin = await newAdmin();
    const req = await requestedBooking({ trial: true });
    const done = await completedBooking({ trial: true });
    for (const f of [req, done]) {
      const rep = await postReport(f.cust.b, f.id, reportBody());
      expect(rep.status, rep.text).toBe(201);
      const before = (await bookingRow(f.id)).status;
      const claimBefore = (await claimOf(f.id))?.state;
      const d = await dismissReport(admin.b, rep.body.id, { note: NOTE });
      expect(d.status, d.text).toBe(200);
      expect((await bookingRow(f.id)).status).toBe(before);
      expect((await claimOf(f.id))?.state).toBe(claimBefore);
      const mine = await getReports(f.cust.b, f.id);
      expect(mine.body.items[0].status).toBe("dismissed");
    }
  });

  it("resolve-flag on a closed booking says status_not_open or no_open_flag, never changes it", async () => {
    const admin = await newAdmin();
    const f = await completedBooking();
    const r = await resolveFlag(admin.b, f.id, {
      finalStatus: "cancelled",
      note: NOTE,
    });
    expect(r.status).toBe(409);
    expect(["no_open_flag", "status_not_open"]).toContain(r.body.error.reason);
    expect((await bookingRow(f.id)).status).toBe("completed");
    const list = await adminBookings(admin.b, "status=completed&limit=50");
    expect(list.status).toBe(200);
  });

  it("the party chat READ route is also 403 for the admin (the admin reads through its own route)", async () => {
    const f = await acceptedBooking();
    const admin = await newAdmin();
    expect((await chat(admin.b, f.id)).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe("nothing personal is logged", () => {
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  afterEach(() => {
    spies.splice(0).forEach((s) => s.mockRestore());
  });

  it("reviews, reports and admin decisions log no text, name, e-mail, phone or address", async () => {
    const lines: string[] = [];
    for (const m of ["log", "info", "warn", "error", "debug"] as const)
      spies.push(
        vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
          lines.push(a.map((x) => inspect(x, { depth: 6 })).join(" "));
        }),
      );
    const f = await acceptedBooking({ trial: true });
    // T-088 main-red flake fix: digits become letters so the marker can never look like a phone number.
    const mark = `LOGMARK${randomUUID()
      .replace(/-/g, "")
      .replace(/[0-9]/g, (d) => "ghijklmnop"[+d])}`;
    await svc
      .from("profiles")
      .update({ display_name: `${mark}Name Surname` })
      .eq("id", f.cust.id);
    const desc = `${mark}-description`;
    const note = `${mark}-note`;
    const rep = await postReport(
      f.cust.b,
      f.id,
      reportBody({ description: desc }),
    );
    expect(rep.status, rep.text).toBe(201);
    // Errors too: a repeat, a bad body, a stranger.
    await postReport(f.cust.b, f.id, reportBody({ description: desc }));
    await postReport(f.cust.b, f.id, { clientId: "x", description: desc });
    await postReview(f.cust.b, f.id, { rating: 9, comment: desc });
    const admin = await newAdmin();
    const r = await resolveReport(admin.b, rep.body.id, {
      finalStatus: "completed",
      note,
    });
    expect(r.status, r.text).toBe(200);
    expect(
      (
        await postReview(f.cust.b, f.id, {
          rating: 5,
          comment: `${mark}-review`,
        })
      ).status,
    ).toBe(201);
    await resolveReport(admin.b, rep.body.id, {
      finalStatus: "cancelled",
      note,
    });
    await resolveFlag(admin.b, f.id, { finalStatus: "cancelled", note });

    const all = lines.join("\n");
    for (const secret of [
      mark,
      f.cust.email,
      f.chef.email,
      f.cust.phone,
      f.cust.line,
    ])
      expect(all, `a log line contains ${secret}`).not.toContain(secret);
  });
});
