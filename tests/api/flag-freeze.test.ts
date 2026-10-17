// T-064: D-53 (a flagged booking is frozen) and D-57 (a no_day_cooked flag does not freeze and is
// resolved by completing), through the real routes. Runs against the LOCAL Supabase (CI).
import { beforeEach, describe, expect, it } from "vitest";
import { POST as rejectRoute } from "@/app/api/admin/chefs/[id]/reject/route";
import { CHANGE_REFUSALS } from "@/lib/domain/bookingChanges";
import { freshLimits } from "./harness";
import {
  accept,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  bookingRow,
  cancel,
  complete,
  cooked,
  day,
  getBooking,
  listBookings,
  noShow,
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

async function setup() {
  const chef = await bookableChef({ dishes: [{ key: "pho", shelf: 2 }] });
  const cust = await bookingCustomer();
  const r = await bookOk(cust, bookingBody(chef, { days: [dayBody(chef, 3)] }));
  expect((await accept(chef.b, r.id)).status).toBe(200);
  return { chef, cust, id: r.id as string };
}

async function reject(chefId: string) {
  const admin = await newAdmin();
  const rj = await admin.b.call(
    (req) => rejectRoute(req, { params: Promise.resolve({ id: chefId }) }),
    { body: { reason: "Documents did not pass." } },
  );
  expect(rj.status, rj.text).toBe(200);
}

const flagOf = async (id: string) =>
  (
    await svc
      .from("booking_flags")
      .select("reason, resolved_at")
      .eq("booking_id", id)
      .maybeSingle()
  ).data;

describe("D-53: a booking of a rejected chef is frozen", () => {
  it("both parties see frozen: true; before the rejection it is false", async () => {
    const { chef, cust, id } = await setup();
    expect((await getBooking(cust.b, id)).body.frozen).toBe(false);
    expect((await getBooking(chef.b, id)).body.frozen).toBe(false);
    await reject(chef.id);
    expect((await getBooking(cust.b, id)).body.frozen).toBe(true);
    expect((await getBooking(chef.b, id)).body.frozen).toBe(true);
  });

  it("the chef's actions and the customer's cancel and no-show answer 409 frozen, nothing changes", async () => {
    const { chef, cust, id } = await setup();
    await reject(chef.id);
    await shiftDays(id, 3); // the visit is due, so only the freeze can be the reason
    const replies = [
      await cooked(chef.b, id, 1),
      await complete(chef.b, id),
      await noShow(chef.b, id),
      await noShow(cust.b, id),
      await cancel(cust.b, id),
      await cancel(chef.b, id),
    ];
    for (const r of replies) {
      expect(r.status, r.text).toBe(409);
      expect(r.body.error).toMatchObject({
        code: "INVALID_STATE",
        reason: "frozen",
        message: CHANGE_REFUSALS.frozen,
      });
    }
    const row = await bookingRow(id);
    expect(row.status).toBe("accepted");
    const d = await svc
      .from("booking_days")
      .select("cooked_at")
      .eq("booking_id", id);
    expect(d.data?.every((x) => x.cooked_at === null)).toBe(true);
  });

  it("the neutral text does not say why", async () => {
    const { chef, id } = await setup();
    await reject(chef.id);
    const r = await complete(chef.b, id);
    expect(JSON.stringify(r.body)).not.toMatch(/reject|chef_rejected|flag/i);
  });

  it("the automatic completion leaves a cooked, frozen booking alone", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 5);
    expect((await cooked(chef.b, id, 1)).status).toBe(200);
    // The cooked call ran the sweep first, which flagged no_day_cooked; the rejection upgrades it.
    await reject(chef.id);
    const got = await getBooking(cust.b, id); // runs the lazy sweep
    expect(got.body.status).toBe("accepted");
    expect(got.body.frozen).toBe(true);
    expect((await bookingRow(id)).status).toBe("accepted");
    expect((await flagOf(id))?.reason).toBe("chef_rejected");
  });
});

describe("T-082: the booking lists say which bookings are frozen", () => {
  const frozenOf = (
    r: { body: { items: { id: string; frozen: boolean }[] } },
    id: string,
  ) => r.body.items.find((i) => i.id === id)?.frozen;

  it("a frozen booking shows frozen: true in both lists, an unflagged one false, and a stranger never sees the row", async () => {
    const a = await setup(); // will be frozen
    const b = await setup(); // untouched
    await reject(a.chef.id);
    const custList = await listBookings(a.cust.b);
    const chefList = await listBookings(a.chef.b);
    expect(custList.status, custList.text).toBe(200);
    expect(chefList.status, chefList.text).toBe(200);
    expect(frozenOf(custList, a.id)).toBe(true);
    expect(frozenOf(chefList, a.id)).toBe(true);
    const other = await listBookings(b.cust.b);
    expect(frozenOf(other, b.id)).toBe(false);
    expect(frozenOf(await listBookings(b.chef.b), b.id)).toBe(false);
    // The stranger's list does not hold the row at all.
    const stranger = await bookingCustomer();
    const sl = await listBookings(stranger.b);
    expect(sl.status).toBe(200);
    expect(sl.body.items.map((i: { id: string }) => i.id)).not.toContain(a.id);
    // Only the neutral flag: nothing about why (no reason, no notes) in the list.
    const row = custList.body.items.find((i: { id: string }) => i.id === a.id);
    expect(Object.keys(row)).not.toContain("flag");
    expect(Object.keys(row)).not.toContain("reason");
    expect(Object.keys(row)).not.toContain("notes");
  });

  it("no_day_cooked does not freeze the list row (D-57)", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 5);
    await getBooking(cust.b, id); // lazy sweep raises the no_day_cooked flag
    expect((await flagOf(id))?.reason).toBe("no_day_cooked");
    expect(frozenOf(await listBookings(cust.b), id)).toBe(false);
    expect(frozenOf(await listBookings(chef.b), id)).toBe(false);
  });

  it("one customer page mixes frozen and unfrozen rows, and the flag follows each row across a page boundary", async () => {
    const cust = await bookingCustomer();
    const frozenChef = await bookableChef({
      dishes: [{ key: "pho", shelf: 2 }],
    });
    const okChef = await bookableChef({ dishes: [{ key: "pho", shelf: 2 }] });
    const one = await bookOk(
      cust,
      bookingBody(frozenChef, { days: [dayBody(frozenChef, 3)] }),
    );
    expect((await accept(frozenChef.b, one.id)).status).toBe(200);
    const two = await bookOk(
      cust,
      bookingBody(okChef, { days: [dayBody(okChef, 4)] }),
    );
    expect((await accept(okChef.b, two.id)).status).toBe(200);
    await reject(frozenChef.id);
    // Both on one page.
    const all = await listBookings(cust.b, "limit=50");
    expect(all.status, all.text).toBe(200);
    expect(frozenOf(all, one.id)).toBe(true);
    expect(frozenOf(all, two.id)).toBe(false);
    // One row per page: each page carries its own row's flag.
    const p1 = await listBookings(cust.b, "limit=1");
    expect(p1.body.items).toHaveLength(1);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await listBookings(
      cust.b,
      `limit=1&cursor=${encodeURIComponent(p1.body.nextCursor)}`,
    );
    expect(p2.body.items).toHaveLength(1);
    const seen = [...p1.body.items, ...p2.body.items] as {
      id: string;
      frozen: boolean;
    }[];
    expect(seen.map((i) => i.id).sort()).toEqual([one.id, two.id].sort());
    for (const i of seen) expect(i.frozen).toBe(i.id === one.id);
  });

  it("the status filter keeps the flag: a frozen accepted booking under status=open", async () => {
    const { chef, cust, id } = await setup();
    await reject(chef.id);
    const r = await listBookings(cust.b, "status=open");
    expect(frozenOf(r, id)).toBe(true);
  });

  it("an empty list still answers 200", async () => {
    const lonely = await bookingCustomer();
    const r = await listBookings(lonely.b);
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
  });
});

describe("D-57: no_day_cooked does not freeze", () => {
  it("frozen stays false, the chef marks the day, and the next call completes it and resolves the flag", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 5);
    const first = await getBooking(cust.b, id); // lazy sweep flags it
    expect(first.body.status).toBe("accepted");
    expect(first.body.frozen).toBe(false);
    expect((await flagOf(id))?.reason).toBe("no_day_cooked");

    expect((await cooked(chef.b, id, 1)).status).toBe(200);
    // Every visit is long over, so the next lazy sweep completes the booking (D-33) and resolves the flag.
    const done = await getBooking(cust.b, id);
    expect(done.body.status).toBe("completed");
    const f = await flagOf(id);
    expect(f?.reason).toBe("no_day_cooked");
    expect(f?.resolved_at).not.toBeNull();
    // ...and a manual "visit done" after that is simply refused: it is completed already.
    expect((await complete(chef.b, id)).status).toBe(409);
  });

  it("rejecting the chef afterwards freezes the flagged booking", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 5);
    await getBooking(cust.b, id);
    expect((await getBooking(cust.b, id)).body.frozen).toBe(false);
    await reject(chef.id);
    expect((await flagOf(id))?.reason).toBe("chef_rejected");
    expect((await getBooking(cust.b, id)).body.frozen).toBe(true);
    const r = await cooked(chef.b, id, 1);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("frozen");
  });
});
