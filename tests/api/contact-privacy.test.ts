// T-065: contact privacy against the LOCAL Supabase (contract 7A and 11; decisions D-52, D-56,
// T-063 review M4 / L4). Every chef and customer is new, so no other file shares these bookings.
// There is no clock to move, so tests shift a booking's visit dates into the past.
import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import {
  accept,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  cancel,
  day,
  getBooking,
  setChef,
  shiftDays,
  svc,
} from "./booking-helpers";
import { patchApp } from "./chef-helpers";

beforeEach(() => freshLimits());

const kitchen = (line: string) => ({
  kitchenAddress: { line, city: "Mississauga", postalCode: "L5B 1A1" },
});

async function acceptedBooking(home: boolean) {
  const chef = await bookableChef({
    options: home ? ["customer_home", "chef_home"] : ["customer_home"],
    homeEnabled: home,
  });
  if (home) {
    const first = await chef.b.call(patchApp, {
      method: "PATCH",
      body: kitchen("1 Snapshot Street"),
    });
    expect(first.status, first.text).toBe(200);
    await setChef(chef.id, { chef_home_enabled: true });
  }
  const cust = await bookingCustomer();
  const b = await bookOk(
    cust,
    bookingBody(chef, {
      ...(home ? { locationType: "chef_home", address: undefined } : {}),
      days: [
        {
          date: day(5),
          dishes: [{ dishId: chef.dishes.pho, quantity: 1 }],
        },
      ],
    }),
  );
  expect((await accept(chef.b, b.id)).status).toBe(200);
  return { chef, cust, id: b.id };
}

const finish = async (id: string, status = "completed") => {
  const r = await svc.from("bookings").update({ status }).eq("id", id);
  expect(r.error).toBeNull();
};

describe("kitchen address snapshot (T-063 review M4)", () => {
  it("the customer keeps seeing the address given at acceptance after the chef moves", async () => {
    const { chef, cust, id } = await acceptedBooking(true);
    const snap = await svc
      .from("booking_kitchen_addresses")
      .select("address_line")
      .eq("booking_id", id);
    expect(snap.data).toEqual([{ address_line: "1 Snapshot Street" }]);

    await finish(id);
    const moved = await chef.b.call(patchApp, {
      method: "PATCH",
      body: kitchen("2 New Street"),
    });
    expect(moved.status, moved.text).toBe(200);

    const r = await getBooking(cust.b, id);
    expect(r.status).toBe(200);
    expect(r.body.cookingPlace).toMatchObject({ line: "1 Snapshot Street" });
    expect(JSON.stringify(r.body)).not.toContain("2 New Street");
  });

  it("a cancelled booking returns no address even though a snapshot exists", async () => {
    const { cust, id } = await acceptedBooking(true);
    expect((await cancel(cust.b, id)).status).toBe(200);
    const r = await getBooking(cust.b, id);
    expect(r.body.cookingPlace).toBeNull();
    expect(r.body.contact).toBeNull();
    expect(r.body.contactVisibleUntil).toBeNull();
  });
});

describe("D-52: contact hides 7 days after the last visit day", () => {
  it("shows until the end of last day + 7 and hides after, for both parties", async () => {
    const { chef, cust, id } = await acceptedBooking(false);
    await finish(id);

    await shiftDays(id, 5 + 7); // last visit day = 7 days ago: still visible
    for (const b of [cust.b, chef.b]) {
      const r = await getBooking(b, id);
      expect(r.body.contact, r.text).not.toBeNull();
      expect(typeof r.body.contactVisibleUntil).toBe("string");
    }
    const mine = await getBooking(chef.b, id);
    expect(mine.body.cookingPlace).not.toBeNull(); // customer's cooking address, for the chef

    await shiftDays(id, 1); // 8 days ago: hidden again
    for (const b of [cust.b, chef.b]) {
      const r = await getBooking(b, id);
      expect(r.status).toBe(200);
      expect(r.body.contact).toBeNull();
      expect(r.body.contactVisibleUntil).toBeNull();
    }
    const after = await getBooking(chef.b, id);
    expect(after.body.cookingPlace).toBeNull();
    // The customer still sees their own cooking address (it is theirs).
    const own = await getBooking(cust.b, id);
    expect(own.body.cookingPlace).not.toBeNull();
  });

  it("applies to both no-show statuses too", async () => {
    for (const status of ["no_show_customer", "no_show_chef"]) {
      const { cust, id } = await acceptedBooking(false);
      await finish(id, status);
      await shiftDays(id, 5 + 8);
      const r = await getBooking(cust.b, id);
      expect(r.body.contact, status).toBeNull();
    }
  });
});

describe("D-56: a cancelled booking locks contact at once", () => {
  it("hides contact right after the cancel even though the window is still open", async () => {
    const { chef, cust, id } = await acceptedBooking(false);
    expect((await getBooking(chef.b, id)).body.contact).not.toBeNull();
    expect((await cancel(cust.b, id)).status).toBe(200);
    for (const b of [cust.b, chef.b]) {
      const r = await getBooking(b, id);
      expect(r.body.contact).toBeNull();
      expect(r.body.contactVisibleUntil).toBeNull();
    }
  });
});
