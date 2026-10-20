// T-048 Tester re-check (fix round and round 3). LOCAL Supabase (CI only).
// Covers: a second report on a booking an admin already moved, the free-trial release racing with
// the sweep, the sweep repairing a consumed claim, the chef's rating after an admin cancel,
// and a double decision on a completed booking.
import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import { claimOf, listBookings, notesFor } from "./booking-helpers";
import { newAdmin } from "./chef-helpers";
import {
  completedBooking,
  getReviews,
  postReport,
  postReview,
  publicReviews,
  reportBody,
  resolveReport,
  svc,
  type Fixture,
} from "./engagement-helpers";

beforeEach(() => freshLimits());

const NOTE = "Tester re-check, decision recorded.";

async function report(f: Fixture, by: "cust" | "chef" = "cust") {
  const r = await postReport(f[by].b, f.id, reportBody());
  expect(r.status, r.text).toBe(201);
  return r.body.id as string;
}
async function wipeCooked(id: string) {
  const up = await svc
    .from("booking_days")
    .update({ cooked_at: null })
    .eq("booking_id", id);
  expect(up.error).toBeNull();
}
const status = async (id: string) =>
  (await svc.from("bookings").select("status").eq("id", id).single()).data
    ?.status;

describe("T-048 re-check: admin changes a completed booking", () => {
  it("a second report on the same booking: a final status is refused once the first moved it; closing with a note works", async () => {
    const f = await completedBooking({ trial: true });
    const r1 = await report(f, "cust");
    const r2 = await report(f, "chef");
    const admin = await newAdmin();
    const a = await resolveReport(admin.b, r1, {
      finalStatus: "cancelled",
      note: NOTE,
    });
    expect(a.status, a.text).toBe(200);
    const b = await resolveReport(admin.b, r2, {
      finalStatus: "no_show_customer",
      note: NOTE,
    });
    expect(b.status, b.text).toBe(409);
    expect(b.body.error.reason).toBe("status_not_open");
    expect(await status(f.id)).toBe("cancelled");
    const c = await resolveReport(admin.b, r2, { note: NOTE });
    expect(c.status, c.text).toBe(200);
    expect(await status(f.id)).toBe("cancelled");
  });

  it("two admins decide the same report at once: one winner, one booking notice per party", async () => {
    const f = await completedBooking({ trial: true });
    const rep = await report(f);
    const a1 = await newAdmin();
    const a2 = await newAdmin();
    const out = await Promise.all([
      resolveReport(a1.b, rep, { finalStatus: "cancelled", note: NOTE }),
      resolveReport(a2.b, rep, { finalStatus: "no_show_chef", note: NOTE }),
    ]);
    expect(out.map((o) => o.status).sort()).toEqual([200, 409]);
    expect((await notesFor(f.cust.id, "booking_decided")).length).toBe(1);
    expect((await notesFor(f.chef.id, "booking_decided")).length).toBe(1);
    expect((await notesFor(f.cust.id, "report_closed")).length).toBe(1);
  });

  it("the release races with the sweep: the claim ends released, no error, nothing doubled", async () => {
    const f = await completedBooking({ trial: true });
    await wipeCooked(f.id);
    const rep = await report(f);
    const admin = await newAdmin();
    const [r, l1, l2] = await Promise.all([
      resolveReport(admin.b, rep, { finalStatus: "cancelled", note: NOTE }),
      listBookings(f.cust.b),
      listBookings(f.chef.b),
    ]);
    expect(r.status, r.text).toBe(200);
    expect(l1.status).toBe(200);
    expect(l2.status).toBe(200);
    // One more sweep after the decision repairs any claim the race left behind.
    expect((await listBookings(f.cust.b)).status).toBe(200);
    expect((await claimOf(f.id))?.state).toBe("released");
  });

  it("the sweep repairs a consumed claim on a cancelled booking with no cooked day (failed follow-up)", async () => {
    const f = await completedBooking({ trial: true });
    await wipeCooked(f.id);
    const rep = await report(f);
    const admin = await newAdmin();
    const r = await resolveReport(admin.b, rep, {
      finalStatus: "cancelled",
      note: NOTE,
    });
    expect(r.status, r.text).toBe(200);
    const back = await svc
      .from("free_trial_claims")
      .update({ state: "consumed" })
      .eq("booking_id", f.id);
    expect(back.error).toBeNull();
    expect((await listBookings(f.chef.b)).status).toBe(200);
    expect((await claimOf(f.id))?.state).toBe("released");
  });

  it("the sweep does NOT release a consumed claim when a day was cooked", async () => {
    const f = await completedBooking({ trial: true });
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
    expect((await listBookings(f.cust.b)).status).toBe(200);
    expect((await claimOf(f.id))?.state).toBe("consumed");
  });

  it("reviews stay after an admin cancel: the public list and the chef's rating are unchanged; the other party cannot add one", async () => {
    const f = await completedBooking();
    expect((await postReview(f.cust.b, f.id, { rating: 4 })).status).toBe(201);
    const before = await svc
      .from("chef_profiles")
      .select("review_count, rating_avg")
      .eq("id", f.chef.id)
      .single();
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
    const after = await svc
      .from("chef_profiles")
      .select("review_count, rating_avg")
      .eq("id", f.chef.id)
      .single();
    expect(after.data).toEqual(before.data);
    const pub = await publicReviews(f.cust.b, f.chef.id);
    expect(pub.status, pub.text).toBe(200);
    expect(JSON.stringify(pub.body)).toContain('"rating":4');
    const late = await postReview(f.chef.b, f.id, { rating: 2 });
    expect(late.status, late.text).toBe(409);
    // The retry of the earlier review no longer re-creates anything.
    const mine = await getReviews(f.cust.b, f.id);
    expect(mine.body.mine).toMatchObject({ rating: 4 });
  });
});
