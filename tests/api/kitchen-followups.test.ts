// T-074 against the LOCAL Supabase: D-59 (accept refused without a kitchen address) and
// T-065 review L1 (a kitchen-address PATCH changes both tables or neither).
import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import {
  accept,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  bookingRow,
  decline,
  day,
  svc,
} from "./booking-helpers";
import { patchApp, privRow, chefRow, setPriv } from "./chef-helpers";

beforeEach(() => freshLimits());

async function homeRequest(noKitchenAddress: boolean) {
  const chef = await bookableChef({
    options: ["customer_home", "chef_home"],
    homeEnabled: true,
    noKitchenAddress,
  });
  const cust = await bookingCustomer();
  const b = await bookOk(
    cust,
    bookingBody(chef, {
      locationType: "chef_home",
      address: undefined,
      days: [
        { date: day(9), dishes: [{ dishId: chef.dishes.pho, quantity: 1 }] },
      ],
    }),
  );
  return { chef, cust, id: b.id };
}

describe("D-59: accepting a chef's-home booking needs a saved kitchen address", () => {
  it("is 409 INVALID_STATE with reason kitchen_address_missing; nothing changes; decline still works", async () => {
    const { chef, id } = await homeRequest(true);
    const r = await accept(chef.b, id);
    expect(r.status, r.text).toBe(409);
    expect(r.body.error).toMatchObject({
      code: "INVALID_STATE",
      reason: "kitchen_address_missing",
    });
    expect(r.body.error.message).toMatch(/kitchen address/i);
    expect((await bookingRow(id)).status).toBe("requested");
    const snap = await svc
      .from("booking_kitchen_addresses")
      .select("booking_id")
      .eq("booking_id", id);
    expect(snap.data).toEqual([]);

    const d = await decline(chef.b, id, { reason: "No kitchen address yet." });
    expect(d.status, d.text).toBe(200);
  });

  it("with an address saved the same request is accepted", async () => {
    const { chef, id } = await homeRequest(false);
    const r = await accept(chef.b, id);
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe("accepted");
  });

  it("an address cleared after the request is refused too (checked at accept time)", async () => {
    const { chef, id } = await homeRequest(false);
    await setPriv(chef.id, { kitchen_city: null });
    const r = await accept(chef.b, id);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("kitchen_address_missing");
  });
});

describe("T-065 review L1: the kitchen PATCH is one transaction", () => {
  it("saves the address, the other fields and the chef's-home switch-off together", async () => {
    const chef = await bookableChef({
      options: ["customer_home", "chef_home"],
      homeEnabled: true,
    });
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: {
        bio: "Bio saved with the address.",
        hourlyRateCents: 3900,
        kitchenAddress: {
          line: "3 Together Road",
          city: "Mississauga",
          postalCode: "L5B 1A1",
        },
      },
    });
    expect(r.status, r.text).toBe(200);
    const c = await chefRow(chef.id);
    expect(c.bio).toBe("Bio saved with the address.");
    expect(c.hourly_rate_cents).toBe(3900);
    expect(c.chef_home_enabled).toBe(false);
    expect((await privRow(chef.id)).kitchen_address_line).toBe(
      "3 Together Road",
    );
  });

  it("a refused change (kitchen in use) saves none of the other fields", async () => {
    const { chef, id } = await homeRequest(false);
    expect((await accept(chef.b, id)).status).toBe(200);
    const before = await chefRow(chef.id);
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: {
        bio: "Must not be saved.",
        kitchenAddress: {
          line: "4 Refused Road",
          city: "Mississauga",
          postalCode: "L5B 1A1",
        },
      },
    });
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("kitchen_in_use");
    const after = await chefRow(chef.id);
    expect(after.bio).toBe(before.bio);
    expect(after.chef_home_enabled).toBe(true);
    expect((await privRow(chef.id)).kitchen_address_line).toBe(
      "12 Fixture Lane",
    );
  });
});
