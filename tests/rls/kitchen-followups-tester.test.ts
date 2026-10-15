// T-074 tester additions (database side): every booking status against the D-58 photo window,
// multi-day bookings, several bookings with one chef, strangers, D-59 check order, expiry, grants
// (N2) and extra cases for the one-transaction kitchen function (L1).
// Fresh chefs and customers per test (unique names); dates are moved after insert because the
// insert trigger refuses past dates.
import { describe, expect, inject, it } from "vitest";
import {
  anonClient,
  clientFor,
  dayPlus,
  makeBooking,
  makeChef,
  makeCustomer,
  rand,
  serviceClient,
} from "./helpers";

inject("fx");
const svc = serviceClient();
const todayTo = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
}).format(new Date());
const png = () =>
  new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
const homeChef = (name: string) =>
  makeChef(svc, name, {
    options: ["customer_home", "chef_home"],
    chefHomeEnabled: true,
  });

async function moveDays(dayIds: string[], offsets: number[]) {
  for (let i = 0; i < dayIds.length; i++) {
    const r = await svc
      .from("booking_days")
      .update({ visit_date: dayPlus(todayTo, offsets[i]) })
      .eq("id", dayIds[i]);
    expect(r.error).toBeNull();
  }
}
async function photo(chefId: string) {
  const path = `${chefId}/kt-${rand(6)}.png`;
  const up = await svc.storage
    .from("kitchen-photos")
    .upload(path, png(), { contentType: "image/png" });
  expect(up.error).toBeNull();
  return path;
}

describe("D-58 by status (last visit day 2 days ago, inside the window)", () => {
  const cases: [string, boolean][] = [
    ["accepted", true],
    ["completed", true],
    ["no_show_customer", true],
    ["no_show_chef", true],
    ["requested", false],
    ["declined", false],
    ["expired", false],
    ["cancelled", false],
  ];
  it.each(cases)("%s -> photos visible: %s", async (status, visible) => {
    const chef = await homeChef(`kt-st-${status}-${rand(3)}`);
    const cust = await makeCustomer(svc, `kt-st-c-${status}-${rand(3)}`);
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [dayPlus(todayTo, 2)],
      status,
      location: "chef_home",
    });
    await moveDays(b.dayIds, [-2]);
    const path = await photo(chef.id);
    const c = await clientFor(cust);
    const r = await c.storage.from("kitchen-photos").download(path);
    expect(!r.error && !!r.data).toBe(visible);
    expect(
      (await c.rpc("can_view_kitchen_photos", { p_chef: chef.id })).data,
    ).toBe(visible);
  });
});

describe("D-58 window shape", () => {
  it("a multi-day booking is governed by the LAST visit day", async () => {
    const chef = await homeChef("kt-multi-" + rand(3));
    const cust = await makeCustomer(svc, "kt-multi-c-" + rand(3));
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [dayPlus(todayTo, 1), dayPlus(todayTo, 2), dayPlus(todayTo, 3)],
      status: "completed",
      location: "chef_home",
    });
    // First day 10 days ago, last day 7 days ago: still open (ends tomorrow 00:00 Toronto).
    await moveDays(b.dayIds, [-10, -9, -7]);
    const c = await clientFor(cust);
    expect(
      (await c.rpc("can_view_kitchen_photos", { p_chef: chef.id })).data,
    ).toBe(true);
    // Last day 8 days ago: shut.
    await moveDays(b.dayIds, [-11, -10, -8]);
    expect(
      (await c.rpc("can_view_kitchen_photos", { p_chef: chef.id })).data,
    ).toBe(false);
  });

  it("an old booking does not hide the photos while a newer booking with the same chef is open", async () => {
    const chef = await homeChef("kt-two-" + rand(3));
    const cust = await makeCustomer(svc, "kt-two-c-" + rand(3));
    const old = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [dayPlus(todayTo, 1)],
      status: "completed",
      location: "chef_home",
    });
    await moveDays(old.dayIds, [-30]);
    const c = await clientFor(cust);
    expect(
      (await c.rpc("can_view_kitchen_photos", { p_chef: chef.id })).data,
    ).toBe(false);
    await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [dayPlus(todayTo, 4)],
      status: "accepted",
      location: "chef_home",
    });
    expect(
      (await c.rpc("can_view_kitchen_photos", { p_chef: chef.id })).data,
    ).toBe(true);
  });

  it("a booking with no days shows no photos", async () => {
    const chef = await homeChef("kt-nodays-" + rand(3));
    const cust = await makeCustomer(svc, "kt-nodays-c-" + rand(3));
    await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [],
      status: "accepted",
      location: "chef_home",
    });
    const c = await clientFor(cust);
    expect(
      (await c.rpc("can_view_kitchen_photos", { p_chef: chef.id })).data,
    ).toBe(false);
  });

  it("the chef keeps their own photos after the window; a customer of another chef and anon get nothing", async () => {
    const chef = await homeChef("kt-own-" + rand(3));
    const cust = await makeCustomer(svc, "kt-own-c-" + rand(3));
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [dayPlus(todayTo, 1)],
      status: "completed",
      location: "chef_home",
    });
    await moveDays(b.dayIds, [-40]);
    const path = await photo(chef.id);
    const own = await (
      await clientFor(chef)
    ).storage
      .from("kitchen-photos")
      .download(path);
    expect(own.error).toBeNull();
    expect(own.data).toBeTruthy();

    // A customer with an open booking with a DIFFERENT chef cannot read this chef's photo.
    const other = await homeChef("kt-own-other-" + rand(3));
    const oc = await makeCustomer(svc, "kt-own-oc-" + rand(3));
    await makeBooking(svc, {
      customer: oc,
      chef: other,
      dates: [dayPlus(todayTo, 3)],
      status: "accepted",
      location: "chef_home",
    });
    const r = await (
      await clientFor(oc)
    ).storage
      .from("kitchen-photos")
      .download(path);
    expect(!r.error && !!r.data).toBe(false);

    const an = await anonClient().storage.from("kitchen-photos").download(path);
    expect(!an.error && !!an.data).toBe(false);
  });
});

describe("D-59 check order and neighbours", () => {
  const accept = (booking: string, chef: string) =>
    svc.rpc("answer_booking", {
      p_booking: booking,
      p_chef: chef,
      p_action: "accept",
      p_reason: null,
    });

  async function request(name: string, enabled: boolean) {
    const chef = await homeChef(name);
    const cust = await makeCustomer(svc, name + "-c");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [dayPlus(todayTo, 200 + Math.floor(Math.random() * 90))],
      location: "chef_home",
    });
    if (!enabled)
      await svc
        .from("chefs")
        .update({ chef_home_enabled: false })
        .eq("profile_id", chef.id);
    return { chef, b };
  }

  it("chef's home off AND no address: chef_home_not_enabled wins", async () => {
    const { chef, b } = await request("kt59-both-" + rand(3), false);
    await svc
      .from("chef_private")
      .update({ kitchen_address_line: null, kitchen_city: null })
      .eq("chef_id", chef.id);
    expect((await accept(b.id, chef.id)).data).toEqual({
      result: "chef_home_not_enabled",
    });
  });

  it("an unapproved chef gets chef_not_approved, not kitchen_address_missing", async () => {
    const { chef, b } = await request("kt59-pend-" + rand(3), true);
    await svc
      .from("chef_private")
      .update({ kitchen_address_line: null })
      .eq("chef_id", chef.id);
    await svc
      .from("chefs")
      .update({ status: "pending" })
      .eq("profile_id", chef.id);
    expect((await accept(b.id, chef.id)).data).toEqual({
      result: "chef_not_approved",
    });
  });

  it("an expired request with no address is expired, not refused for the address", async () => {
    const { chef, b } = await request("kt59-exp-" + rand(3), true);
    await svc
      .from("chef_private")
      .update({ kitchen_address_line: null })
      .eq("chef_id", chef.id);
    await svc
      .from("bookings")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", b.id);
    expect((await accept(b.id, chef.id)).data).toEqual({ result: "expired" });
  });

  it("an already answered booking stays invalid_state (no address check)", async () => {
    const { chef, b } = await request("kt59-done-" + rand(3), true);
    expect((await accept(b.id, chef.id)).data).toMatchObject({ result: "ok" });
    await svc
      .from("chef_private")
      .update({ kitchen_address_line: null })
      .eq("chef_id", chef.id);
    expect((await accept(b.id, chef.id)).data).toMatchObject({
      result: "invalid_state",
      status: "accepted",
    });
  });

  it("the snapshot holds the address as it was at acceptance", async () => {
    const { chef, b } = await request("kt59-snap-" + rand(3), true);
    expect((await accept(b.id, chef.id)).data).toMatchObject({ result: "ok" });
    const s = await svc
      .from("booking_kitchen_addresses")
      .select("address_line, city, postal_code")
      .eq("booking_id", b.id)
      .single();
    expect(s.data).toEqual({
      address_line: "12 Kitchen Lane",
      city: "Mississauga",
      postal_code: "L5B1A1",
    });
  });
});

describe("N2 and grants", () => {
  it("clients cannot read or write booking_kitchen_addresses", async () => {
    const chef = await homeChef("kt-n2-" + rand(3));
    const cust = await makeCustomer(svc, "kt-n2-c-" + rand(3));
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [dayPlus(todayTo, 5)],
      status: "accepted",
      location: "chef_home",
    });
    await svc.from("booking_kitchen_addresses").insert({
      booking_id: b.id,
      address_line: "x",
      city: "y",
      postal_code: "L5B1A1",
    });
    for (const client of [
      anonClient(),
      await clientFor(cust),
      await clientFor(chef),
    ]) {
      const sel = await client.from("booking_kitchen_addresses").select("*");
      expect(sel.error !== null || (sel.data ?? []).length === 0).toBe(true);
      const ins = await client.from("booking_kitchen_addresses").insert({
        booking_id: b.id,
        address_line: "z",
        city: "y",
        postal_code: "L5B1A1",
      });
      expect(ins.error).not.toBeNull();
    }
  });

  it("clients cannot call set_chef_kitchen_address", async () => {
    const chef = await homeChef("kt-gr-" + rand(3));
    const args = {
      p_chef: chef.id,
      p_expected_updated_at: "2000-01-01T00:00:00Z",
      p_line: "a",
      p_city: "b",
      p_postal: "L5B1A1",
      p_kitchen_status: null,
      p_allergen_ack_at: null,
      p_hygiene_ack_at: null,
      p_chef_columns: {},
    };
    for (const client of [anonClient(), await clientFor(chef)]) {
      const r = await client.rpc("set_chef_kitchen_address", args);
      expect(r.error).not.toBeNull();
    }
  });
});

describe("L1 extra cases", () => {
  const stamp = async (chef: string) =>
    (
      await svc
        .from("chef_private")
        .select("updated_at")
        .eq("chef_id", chef)
        .single()
    ).data!.updated_at as string;
  const call = (chef: string, t: string, cols: unknown) =>
    svc.rpc("set_chef_kitchen_address", {
      p_chef: chef,
      p_expected_updated_at: t,
      p_line: "9 Extra Street",
      p_city: "Mississauga",
      p_postal: "L5B1A1",
      p_kitchen_status: null,
      p_allergen_ack_at: null,
      p_hygiene_ack_at: null,
      p_chef_columns: cols,
    });
  const chefRow = async (id: string) =>
    (await svc.from("chefs").select("*").eq("profile_id", id).single()).data!;

  it("empty or omitted columns change only the address and the switch-off", async () => {
    const chef = await homeChef("kt-l1-empty-" + rand(3));
    const before = await chefRow(chef.id);
    expect((await call(chef.id, await stamp(chef.id), {})).data).toEqual({
      result: "ok",
    });
    const mid = await chefRow(chef.id);
    expect(mid).toMatchObject({
      bio: before.bio,
      cuisines: before.cuisines,
      languages: before.languages,
      hourly_rate_cents: before.hourly_rate_cents,
      service_radius_km: before.service_radius_km,
      location_options: before.location_options,
      chef_home_enabled: false,
    });
    // SQL null (parameter omitted by the caller) behaves like {}.
    expect((await call(chef.id, await stamp(chef.id), null)).data).toEqual({
      result: "ok",
    });
  });

  it("a bad location_options value rolls the whole call back", async () => {
    const chef = await homeChef("kt-l1-loc-" + rand(3));
    const r = await call(chef.id, await stamp(chef.id), {
      bio: "Should roll back",
      location_options: ["spaceship"],
    });
    expect(r.error).not.toBeNull();
    const c = await chefRow(chef.id);
    expect(c.bio).not.toBe("Should roll back");
    expect(c.chef_home_enabled).toBe(true);
    const p = await svc
      .from("chef_private")
      .select("kitchen_address_line")
      .eq("chef_id", chef.id)
      .single();
    expect(p.data?.kitchen_address_line).toBe("12 Kitchen Lane");
  });

  it("a JSON null clears a nullable column; an unknown key mixed with good ones writes nothing", async () => {
    const chef = await homeChef("kt-l1-null-" + rand(3));
    expect(
      (await call(chef.id, await stamp(chef.id), { bio: null })).data,
    ).toEqual({ result: "ok" });
    expect((await chefRow(chef.id)).bio).toBeNull();

    const chef2 = await homeChef("kt-l1-mix-" + rand(3));
    const r = await call(chef2.id, await stamp(chef2.id), {
      bio: "Mixed",
      display_name: "Hacker",
    });
    expect(r.error).not.toBeNull();
    const c = await chefRow(chef2.id);
    expect(c.bio).not.toBe("Mixed");
    expect(c.display_name).not.toBe("Hacker");
  });

  it("an unknown chef is not_found", async () => {
    const r = await call(
      "00000000-0000-4000-8000-000000000001",
      "2000-01-01T00:00:00Z",
      {},
    );
    expect(r.data).toEqual({ result: "not_found" });
  });
});
