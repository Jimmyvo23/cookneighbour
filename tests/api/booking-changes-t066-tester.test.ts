// T-066 Tester additions: the D-36 sweep (idempotent, scoped, report-aware, privacy), a flagged
// booking that is cooked later, a D-22 flag that is not doubled, L2 on the automatic completion.
// Runs against the LOCAL Supabase (CI). Uses the real routes and functions for test data.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as rejectRoute } from "@/app/api/admin/chefs/[id]/reject/route";
import { freshLimits } from "./harness";
import {
  accept,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  bookingRow,
  claimOf,
  complete,
  cooked,
  day,
  getBooking,
  notesFor,
  propose,
  respond,
  setEatBy,
  shiftDays,
  svc,
  type TestChef,
} from "./booking-helpers";
import { newAdmin } from "./chef-helpers";

beforeEach(() => freshLimits());

const dayBody = (chef: TestChef, offset: number) => ({
  date: day(offset),
  dishes: [{ dishId: chef.dishes.pho, quantity: 1 }],
});

async function setup(
  o: { home?: boolean; trial?: boolean; offsets?: number[] } = {},
) {
  const chef = await bookableChef({
    options: o.home ? ["customer_home", "chef_home"] : ["customer_home"],
    homeEnabled: o.home === true,
    dishes: [{ key: "pho", shelf: 2 }],
  });
  const cust = await bookingCustomer();
  const r = await bookOk(
    cust,
    bookingBody(chef, {
      days: (o.offsets ?? [3]).map((n) => dayBody(chef, n)),
      useFreeTrial: o.trial === true,
      ...(o.home ? { locationType: "chef_home", address: undefined } : {}),
    }),
  );
  expect((await accept(chef.b, r.id)).status).toBe(200);
  return { chef, cust, id: r.id as string };
}

const sweep = (user: string | null) =>
  svc.rpc("sweep_booking_changes", { p_user: user });
const flagsOf = async (id: string) => {
  const f = await svc
    .from("booking_flags")
    .select("reason")
    .eq("booking_id", id);
  expect(f.error).toBeNull();
  return (f.data ?? []).map((x) => x.reason as string);
};

describe("D-36 sweep: idempotent, scoped, neutral", () => {
  it("flags once however often either party or the sweep runs; notices hold no private data", async () => {
    const { chef, cust, id } = await setup({ trial: true });
    await shiftDays(id, 5);
    const first = await sweep(cust.id);
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ completed: 0, flagged: 1 });
    for (const who of [cust.id, chef.id, cust.id]) {
      const again = await sweep(who);
      expect(again.data).toMatchObject({ completed: 0, flagged: 0 });
    }
    expect((await getBooking(chef.b, id)).body.status).toBe("accepted");
    expect(await flagsOf(id)).toEqual(["no_day_cooked"]);
    expect((await claimOf(id))?.state).toBe("held");
    expect((await bookingRow(id)).completed_at).toBeNull();

    const notes = [
      ...(await notesFor(cust.id, "booking_flagged")),
      ...(await notesFor(chef.id, "booking_flagged")),
    ];
    expect(notes.length).toBe(2);
    for (const n of notes) {
      const text = `${n.title} ${n.body ?? ""}`;
      expect(text).not.toContain(cust.line);
      expect(text).not.toContain(cust.phone);
      expect(text).not.toMatch(/@|https?:|\d{3}[ -]?\d{3,4}/);
      expect(n.booking_id).toBe(id);
    }
    // The flag is not part of any booking JSON the parties get.
    const cj = JSON.stringify((await getBooking(cust.b, id)).body);
    expect(cj).not.toContain("no_day_cooked");
    expect(cj).not.toContain("booking_flags");
  });

  it("a sweep for one customer does not touch another customer's due booking", async () => {
    const a = await setup();
    const b = await setup();
    await shiftDays(a.id, 5);
    await shiftDays(b.id, 5);
    expect((await sweep(a.cust.id)).data).toMatchObject({ flagged: 1 });
    expect(await flagsOf(a.id)).toEqual(["no_day_cooked"]);
    expect(await flagsOf(b.id)).toEqual([]);
  });

  it("one sweep completes the cooked booking and flags the uncooked one", async () => {
    const cooker = await setup();
    const idle = await setup();
    for (const x of [cooker, idle]) await shiftDays(x.id, 5);
    expect((await cooked(cooker.chef.b, cooker.id, 1)).status).toBe(200);
    // Neither is due for a customer-scoped sweep of the other, so run both users.
    expect((await sweep(cooker.cust.id)).data).toMatchObject({
      completed: 1,
      flagged: 0,
    });
    expect((await sweep(idle.cust.id)).data).toMatchObject({
      completed: 0,
      flagged: 1,
    });
    expect((await bookingRow(cooker.id)).status).toBe("completed");
    expect((await bookingRow(idle.id)).status).toBe("accepted");
    expect(await flagsOf(cooker.id)).toEqual([]);
    expect(await flagsOf(idle.id)).toEqual(["no_day_cooked"]);
  });

  it("an open problem report stops the flag too (nothing happens until the admin acts)", async () => {
    const { cust, id } = await setup();
    await shiftDays(id, 5);
    const rep = await svc.from("reports").insert({
      booking_id: id,
      reporter_id: cust.id,
      description: "A problem.",
    });
    expect(rep.error).toBeNull();
    expect((await sweep(cust.id)).data).toMatchObject({
      completed: 0,
      flagged: 0,
    });
    expect(await flagsOf(id)).toEqual([]);
    expect((await notesFor(cust.id, "booking_flagged")).length).toBe(0);
  });

  it("a flagged booking is completed after the chef marks a day cooked; the flag is not doubled", async () => {
    const { chef, cust, id } = await setup({ trial: true });
    await shiftDays(id, 5);
    await sweep(cust.id);
    expect(await flagsOf(id)).toEqual(["no_day_cooked"]);
    expect((await cooked(chef.b, id, 1)).status).toBe(200);
    const r = await getBooking(cust.b, id);
    expect(r.body.status).toBe("completed");
    expect((await claimOf(id))?.state).toBe("consumed");
    await sweep(cust.id);
    await sweep(chef.id);
    expect(await flagsOf(id)).toEqual(["no_day_cooked"]);
    expect((await notesFor(cust.id, "booking_completed")).length).toBe(1);
    expect((await notesFor(chef.id, "booking_completed")).length).toBe(1);
    expect((await notesFor(cust.id, "booking_flagged")).length).toBe(1);
  });

  it("a booking already flagged chef_rejected keeps that one flag and gets no second notice", async () => {
    const { chef, cust, id } = await setup();
    const admin = await newAdmin();
    const rj = await admin.b.call(
      (req) => rejectRoute(req, { params: Promise.resolve({ id: chef.id }) }),
      { body: { reason: "Documents did not pass." } },
    );
    expect(rj.status, rj.text).toBe(200);
    expect(await flagsOf(id)).toEqual(["chef_rejected"]);
    expect((await notesFor(cust.id, "booking_flagged")).length).toBe(1);
    await shiftDays(id, 5);
    expect((await sweep(cust.id)).data).toMatchObject({
      completed: 0,
      flagged: 0,
    });
    expect(await flagsOf(id)).toEqual(["chef_rejected"]);
    expect((await notesFor(cust.id, "booking_flagged")).length).toBe(1);
    expect((await bookingRow(id)).status).toBe("accepted");
  });
});

describe("L2: the automatic completion voids an agreed pickup", () => {
  it("chef's home: agreed pickup is void once the sweep completes the booking", async () => {
    const { chef, cust, id } = await setup({ home: true, trial: true });
    await shiftDays(id, 3);
    expect((await cooked(chef.b, id, 1)).status).toBe(200);
    const when = new Date(Date.now() + 86_400_000).toISOString();
    expect((await propose(cust.b, id, 1, { proposedAt: when })).status).toBe(
      200,
    );
    expect((await respond(chef.b, id, 1, { accept: true })).status).toBe(200);
    await shiftDays(id, 2); // last visit 5 days ago
    await setEatBy(id, -1); // pickup window over
    expect((await getBooking(cust.b, id)).body.status).toBe("completed");
    const p = await svc
      .from("pickup_proposals")
      .select("status")
      .eq("booking_id", id);
    expect(p.data).toEqual([{ status: "void" }]);
    expect((await claimOf(id))?.state).toBe("consumed");
    // A completed booking cannot be completed again.
    expect((await complete(chef.b, id)).status).toBe(409);
  });
});
