// T-074 tester additions (API): D-59 check order and scope, and the kitchen PATCH (L1) around
// the edges: only non-kitchen fields, several kitchen fields at once, the same call twice.
import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import {
  accept,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  bookingRow,
  day,
  getBooking,
} from "./booking-helpers";
import { patchApp, privRow, chefRow, setChef, setPriv } from "./chef-helpers";

beforeEach(() => freshLimits());

async function homeRequest(offset: number) {
  const chef = await bookableChef({
    options: ["customer_home", "chef_home"],
    homeEnabled: true,
  });
  const cust = await bookingCustomer();
  const b = await bookOk(
    cust,
    bookingBody(chef, {
      locationType: "chef_home",
      address: undefined,
      days: [
        {
          date: day(offset),
          dishes: [{ dishId: chef.dishes.pho, quantity: 1 }],
        },
      ],
    }),
  );
  return { chef, cust, id: b.id };
}

describe("D-59 order and scope through the API", () => {
  it("chef's home switched off wins over a missing address (reason chef_home_not_enabled)", async () => {
    const { chef, id } = await homeRequest(11);
    await setPriv(chef.id, { kitchen_address_line: null });
    await setChef(chef.id, { chef_home_enabled: false });
    const r = await accept(chef.b, id);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("chef_home_not_enabled");
    expect((await bookingRow(id)).status).toBe("requested");
  });

  it("a customer's-home booking is accepted without any kitchen address", async () => {
    const chef = await bookableChef({
      options: ["customer_home", "chef_home"],
      homeEnabled: true,
      noKitchenAddress: true,
    });
    const cust = await bookingCustomer();
    const b = await bookOk(
      cust,
      bookingBody(chef, {
        days: [
          {
            date: day(12),
            dishes: [{ dishId: chef.dishes.pho, quantity: 1 }],
          },
        ],
      }),
    );
    const r = await accept(chef.b, b.id);
    expect(r.status, r.text).toBe(200);
  });

  it("the customer still sees the booking as requested after the refusal, and no contact", async () => {
    const { chef, cust, id } = await homeRequest(13);
    await setPriv(chef.id, { kitchen_postal_code: null });
    const r = await accept(chef.b, id);
    expect(r.status).toBe(409);
    const view = await getBooking(cust.b, id);
    expect(view.status).toBe(200);
    expect(view.body.status).toBe("requested");
    expect(view.body.contact ?? null).toBeNull();
  });

  it("a second accept after the refusal and a fix of the address works", async () => {
    const { chef, id } = await homeRequest(14);
    await setPriv(chef.id, { kitchen_city: null });
    expect((await accept(chef.b, id)).status).toBe(409);
    await setPriv(chef.id, { kitchen_city: "Mississauga" });
    const ok = await accept(chef.b, id);
    expect(ok.status, ok.text).toBe(200);
  });
});

describe("kitchen PATCH edges (L1)", () => {
  const kitchen = (line: string) => ({
    kitchenAddress: { line, city: "Mississauga", postalCode: "L5B 1A1" },
  });

  it("a PATCH without a kitchen address leaves chef's home and the address alone", async () => {
    const chef = await bookableChef({
      options: ["customer_home", "chef_home"],
      homeEnabled: true,
    });
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { bio: "Only the bio changed." },
    });
    expect(r.status, r.text).toBe(200);
    expect((await chefRow(chef.id)).bio).toBe("Only the bio changed.");
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(true);
    expect((await privRow(chef.id)).kitchen_address_line).toBe(
      "12 Fixture Lane",
    );
  });

  it("the same kitchen PATCH twice is fine (the second reads the new updated_at)", async () => {
    const chef = await bookableChef({
      options: ["customer_home", "chef_home"],
      homeEnabled: true,
    });
    for (const line of ["20 Twice Road", "20 Twice Road"]) {
      const r = await chef.b.call(patchApp, {
        method: "PATCH",
        body: { ...kitchen(line), bio: "Twice." },
      });
      expect(r.status, r.text).toBe(200);
    }
    expect((await privRow(chef.id)).kitchen_address_line).toBe("20 Twice Road");
    expect((await chefRow(chef.id)).bio).toBe("Twice.");
  });

  it("an invalid kitchen PATCH (bad postal code) saves neither the address nor the other fields", async () => {
    const chef = await bookableChef({
      options: ["customer_home", "chef_home"],
      homeEnabled: true,
    });
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: {
        bio: "Must not stick.",
        kitchenAddress: {
          line: "1 Bad",
          city: "Mississauga",
          postalCode: "ZZZ",
        },
      },
    });
    expect(r.status).toBe(422);
    expect((await chefRow(chef.id)).bio).not.toBe("Must not stick.");
    expect((await privRow(chef.id)).kitchen_address_line).toBe(
      "12 Fixture Lane",
    );
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(true);
  });
});
