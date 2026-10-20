// T-081 (D-81, D-83): an accepted chef's-home booking completes right away once EVERY day is cooked
// and picked up. Runs against the LOCAL Supabase (CI). Every chef and customer is new.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as rejectRoute } from "@/app/api/admin/chefs/[id]/reject/route";
import { Browser, freshLimits } from "./harness";
import {
  accept,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  bookingRow,
  claimOf,
  confirmPickup,
  cooked,
  day,
  getBooking,
  notesFor,
  propose,
  setEatBy,
  shiftDays,
  svc,
} from "./booking-helpers";
import { newAdmin } from "./chef-helpers";

beforeEach(() => freshLimits());

const later = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

async function setup(o: { home?: boolean; offsets?: number[] } = {}) {
  const home = o.home !== false;
  const chef = await bookableChef({
    options: home ? ["customer_home", "chef_home"] : ["customer_home"],
    homeEnabled: home,
    dishes: [{ key: "pho", shelf: 2 }],
  });
  const cust = await bookingCustomer();
  const r = await bookOk(
    cust,
    bookingBody(chef, {
      days: (o.offsets ?? [3]).map((n) => ({
        date: day(n),
        dishes: [{ dishId: chef.dishes.pho, quantity: 1 }],
      })),
      useFreeTrial: true,
      ...(home ? { locationType: "chef_home", address: undefined } : {}),
    }),
  );
  expect((await accept(chef.b, r.id)).status).toBe(200);
  return { chef, cust, id: r.id as string };
}

const sweep = (user: string | null) =>
  svc.rpc("sweep_booking_changes", { p_user: user });

describe("T-081: confirming the last picked-up day completes the booking", () => {
  it("1 day: the confirm returns a completed booking at once and the free trial is used", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await setEatBy(id, 5); // the pickup deadline is days away: only the confirm can complete it
    await cooked(chef.b, id, 1);
    expect((await claimOf(id))?.state).toBe("held");
    const r = await confirmPickup(cust.b, id, 1);
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe("completed");
    expect(r.body.days[0].pickedUpAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    const row = await bookingRow(id);
    expect(row.status).toBe("completed");
    expect(row.completed_at).not.toBeNull();
    expect((await claimOf(id))?.state).toBe("consumed");
    // Both sides are told once; the chef also got the pickup note.
    expect((await notesFor(cust.id, "booking_completed")).length).toBe(1);
    expect((await notesFor(chef.id, "booking_completed")).length).toBe(1);
    expect((await notesFor(chef.id, "pickup_confirmed")).length).toBe(1);
    // A repeat (double click) is harmless: 200, still completed, no second note.
    const again = await confirmPickup(cust.b, id, 1);
    expect(again.status, again.text).toBe(200);
    expect(again.body.status).toBe("completed");
    expect(again.body.days[0].pickedUpAt).toBe(r.body.days[0].pickedUpAt);
    expect((await notesFor(cust.id, "booking_completed")).length).toBe(1);
    expect((await claimOf(id))?.state).toBe("consumed");
  });

  it("2 days: day 1 confirmed and day 2 not cooked stays accepted; confirming day 2 completes", async () => {
    const { chef, cust, id } = await setup({ offsets: [3, 4] });
    await shiftDays(id, 3); // day 1 today, day 2 tomorrow
    await setEatBy(id, 5);
    await cooked(chef.b, id, 1);
    let r = await confirmPickup(cust.b, id, 1);
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe("accepted");
    expect((await bookingRow(id)).status).toBe("accepted");
    expect((await claimOf(id))?.state).toBe("held");
    expect((await notesFor(cust.id, "booking_completed")).length).toBe(0);

    await shiftDays(id, 1); // day 2 is today now
    await cooked(chef.b, id, 2);
    // Cooked but not confirmed: still accepted.
    expect((await bookingRow(id)).status).toBe("accepted");
    r = await confirmPickup(cust.b, id, 2);
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe("completed");
    expect((await claimOf(id))?.state).toBe("consumed");
  });

  it("2 days both cooked, only one confirmed: stays accepted", async () => {
    const { chef, cust, id } = await setup({ offsets: [3, 4] });
    await shiftDays(id, 4);
    await setEatBy(id, 5);
    await cooked(chef.b, id, 1);
    await cooked(chef.b, id, 2);
    const r = await confirmPickup(cust.b, id, 2);
    expect(r.body.status).toBe("accepted");
    expect((await bookingRow(id)).status).toBe("accepted");
  });

  it("completing voids open and agreed pickup proposals of the other days and resolves a no_day_cooked flag", async () => {
    const { chef, cust, id } = await setup({ offsets: [3, 4] });
    await shiftDays(id, 4);
    await setEatBy(id, 5);
    await cooked(chef.b, id, 1);
    await cooked(chef.b, id, 2);
    expect(
      (await propose(cust.b, id, 2, { proposedAt: later(1) })).status,
    ).toBe(200);
    expect((await confirmPickup(cust.b, id, 1)).body.status).toBe("accepted");
    // An open no_day_cooked flag (D-57) does not freeze the booking.
    const fl = await svc
      .from("booking_flags")
      .insert({ booking_id: id, reason: "no_day_cooked" });
    expect(fl.error).toBeNull();
    const r = await confirmPickup(cust.b, id, 2);
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe("completed");
    const props = await svc
      .from("pickup_proposals")
      .select("status")
      .eq("booking_id", id);
    expect((props.data ?? []).every((p) => p.status === "void")).toBe(true);
    const flags = await svc
      .from("booking_flags")
      .select("resolved_at")
      .eq("booking_id", id);
    expect(flags.data?.length).toBe(1);
    expect(flags.data?.[0].resolved_at).not.toBeNull();
  });

  it("a frozen booking refuses the confirm and does not complete (D-65)", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await setEatBy(id, 5);
    await cooked(chef.b, id, 1);
    const admin = await newAdmin();
    const rj = await admin.b.call(
      (req) => rejectRoute(req, { params: Promise.resolve({ id: chef.id }) }),
      { body: { reason: "Documents did not pass." } },
    );
    expect(rj.status, rj.text).toBe(200);
    const r = await confirmPickup(cust.b, id, 1);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("frozen");
    expect((await bookingRow(id)).status).toBe("accepted");
    const d = await svc
      .from("booking_days")
      .select("picked_up_at")
      .eq("booking_id", id);
    expect(d.data?.[0].picked_up_at).toBeNull();
    // Even if the data says "all picked up", the sweep never completes a frozen booking.
    const up = await svc
      .from("booking_days")
      .update({ picked_up_at: new Date().toISOString() })
      .eq("booking_id", id);
    expect(up.error).toBeNull();
    expect((await sweep(cust.id)).error).toBeNull();
    expect((await bookingRow(id)).status).toBe("accepted");
  });

  it("T-048: an open problem report does not stop the last pickup confirmation from completing the booking (replaces A-30)", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await setEatBy(id, 5);
    await cooked(chef.b, id, 1);
    const rep = await svc
      .from("reports")
      .insert({
        booking_id: id,
        reporter_id: cust.id,
        description: "A problem.",
      })
      .select("id")
      .single();
    expect(rep.error).toBeNull();
    const r = await confirmPickup(cust.b, id, 1);
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe("completed");
    expect((await bookingRow(id)).status).toBe("completed");
    // Nothing is left for the sweep, and the report itself is untouched.
    expect((await sweep(cust.id)).data).toMatchObject({ completed: 0 });
    const still = await svc
      .from("reports")
      .select("status")
      .eq("id", rep.data?.id as string)
      .single();
    expect(still.data?.status).toBe("open");
  });

  it("sweep path: an all-picked-up booking is due before any deadline; a partly picked-up one is not", async () => {
    const a = await setup({ offsets: [3, 4] });
    const b = await setup({ offsets: [3, 4] });
    for (const x of [a, b]) {
      await shiftDays(x.id, 4);
      await setEatBy(x.id, 5);
      await cooked(x.chef.b, x.id, 1);
      await cooked(x.chef.b, x.id, 2);
    }
    const now = new Date().toISOString();
    // a: both days picked up behind the route's back; b: only day 1.
    expect(
      (
        await svc
          .from("booking_days")
          .update({ picked_up_at: now })
          .eq("booking_id", a.id)
      ).error,
    ).toBeNull();
    expect(
      (
        await svc
          .from("booking_days")
          .update({ picked_up_at: now })
          .eq("booking_id", b.id)
          .eq("day_number", 1)
      ).error,
    ).toBeNull();
    const s = await sweep(a.cust.id);
    expect(s.error).toBeNull();
    expect(s.data).toMatchObject({ completed: 1 });
    expect((await bookingRow(a.id)).status).toBe("completed");
    expect((await sweep(b.cust.id)).data).toMatchObject({ completed: 0 });
    expect((await bookingRow(b.id)).status).toBe("accepted");
    expect((await getBooking(a.cust.b, a.id)).body.status).toBe("completed");
  });

  it("customer's home is unchanged: pickup confirm is refused and nothing completes by it", async () => {
    const { chef, cust, id } = await setup({ home: false });
    await shiftDays(id, 3);
    await cooked(chef.b, id, 1);
    const r = await confirmPickup(cust.b, id, 1);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("not_chef_home");
    expect((await bookingRow(id)).status).toBe("accepted");
    // Even a forced picked_up_at does not make a customer's-home booking due.
    await svc
      .from("booking_days")
      .update({ picked_up_at: new Date().toISOString() })
      .eq("booking_id", id);
    expect((await sweep(cust.id)).data).toMatchObject({ completed: 0 });
    expect((await bookingRow(id)).status).toBe("accepted");
  });

  it("a stranger, the chef and an anonymous caller still cannot confirm", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await cooked(chef.b, id, 1);
    expect(
      (await confirmPickup((await bookingCustomer()).b, id, 1)).status,
    ).toBe(404);
    expect((await confirmPickup(chef.b, id, 1)).status).toBe(403);
    expect((await confirmPickup(new Browser(), id, 1)).status).toBe(401);
    expect((await bookingRow(id)).status).toBe("accepted");
    expect(cust.id).toBeTruthy();
  });
});
