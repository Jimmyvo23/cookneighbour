// T-071 Tester round: gaps around the pickup confirmation (D-55, A-26..A-29).
// Runs against the LOCAL Supabase (CI). Every chef and customer is new; asserts are id-scoped.
import { beforeEach, describe, expect, it } from "vitest";
import { CHANGE_REFUSALS } from "@/lib/domain/bookingChanges";
import { Browser, freshLimits } from "./harness";
import {
  accept,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  complete,
  confirmPickup,
  cooked,
  day,
  getBooking,
  missed,
  noShow,
  notesFor,
  propose,
  setEatBy,
  shiftDays,
  svc,
} from "./booking-helpers";
import { newAdmin } from "./chef-helpers";
import { POST as confirmRoute } from "@/app/api/bookings/[id]/days/[dayNumber]/pickup/confirm/route";

beforeEach(() => freshLimits());

const later = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

async function setup(offsets: number[], home = true) {
  const chef = await bookableChef({
    options: home ? ["customer_home", "chef_home"] : ["customer_home"],
    homeEnabled: home,
    dishes: [{ key: "pho", shelf: 2 }],
  });
  const cust = await bookingCustomer();
  const r = await bookOk(
    cust,
    bookingBody(chef, {
      days: offsets.map((n) => ({
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

/** Eat-by date of one day's meals only (offset from today). */
async function setDayEatBy(bookingId: string, dayNumber: number, off: number) {
  const d = await svc
    .from("booking_days")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("day_number", dayNumber)
    .single();
  expect(d.error).toBeNull();
  const up = await svc
    .from("booking_day_dishes")
    .update({ eat_by_date: day(off) })
    .eq("booking_day_id", d.data?.id as string);
  expect(up.error).toBeNull();
}

describe("T-071 tester gaps: pickup confirm", () => {
  it("400 for a missing or wrong content type; nothing stored", async () => {
    const { chef, cust, id } = await setup([3]);
    await shiftDays(id, 3);
    await cooked(chef.b, id, 1);
    const ctx = { params: Promise.resolve({ id, dayNumber: "1" }) };
    for (const contentType of [null, "text/plain"]) {
      const r = await cust.b.call((req) => confirmRoute(req, ctx), {
        contentType,
        noBody: true,
      });
      expect(r.status, r.text).toBe(400);
    }
    expect((await getBooking(cust.b, id)).body.days[0].pickedUpAt).toBeNull();
    expect((await notesFor(chef.id, "pickup_confirmed")).length).toBe(0);
  });

  it("403 for an admin, 403 for the chef, 401 anonymous; the check order is session, role, party", async () => {
    const { chef, cust, id } = await setup([3]);
    await shiftDays(id, 3);
    await cooked(chef.b, id, 1);
    const admin = await newAdmin();
    expect((await confirmPickup(admin.b, id, 1)).status).toBe(403);
    expect((await confirmPickup(chef.b, id, 1)).status).toBe(403);
    expect((await confirmPickup(new Browser(), id, 1)).status).toBe(401);
    expect((await confirmPickup(cust.b, id, 1)).status).toBe(200);
  });

  it("confirm voids only that day's proposals; the other day's stays open and still works", async () => {
    const { chef, cust, id } = await setup([3, 4]);
    await shiftDays(id, 4);
    await setEatBy(id, 5);
    await cooked(chef.b, id, 1);
    await cooked(chef.b, id, 2);
    expect(
      (await propose(cust.b, id, 1, { proposedAt: later(1) })).status,
    ).toBe(200);
    expect(
      (await propose(cust.b, id, 2, { proposedAt: later(1) })).status,
    ).toBe(200);
    const r = await confirmPickup(cust.b, id, 1);
    expect(r.status, r.text).toBe(200);
    expect(
      r.body.days[0].pickups.map((p: { status: string }) => p.status),
    ).toEqual(["void"]);
    expect(
      r.body.days[1].pickups.map((p: { status: string }) => p.status),
    ).toEqual(["proposed"]);
    expect(r.body.days[1].pickedUpAt).toBeNull();
    // Day 2 is not confirmed: the customer can still not propose a second time (one live), but
    // after confirming day 2 the proposal is void as well.
    const r2 = await confirmPickup(cust.b, id, 2);
    expect(r2.body.days[1].pickups[0].status).toBe("void");
    expect((await notesFor(chef.id, "pickup_confirmed")).length).toBe(2);
  });

  it("an unconfirmed day can still get a proposal after another day was confirmed", async () => {
    const { chef, cust, id } = await setup([3, 4]);
    await shiftDays(id, 4);
    await setEatBy(id, 5);
    await cooked(chef.b, id, 1);
    await cooked(chef.b, id, 2);
    expect((await confirmPickup(cust.b, id, 1)).status).toBe(200);
    const r = await propose(cust.b, id, 2, { proposedAt: later(1) });
    expect(r.status, r.text).toBe(200);
  });

  it("two parallel confirms: both 200, one notification, one time", async () => {
    const { chef, cust, id } = await setup([3]);
    await shiftDays(id, 3);
    await cooked(chef.b, id, 1);
    const [a, b] = await Promise.all([
      confirmPickup(cust.b, id, 1),
      confirmPickup(cust.b, id, 1),
    ]);
    expect(a.status, a.text).toBe(200);
    expect(b.status, b.text).toBe(200);
    expect(a.body.days[0].pickedUpAt).toBe(b.body.days[0].pickedUpAt);
    expect((await notesFor(chef.id, "pickup_confirmed")).length).toBe(1);
  });

  it("missed with day 1 confirmed past its deadline and day 2 cooked, unconfirmed, still inside its window: 409 and the booking stays accepted", async () => {
    const { chef, cust, id } = await setup([3, 4]);
    await shiftDays(id, 4);
    await cooked(chef.b, id, 1);
    await cooked(chef.b, id, 2);
    await setDayEatBy(id, 1, -1);
    await setDayEatBy(id, 2, 5);
    expect((await confirmPickup(cust.b, id, 1)).status).toBe(200);
    const r = await missed(chef.b, id);
    expect(r.status, r.text).toBe(409);
    // No unconfirmed day is past its deadline; a confirmed one is (contract: pickup_confirmed).
    expect(r.body.error.reason).toBe("pickup_confirmed");
    // Round 2: the text must stay true when another day is still inside its window.
    expect(r.body.error.message).toBe(CHANGE_REFUSALS.pickup_confirmed);
    expect(r.body.error.message).toMatch(/no missed pickup to report now/);
    const row = await svc
      .from("bookings")
      .select("status")
      .eq("id", id)
      .single();
    expect(row.data?.status).toBe("accepted");
  });

  it("missed with two past-deadline days both confirmed: pickup_confirmed", async () => {
    const { chef, cust, id } = await setup([3, 4]);
    await shiftDays(id, 4);
    await setEatBy(id, -1);
    await cooked(chef.b, id, 1);
    await cooked(chef.b, id, 2);
    await confirmPickup(cust.b, id, 1);
    await confirmPickup(cust.b, id, 2);
    const r = await missed(chef.b, id);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("pickup_confirmed");
  });

  it("missed before any deadline with an unconfirmed day: pickup_window_open", async () => {
    const { chef, id } = await setup([3]);
    await shiftDays(id, 3);
    await setEatBy(id, 5);
    await cooked(chef.b, id, 1);
    const r = await missed(chef.b, id);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("pickup_window_open");
  });

  it("confirm on a no_show_customer or no_show_chef booking is wrong_status and stores nothing", async () => {
    const a = await setup([3]);
    await shiftDays(a.id, 3);
    await cooked(a.chef.b, a.id, 1);
    await setEatBy(a.id, -1);
    expect((await missed(a.chef.b, a.id)).status).toBe(200);
    let r = await confirmPickup(a.cust.b, a.id, 1);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("wrong_status");

    const c = await setup([3, 4]);
    await shiftDays(c.id, 4); // day 1 yesterday (cooked), day 2 today (due, not cooked)
    await cooked(c.chef.b, c.id, 1);
    const ns = await noShow(c.cust.b, c.id);
    expect(ns.status, ns.text).toBe(200);
    expect(ns.body.status).toBe("no_show_chef");
    r = await confirmPickup(c.cust.b, c.id, 1);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("wrong_status");
    const d = await svc
      .from("booking_days")
      .select("picked_up_at")
      .in("booking_id", [a.id, c.id]);
    expect((d.data ?? []).every((x) => x.picked_up_at === null)).toBe(true);
  });

  it("check order: not_chef_home beats day_not_cooked; wrong_status beats not_chef_home", async () => {
    const home = await setup([3]);
    await shiftDays(home.id, 3);
    // uncooked day on a healthy chef's-home booking
    expect(
      (await confirmPickup(home.cust.b, home.id, 1)).body.error.reason,
    ).toBe("day_not_cooked");
    const away = await setup([3], false);
    await shiftDays(away.id, 3);
    expect(
      (await confirmPickup(away.cust.b, away.id, 1)).body.error.reason,
    ).toBe("not_chef_home");
    // a completed customer's-home booking: status first
    await cooked(away.chef.b, away.id, 1);
    expect((await complete(away.chef.b, away.id)).status).toBe(200);
    expect(
      (await confirmPickup(away.cust.b, away.id, 1)).body.error.reason,
    ).toBe("wrong_status");
  });

  it("confirming keeps the booking able to complete, and pickedUpAt survives completion", async () => {
    const { chef, cust, id } = await setup([3]);
    await shiftDays(id, 3);
    await cooked(chef.b, id, 1);
    const c = await confirmPickup(cust.b, id, 1);
    expect(c.status).toBe(200);
    const done = await complete(chef.b, id);
    expect(done.status, done.text).toBe(200);
    expect(done.body.status).toBe("completed");
    expect(done.body.days[0].pickedUpAt).toBe(c.body.days[0].pickedUpAt);
    expect((await notesFor(cust.id, "booking_completed")).length).toBe(1);
  });
});
