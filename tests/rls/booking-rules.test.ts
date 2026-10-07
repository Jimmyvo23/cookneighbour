import { describe, expect, inject, it } from "vitest";
import {
  dayPlus,
  expectCode,
  makeBooking,
  makeChef,
  makeCustomer,
  makeUser,
  rand,
  serviceClient,
} from "./helpers";

const fx = inject("fx");
const svc = serviceClient();
// Tests use day offsets from 10 up; fixtures use 0..9.
const day = (n: number) => dayPlus(fx.baseDay, 10 + n);

describe("double booking (CLAUDE.md section 10)", () => {
  it("blocks a second booking for the same chef and date, but allows other chefs and other dates", async () => {
    const a = await makeCustomer(svc, "dbl-a");
    const c = await makeCustomer(svc, "dbl-b");
    const chef = await makeChef(svc, "dbl-chef");
    const other = await makeChef(svc, "dbl-chef2");
    await makeBooking(svc, { customer: a, chef, dates: [day(1)] });
    await expect(
      makeBooking(svc, { customer: c, chef, dates: [day(1)] }),
    ).rejects.toThrow(/duplicate key|booking_days_one_per_chef_date/);
    // controls: same date with another chef, same chef another date
    await expect(
      makeBooking(svc, { customer: c, chef: other, dates: [day(1)] }),
    ).resolves.toBeTruthy();
    await expect(
      makeBooking(svc, { customer: c, chef, dates: [day(2)] }),
    ).resolves.toBeTruthy();
  });

  it("a multi-day booking collides on any of its days", async () => {
    const a = await makeCustomer(svc, "multi-a");
    const c = await makeCustomer(svc, "multi-b");
    const chef = await makeChef(svc, "multi-chef");
    await makeBooking(svc, {
      customer: a,
      chef,
      dates: [day(3), day(4), day(5)],
    });
    await expect(
      makeBooking(svc, { customer: c, chef, dates: [day(6), day(5)] }),
    ).rejects.toThrow(/duplicate key/);
  });

  it("cancelling or declining frees the date; completed and no-show keep it", async () => {
    const a = await makeCustomer(svc, "free-a");
    const c = await makeCustomer(svc, "free-b");
    const chef = await makeChef(svc, "free-chef");
    const first = await makeBooking(svc, {
      customer: a,
      chef,
      dates: [day(10)],
    });
    await expect(
      makeBooking(svc, { customer: c, chef, dates: [day(10)] }),
    ).rejects.toThrow(/duplicate key/);
    const upd = await svc
      .from("bookings")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", first.id);
    expect(upd.error).toBeNull();
    await expect(
      makeBooking(svc, { customer: c, chef, dates: [day(10)] }),
    ).resolves.toBeTruthy();

    const d = await makeBooking(svc, { customer: a, chef, dates: [day(11)] });
    expect(
      (await svc.from("bookings").update({ status: "declined" }).eq("id", d.id))
        .error,
    ).toBeNull();
    await expect(
      makeBooking(svc, { customer: c, chef, dates: [day(11)] }),
    ).resolves.toBeTruthy();

    for (const [i, status] of (
      ["completed", "no_show_customer", "no_show_chef", "accepted"] as const
    ).entries()) {
      const date = day(12 + i);
      await makeBooking(svc, { customer: a, chef, dates: [date], status });
      await expect(
        makeBooking(svc, { customer: c, chef, dates: [date] }),
        status,
      ).rejects.toThrow(/duplicate key/);
    }
  });
});

describe("booking validity rules enforced by the database", () => {
  it("rejects past dates, a 4th day, and a repeated date inside one booking", async () => {
    const cust = await makeCustomer(svc, "val-a");
    const chef = await makeChef(svc, "val-chef");
    const past = dayPlus(new Date().toISOString().slice(0, 10), -5);
    await expect(
      makeBooking(svc, { customer: cust, chef, dates: [past] }),
    ).rejects.toThrow(/in the past/);
    await expect(
      makeBooking(svc, {
        customer: cust,
        chef,
        dates: [day(20), day(21), day(22), day(23)],
      }),
    ).rejects.toThrow(/day_number|check constraint/);
    await expect(
      makeBooking(svc, { customer: cust, chef, dates: [day(24), day(24)] }),
    ).rejects.toThrow(/duplicate key/);
    // control: 3 distinct future days is fine
    await expect(
      makeBooking(svc, {
        customer: cust,
        chef,
        dates: [day(25), day(26), day(27)],
      }),
    ).resolves.toBeTruthy();
  });

  it("only approved chefs can be booked (pending and rejected blocked)", async () => {
    const cust = await makeCustomer(svc, "appr-a");
    await expect(
      makeBooking(svc, { customer: cust, chef: fx.hp, dates: [day(30)] }),
    ).rejects.toThrow(/not approved/);
    await expect(
      makeBooking(svc, { customer: cust, chef: fx.hr, dates: [day(30)] }),
    ).rejects.toThrow(/not approved/);
    await expect(
      makeBooking(svc, { customer: cust, chef: fx.h2, dates: [day(30)] }),
    ).resolves.toBeTruthy();
  });

  it("chef's-home bookings need an offering chef whose kitchen was enabled, and carry no travel fee", async () => {
    const cust = await makeCustomer(svc, "loc-a");
    const customerHomeOnly = await makeChef(svc, "loc-home-only", {
      options: ["customer_home"],
    });
    const notEnabled = await makeChef(svc, "loc-not-enabled", {
      options: ["customer_home", "chef_home"],
      chefHomeEnabled: false,
    });
    const enabled = await makeChef(svc, "loc-enabled", {
      options: ["customer_home", "chef_home"],
      chefHomeEnabled: true,
    });
    await expect(
      makeBooking(svc, {
        customer: cust,
        chef: customerHomeOnly,
        dates: [day(31)],
        location: "chef_home",
      }),
    ).rejects.toThrow(/does not offer/);
    await expect(
      makeBooking(svc, {
        customer: cust,
        chef: notEnabled,
        dates: [day(31)],
        location: "chef_home",
      }),
    ).rejects.toThrow(/not enabled/);
    await expect(
      makeBooking(svc, {
        customer: cust,
        chef: enabled,
        dates: [day(31)],
        location: "chef_home",
        travelCents: 500,
      }),
    ).rejects.toThrow(/chef_home_no_travel|check constraint/);
    // controls
    await expect(
      makeBooking(svc, {
        customer: cust,
        chef: enabled,
        dates: [day(31)],
        location: "chef_home",
      }),
    ).resolves.toBeTruthy();
    await expect(
      makeBooking(svc, {
        customer: cust,
        chef: customerHomeOnly,
        dates: [day(31)],
        location: "customer_home",
        travelCents: 500,
      }),
    ).resolves.toBeTruthy();
  });

  it("only customers can book, and nobody can book themselves", async () => {
    const chef = await makeChef(svc, "role-chef");
    const admin = await makeUser(svc, "admin", "role-admin");
    await expect(
      makeBooking(svc, { customer: admin, chef, dates: [day(32)] }),
    ).rejects.toThrow(/only customers/);
    await expect(
      makeBooking(svc, { customer: chef, chef, dates: [day(32)] }),
    ).rejects.toThrow(/only customers|bookings_not_self/);
    const cust = await makeCustomer(svc, "role-a");
    await expect(
      makeBooking(svc, { customer: cust, chef, dates: [day(32)] }),
    ).resolves.toBeTruthy();
  });
});

describe("free trial uniqueness (CLAUDE.md 6.6)", () => {
  async function claim(
    customer: { id: string },
    hashes: { phone: string; address: string },
    date: string,
    chefName = "ft-chef",
  ) {
    const chef = await ftChef(chefName);
    const booking = await makeBooking(svc, {
      customer: { id: customer.id, email: "" },
      chef,
      dates: [date],
    });
    return svc
      .from("free_trial_claims")
      .insert({
        customer_id: customer.id,
        booking_id: booking.id,
        phone_hash: hashes.phone,
        address_hash: hashes.address,
      })
      .select("id")
      .single();
  }
  // one chef per test file run is enough; cache by name
  const chefs = new Map<string, Awaited<ReturnType<typeof makeChef>>>();
  async function ftChef(name: string) {
    if (!chefs.has(name)) chefs.set(name, await makeChef(svc, name));
    return chefs.get(name)!;
  }
  const fresh = () => ({ phone: `ph-${rand()}`, address: `ah-${rand()}` });

  it("blocks a second claim by the same customer, same phone hash, or same address hash", async () => {
    const a = await makeCustomer(svc, "ft-a");
    const b = await makeCustomer(svc, "ft-b");
    const h = fresh();
    const first = await claim(a, h, day(40));
    expect(first.error).toBeNull(); // allowed control
    expectCode(
      await claim(a, fresh(), day(41)),
      "23505",
      "free_trial_one_per_customer",
    );
    expectCode(
      await claim(b, { phone: h.phone, address: `ah-${rand()}` }, day(42)),
      "23505",
      "free_trial_one_per_phone",
    );
    expectCode(
      await claim(b, { phone: `ph-${rand()}`, address: h.address }, day(43)),
      "23505",
      "free_trial_one_per_address",
    );
    // control: a genuinely new customer with new hashes is fine
    expect((await claim(b, fresh(), day(44))).error).toBeNull();
  });

  it("a released claim (booking cancelled before it happened) frees phone, address and customer", async () => {
    const a = await makeCustomer(svc, "ftr-a");
    const b = await makeCustomer(svc, "ftr-b");
    const h = fresh();
    const first = await claim(a, h, day(45));
    expect(first.error).toBeNull();
    expectCode(await claim(b, h, day(46)), "23505");
    const rel = await svc
      .from("free_trial_claims")
      .update({ state: "released" })
      .eq("id", (first.data as { id: string }).id);
    expect(rel.error).toBeNull();
    expect((await claim(b, h, day(47))).error).toBeNull(); // same hashes now allowed
    expect((await claim(a, fresh(), day(48))).error).toBeNull(); // original customer may try again
  });

  it("consumed and held claims both keep blocking", async () => {
    const a = await makeCustomer(svc, "ftc-a");
    const b = await makeCustomer(svc, "ftc-b");
    const h = fresh();
    const first = await claim(a, h, day(49));
    expect(first.error).toBeNull();
    await svc
      .from("free_trial_claims")
      .update({ state: "consumed" })
      .eq("id", (first.data as { id: string }).id);
    expectCode(await claim(b, h, day(50)), "23505");
  });

  it("a second account for the same person (new customer id, same phone hash) is blocked", async () => {
    const a = await makeCustomer(svc, "ftn-a");
    const newAccount = await makeCustomer(svc, "ftn-a2");
    const h = fresh();
    expect((await claim(a, h, day(51))).error).toBeNull();
    expectCode(
      await claim(
        newAccount,
        { phone: h.phone, address: `ah-${rand()}` },
        day(52),
      ),
      "23505",
    );
  });
});
