// T-074: database side of the T-065 follow-ups (migration 20261016100000).
// - D-58: kitchen photos follow the D-52 window (storage policy -> can_view_kitchen_photos);
// - D-59: accept is refused when chef's home is on but no kitchen address is saved;
// - T-065 review L1: set_chef_kitchen_address writes the chefs columns in the same transaction.
// Dates here use offsets around today and 300+ days ahead, which no other file uses.
import { describe, expect, inject, it } from "vitest";
import {
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
const accept = (booking: string, chef: string) =>
  svc.rpc("answer_booking", {
    p_booking: booking,
    p_chef: chef,
    p_action: "accept",
    p_reason: null,
  });

describe("D-58: kitchen photos follow the D-52 window", () => {
  async function setup(
    name: string,
    lastDayOffset: number,
    status: string,
    location: "chef_home" | "customer_home" = "chef_home",
  ) {
    const chef = await homeChef(name);
    const cust = await makeCustomer(svc, name + "-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      // The insert trigger refuses past dates; move the day afterwards (an update is allowed).
      dates: [dayPlus(todayTo, Math.max(lastDayOffset, 1))],
      status,
      location,
    });
    const mv = await svc
      .from("booking_days")
      .update({ visit_date: dayPlus(todayTo, lastDayOffset) })
      .eq("booking_id", b.id);
    expect(mv.error).toBeNull();
    const path = `${chef.id}/k-${rand(6)}.png`;
    const up = await svc.storage
      .from("kitchen-photos")
      .upload(path, png(), { contentType: "image/png" });
    expect(up.error).toBeNull();
    const c = await clientFor(cust);
    const dl = async () => {
      const r = await c.storage.from("kitchen-photos").download(path);
      return !r.error && !!r.data;
    };
    const can = async () =>
      (await c.rpc("can_view_kitchen_photos", { p_chef: chef.id })).data;
    return { chef, cust, b, dl, can };
  }

  it("an accepted chef's-home booking shows the photos until 00:00 Toronto on last day + 8", async () => {
    // Last visit day 7 days ago: still open until tomorrow 00:00 Toronto.
    const open = await setup("k58-open", -7, "accepted");
    expect(await open.can()).toBe(true);
    expect(await open.dl()).toBe(true);
    // Last visit day 8 days ago: the window ended at 00:00 today.
    const shut = await setup("k58-shut", -8, "accepted");
    expect(await shut.can()).toBe(false);
    expect(await shut.dl()).toBe(false);
  });

  it("a completed booking follows the same window", async () => {
    const open = await setup("k58-done-open", -3, "completed");
    expect(await open.dl()).toBe(true);
    const shut = await setup("k58-done-shut", -20, "completed");
    expect(await shut.dl()).toBe(false);
  });

  it("a cancelled booking locks the photos at once (D-56), even inside the window", async () => {
    const s = await setup("k58-cancel", 5, "cancelled");
    expect(await s.can()).toBe(false);
    expect(await s.dl()).toBe(false);
  });

  it("requested bookings and customer's-home bookings never show them", async () => {
    const req = await setup("k58-req", 5, "requested");
    expect(await req.dl()).toBe(false);
    const ch = await setup("k58-ch", 5, "accepted", "customer_home");
    expect(await ch.dl()).toBe(false);
  });

  it("another customer never sees them", async () => {
    const s = await setup("k58-other", 5, "accepted");
    const other = await clientFor(await makeCustomer(svc, "k58-other2"));
    expect(
      (await other.rpc("can_view_kitchen_photos", { p_chef: s.chef.id })).data,
    ).toBe(false);
  });
});

describe("D-59: accept needs a saved kitchen address", () => {
  const clear = (chef: string, patch: Record<string, string | null>) =>
    svc.from("chef_private").update(patch).eq("chef_id", chef);

  it.each([
    ["no address line", { kitchen_address_line: null }],
    ["no city", { kitchen_city: null }],
    ["no postal code", { kitchen_postal_code: null }],
  ])(
    "%s: refused, booking stays requested, nothing copied; decline works",
    async (label, patch) => {
      const chef = await homeChef("k59-" + label.replace(/\W/g, ""));
      const cust = await makeCustomer(svc, "k59-cust-" + rand(4));
      const b = await makeBooking(svc, {
        customer: cust,
        chef,
        dates: [dayPlus(todayTo, 300 + Math.floor(Math.random() * 40))],
        location: "chef_home",
      });
      expect((await clear(chef.id, patch)).error).toBeNull();

      const r = await accept(b.id, chef.id);
      expect(r.error).toBeNull();
      expect(r.data).toEqual({ result: "kitchen_address_missing" });
      const row = await svc
        .from("bookings")
        .select("status")
        .eq("id", b.id)
        .single();
      expect(row.data?.status).toBe("requested");
      const snap = await svc
        .from("booking_kitchen_addresses")
        .select("booking_id")
        .eq("booking_id", b.id);
      expect(snap.data).toEqual([]);

      const d = await svc.rpc("answer_booking", {
        p_booking: b.id,
        p_chef: chef.id,
        p_action: "decline",
        p_reason: "No kitchen address",
      });
      expect(d.data).toMatchObject({ result: "ok", status: "declined" });
    },
  );

  it("with the address saved the accept works; customer's-home accept needs no address", async () => {
    const chef = await homeChef("k59-ok");
    const cust = await makeCustomer(svc, "k59-ok-cust");
    const home = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [dayPlus(todayTo, 360)],
      location: "chef_home",
    });
    expect((await accept(home.id, chef.id)).data).toMatchObject({
      result: "ok",
    });
    // Same chef, no address, customer's-home booking: unaffected by D-59.
    await svc
      .from("chef_private")
      .update({ kitchen_address_line: null })
      .eq("chef_id", chef.id);
    const away = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [dayPlus(todayTo, 362)],
      location: "customer_home",
    });
    expect((await accept(away.id, chef.id)).data).toMatchObject({
      result: "ok",
    });
  });
});

describe("T-065 review L1: set_chef_kitchen_address writes both tables in one transaction", () => {
  const stamp = async (chef: string) =>
    (
      await svc
        .from("chef_private")
        .select("updated_at")
        .eq("chef_id", chef)
        .single()
    ).data!.updated_at as string;
  const call = (
    chef: string,
    t: string,
    line: string,
    cols: Record<string, unknown>,
  ) =>
    svc.rpc("set_chef_kitchen_address", {
      p_chef: chef,
      p_expected_updated_at: t,
      p_line: line,
      p_city: "Mississauga",
      p_postal: "L5B1A1",
      p_kitchen_status: null,
      p_allergen_ack_at: null,
      p_hygiene_ack_at: null,
      p_chef_columns: cols,
    });
  const chefRow = async (id: string) =>
    (await svc.from("chefs").select("*").eq("profile_id", id).single()).data!;
  const addr = async (id: string) =>
    (
      await svc
        .from("chef_private")
        .select("kitchen_address_line")
        .eq("chef_id", id)
        .single()
    ).data!.kitchen_address_line;

  it("writes the address, the chefs columns and switches chef's home off together", async () => {
    const chef = await homeChef("l1-ok");
    const r = await call(chef.id, await stamp(chef.id), "5 New Street", {
      bio: "New bio",
      cuisines: ["Thai", "Lao"],
      hourly_rate_cents: 4100,
      service_radius_km: 9,
      location_options: ["customer_home"],
    });
    expect(r.data).toEqual({ result: "ok" });
    const c = await chefRow(chef.id);
    expect(c).toMatchObject({
      bio: "New bio",
      cuisines: ["Thai", "Lao"],
      hourly_rate_cents: 4100,
      service_radius_km: 9,
      location_options: ["customer_home"],
      chef_home_enabled: false,
    });
    expect(await addr(chef.id)).toBe("5 New Street");
  });

  it("a failure in the chefs write rolls the address back (one transaction)", async () => {
    const chef = await homeChef("l1-rollback");
    const before = await chefRow(chef.id);
    // hourly_rate_cents must be > 0: the chefs update fails after chef_private was updated.
    const r = await call(chef.id, await stamp(chef.id), "6 Bad Street", {
      hourly_rate_cents: -5,
    });
    expect(r.error).not.toBeNull();
    expect(await addr(chef.id)).toBe("12 Kitchen Lane");
    const after = await chefRow(chef.id);
    expect(after.chef_home_enabled).toBe(true);
    expect(after.hourly_rate_cents).toBe(before.hourly_rate_cents);
  });

  it("conflict and kitchen_in_use leave the chefs columns alone", async () => {
    const chef = await homeChef("l1-refuse");
    const old = await stamp(chef.id);
    const cust = await makeCustomer(svc, "l1-refuse-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [dayPlus(todayTo, 365)],
      location: "chef_home",
    });
    expect((await accept(b.id, chef.id)).data).toMatchObject({ result: "ok" });
    const inUse = await call(chef.id, await stamp(chef.id), "7 Nope", {
      bio: "Should not be saved",
    });
    expect(inUse.data).toEqual({ result: "kitchen_in_use" });
    const stale = await call(chef.id, "2000-01-01T00:00:00Z", "7 Nope", {
      bio: "Should not be saved",
    });
    expect(stale.data).toEqual({ result: "conflict" });
    expect(old).not.toBe("2000-01-01T00:00:00Z");
    const c = await chefRow(chef.id);
    expect(c.bio).not.toBe("Should not be saved");
    expect(c.chef_home_enabled).toBe(true);
    expect(await addr(chef.id)).toBe("12 Kitchen Lane");
  });

  it("refuses any chefs column outside the whitelist", async () => {
    const chef = await homeChef("l1-key");
    for (const key of ["status", "rating_avg", "chef_home_enabled"]) {
      const r = await call(chef.id, await stamp(chef.id), "8 Key St", {
        [key]: key === "status" ? "approved" : 5,
      });
      expect(r.error, key).not.toBeNull();
    }
    expect(await addr(chef.id)).toBe("12 Kitchen Lane");
  });
});
