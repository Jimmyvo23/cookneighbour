// T-071 (D-55, A-26..A-29): the customer confirms "I picked up my meals" on a chef's-home booking.
// Runs against the LOCAL Supabase (CI). Every chef and customer is new.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as rejectRoute } from "@/app/api/admin/chefs/[id]/reject/route";
import { CHANGE_REFUSALS } from "@/lib/domain/bookingChanges";
import { Browser, freshLimits } from "./harness";
import {
  accept,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  cancel,
  claimOf,
  complete,
  confirmPickup,
  cooked,
  day,
  getBooking,
  missed,
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

async function rejectChef(chef: TestChef) {
  const admin = await newAdmin();
  const rj = await admin.b.call(
    (req) => rejectRoute(req, { params: Promise.resolve({ id: chef.id }) }),
    { body: { reason: "Documents did not pass." } },
  );
  expect(rj.status, rj.text).toBe(200);
}

describe("POST /api/bookings/:id/days/:dayNumber/pickup/confirm", () => {
  it("confirms a cooked day, notifies the chef once, is idempotent, and blocks 'missed'", async () => {
    const { chef, cust, id } = await setup({ offsets: [3, 4] });
    await shiftDays(id, 4); // day 1 was yesterday, day 2 is today: both can be cooked
    await setEatBy(id, 5);
    // Before cooking: refused.
    let r = await confirmPickup(cust.b, id, 1);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("day_not_cooked");
    expect((await getBooking(cust.b, id)).body.days[0].pickedUpAt).toBeNull();

    await cooked(chef.b, id, 1);
    // An open proposal and the chef's view first.
    expect(
      (await propose(cust.b, id, 1, { proposedAt: later(1) })).status,
    ).toBe(200);
    r = await confirmPickup(cust.b, id, 1);
    expect(r.status, r.text).toBe(200);
    const first = r.body.days[0].pickedUpAt as string;
    expect(first).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(r.body.days[1].pickedUpAt).toBeNull();
    expect(r.body.days[0].pickups[0].status).toBe("void");
    expect((await notesFor(chef.id, "pickup_confirmed")).length).toBe(1);

    // Repeating keeps the first time and sends no second note.
    r = await confirmPickup(cust.b, id, 1);
    expect(r.status).toBe(200);
    expect(r.body.days[0].pickedUpAt).toBe(first);
    expect((await notesFor(chef.id, "pickup_confirmed")).length).toBe(1);
    // The chef sees it too.
    expect((await getBooking(chef.b, id)).body.days[0].pickedUpAt).toBe(first);

    // The deadline passes: the only past-deadline cooked day is confirmed.
    await setEatBy(id, -1);
    r = await missed(chef.b, id);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({
      code: "INVALID_STATE",
      reason: "pickup_confirmed",
      message: CHANGE_REFUSALS.pickup_confirmed,
    });
    const row = await svc
      .from("bookings")
      .select("status")
      .eq("id", id)
      .single();
    expect(row.data?.status).toBe("accepted");
    // Confirming after the deadline is allowed too (A-27).
    await cooked(chef.b, id, 2);
    r = await confirmPickup(cust.b, id, 2);
    expect(r.status, r.text).toBe(200);
  });

  it("missed still works for a cooked day that is past its deadline and not confirmed", async () => {
    const { chef, cust, id } = await setup({ offsets: [3, 4] });
    await shiftDays(id, 4);
    await setEatBy(id, -1);
    await cooked(chef.b, id, 1);
    await cooked(chef.b, id, 2);
    expect((await confirmPickup(cust.b, id, 1)).status).toBe(200);
    const r = await missed(chef.b, id);
    expect(r.status, r.text).toBe(200);
    expect(r.body.noShow).toMatchObject({ dayNumber: 2, pickupMissed: true });
    expect((await claimOf(id))?.state).toBe("consumed");
    // The booking is closed: nothing left to confirm.
    const again = await confirmPickup(cust.b, id, 2);
    expect(again.status).toBe(409);
    expect(again.body.error.reason).toBe("wrong_status");
  });

  it("with no cooked day past its deadline, missed keeps pickup_window_open", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await setEatBy(id, 5);
    await cooked(chef.b, id, 1);
    await confirmPickup(cust.b, id, 1);
    const r = await missed(chef.b, id);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("pickup_window_open");
  });

  it("a customer's-home booking: 409 not_chef_home, pickedUpAt stays null", async () => {
    const { chef, cust, id } = await setup({ home: false });
    await shiftDays(id, 3);
    await cooked(chef.b, id, 1);
    const r = await confirmPickup(cust.b, id, 1);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("not_chef_home");
    expect((await getBooking(cust.b, id)).body.days[0].pickedUpAt).toBeNull();
  });

  it("wrong party 404, wrong role 403, bad day 404, bad id 404, anonymous 401", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await cooked(chef.b, id, 1);
    const stranger = await bookingCustomer();
    expect((await confirmPickup(stranger.b, id, 1)).status).toBe(404);
    expect((await confirmPickup(chef.b, id, 1)).status).toBe(403);
    expect((await confirmPickup(cust.b, id, 0)).status).toBe(404);
    expect((await confirmPickup(cust.b, id, 4)).status).toBe(404);
    expect((await confirmPickup(cust.b, id, "x")).status).toBe(404);
    expect((await confirmPickup(cust.b, id, 2)).status).toBe(404); // day not in the booking
    expect((await confirmPickup(cust.b, "not-a-uuid", 1)).status).toBe(404);
    expect((await confirmPickup(new Browser(), id, 1)).status).toBe(401);
    // Nothing was stored by any refused call.
    const d = await svc
      .from("booking_days")
      .select("picked_up_at")
      .eq("booking_id", id);
    expect((d.data ?? []).every((x) => x.picked_up_at === null)).toBe(true);
  });

  it("a cancelled or completed booking is wrong_status", async () => {
    const a = await setup();
    await shiftDays(a.id, 3);
    await cooked(a.chef.b, a.id, 1);
    expect((await complete(a.chef.b, a.id)).status).toBe(200);
    expect((await confirmPickup(a.cust.b, a.id, 1)).body.error.reason).toBe(
      "wrong_status",
    );
    const c = await setup({ offsets: [7] });
    expect((await cancel(c.cust.b, c.id)).status).toBe(200);
    expect((await confirmPickup(c.cust.b, c.id, 1)).body.error.reason).toBe(
      "wrong_status",
    );
  });

  it("a frozen booking refuses it (409 frozen) and stores nothing (D-65)", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await cooked(chef.b, id, 1);
    await rejectChef(chef);
    const r = await confirmPickup(cust.b, id, 1);
    expect(r.status, r.text).toBe(409);
    expect(r.body.error).toMatchObject({
      reason: "frozen",
      message: CHANGE_REFUSALS.frozen,
    });
    expect((await getBooking(cust.b, id)).body.days[0].pickedUpAt).toBeNull();
    // A wrong party still gets 404 before 'frozen'.
    expect(
      (await confirmPickup((await bookingCustomer()).b, id, 1)).status,
    ).toBe(404);
  });

  it("a cancelled (inactive) day is wrong_status", async () => {
    const { chef, cust, id } = await setup({ offsets: [3, 4] });
    await shiftDays(id, 3);
    await cooked(chef.b, id, 1);
    // Day 2 has not happened and was not cooked: deactivate it as a missed pickup would.
    await svc
      .from("booking_days")
      .update({ is_active: false })
      .eq("booking_id", id)
      .eq("day_number", 2);
    const r = await confirmPickup(cust.b, id, 2);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("wrong_status");
  });

  it("a race between confirm and missed: exactly one wins and the booking is consistent", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await setEatBy(id, -1);
    await cooked(chef.b, id, 1);
    const [c, m] = await Promise.all([
      confirmPickup(cust.b, id, 1),
      missed(chef.b, id),
    ]);
    const row = await svc
      .from("bookings")
      .select("status, pickup_missed_at")
      .eq("id", id)
      .single();
    const dayRow = await svc
      .from("booking_days")
      .select("picked_up_at")
      .eq("booking_id", id)
      .single();
    if (row.data?.status === "no_show_customer") {
      expect(m.status).toBe(200);
      expect(c.status).toBe(409);
      expect(c.body.error.reason).toBe("wrong_status");
      expect(dayRow.data?.picked_up_at).toBeNull();
    } else {
      expect(c.status).toBe(200);
      expect(m.status).toBe(409);
      expect(m.body.error.reason).toBe("pickup_confirmed");
      expect(row.data?.status).toBe("accepted");
      expect(row.data?.pickup_missed_at).toBeNull();
      expect(dayRow.data?.picked_up_at).not.toBeNull();
    }
  });

  it("a declined or agreed proposal is voided when the customer confirms", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await setEatBy(id, 5);
    await cooked(chef.b, id, 1);
    await propose(cust.b, id, 1, { proposedAt: later(1) });
    expect((await respond(chef.b, id, 1, { accept: true })).status).toBe(200);
    const r = await confirmPickup(cust.b, id, 1);
    expect(
      r.body.days[0].pickups.map((p: { status: string }) => p.status),
    ).toEqual(["void"]);
  });

  it("a confirmed day refuses a new pickup proposal (409 picked_up)", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await setEatBy(id, 5);
    await cooked(chef.b, id, 1);
    expect((await confirmPickup(cust.b, id, 1)).status).toBe(200);
    const r = await propose(cust.b, id, 1, { proposedAt: later(1) });
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.reason).toBe("picked_up");
    const p = await svc
      .from("pickup_proposals")
      .select("id")
      .eq("booking_id", id);
    expect(p.data).toEqual([]);
  });
});
