// T-065: the database side of contact privacy (migration 20261015100000).
// - the kitchen address is copied onto the booking at acceptance and get_booking_contact returns
//   the copy (T-063 review M4);
// - D-52 window: contact hides at 00:00 Toronto on (last visit day + 8); D-56: cancelled bookings
//   never show contact;
// - set_chef_kitchen_address (N3, review L4) is server-only, checks and writes under one lock.
import { describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  clientFor,
  dayPlus,
  expectNoRows,
  expectRows,
  makeBooking,
  makeChef,
  makeCustomer,
  serviceClient,
} from "./helpers";

inject("fx");
const svc = serviceClient();
const todayTo = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
}).format(new Date());
const far = (n: number) => dayPlus(todayTo, 40 + n);

type Contact = { address_line: string | null; visible_until: string | null };
const contactOf = async (c: SupabaseClient, booking: string) =>
  (await c.rpc("get_booking_contact", { p_booking: booking })) as {
    data: Contact[] | null;
    error: { message: string } | null;
  };

async function homeChef(name: string) {
  return makeChef(svc, name, {
    options: ["customer_home", "chef_home"],
    chefHomeEnabled: true,
  });
}
const accept = (booking: string, chef: string) =>
  svc.rpc("answer_booking", {
    p_booking: booking,
    p_chef: chef,
    p_action: "accept",
    p_reason: null,
  });

describe("kitchen address snapshot", () => {
  it("accept copies the address and get_booking_contact returns the copy, not the current address", async () => {
    const chef = await homeChef("cp-snap-chef");
    const cust = await makeCustomer(svc, "cp-snap-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [far(1)],
      location: "chef_home",
    });
    // Before acceptance: nothing copied, nothing returned.
    const pre = await svc
      .from("booking_kitchen_addresses")
      .select("address_line")
      .eq("booking_id", b.id);
    expect(pre.data).toEqual([]);

    const a = await accept(b.id, chef.id);
    expect(a.data).toMatchObject({ result: "ok", status: "accepted" });

    await svc
      .from("chef_private")
      .update({ kitchen_address_line: "99 Moved Road" })
      .eq("chef_id", chef.id);

    const res = await contactOf(await clientFor(cust), b.id);
    expect(res.error).toBeNull();
    expect(res.data?.[0].address_line).toBe("12 Kitchen Lane");
  });

  it("nobody can read the snapshot table directly", async () => {
    const chef = await homeChef("cp-tbl-chef");
    const cust = await makeCustomer(svc, "cp-tbl-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [far(2)],
      location: "chef_home",
    });
    await accept(b.id, chef.id);
    for (const c of [
      anonClient(),
      await clientFor(cust),
      await clientFor(chef),
    ])
      expectNoRows(
        await c
          .from("booking_kitchen_addresses")
          .select("address_line")
          .eq("booking_id", b.id),
      );
  });

  it("accept without a kitchen address is refused (D-59, T-074) and copies nothing", async () => {
    const chef = await homeChef("cp-noaddr-chef");
    const cust = await makeCustomer(svc, "cp-noaddr-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [far(3)],
      location: "chef_home",
    });
    await svc
      .from("chef_private")
      .update({ kitchen_address_line: null })
      .eq("chef_id", chef.id);
    const a = await accept(b.id, chef.id);
    expect(a.data).toEqual({ result: "kitchen_address_missing" });
    const snap = await svc
      .from("booking_kitchen_addresses")
      .select("address_line")
      .eq("booking_id", b.id);
    expect(snap.data).toEqual([]);
  });
});

describe("D-52 window and D-56", () => {
  async function accepted(name: string, status = "accepted") {
    const chef = await makeChef(svc, name + "-chef");
    const cust = await makeCustomer(svc, name + "-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [far(5), far(6)],
      status,
    });
    return { chef, cust, id: b.id };
  }
  const setLastDay = async (id: string, date: string) => {
    // Day 1 is the day before, so the last visit day is `date`.
    for (const [n, d] of [
      [1, dayPlus(date, -1)],
      [2, date],
    ] as const) {
      const r = await svc
        .from("booking_days")
        .update({ visit_date: d })
        .eq("booking_id", id)
        .eq("day_number", n);
      expect(r.error).toBeNull();
    }
  };

  it("ends at 00:00 Toronto on last day + 8, to the second", async () => {
    const { id } = await accepted("cp-win1");
    const last = far(6);
    const ends = (await svc.rpc("booking_contact_ends_at", { p_booking: id }))
      .data as string;
    const at = new Date(ends);
    const toronto = (o: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto",
        hourCycle: "h23",
        ...o,
      }).format(at);
    expect(toronto({ year: "numeric", month: "2-digit", day: "2-digit" })).toBe(
      dayPlus(last, 8),
    );
    expect(toronto({ hour: "2-digit", minute: "2-digit" })).toBe("00:00");
    const open = (at: number) =>
      svc.rpc("booking_contact_open", {
        p_booking: id,
        p_status: "accepted",
        p_at: new Date(new Date(ends).getTime() + at).toISOString(),
      });
    expect((await open(-1000)).data).toBe(true);
    expect((await open(0)).data).toBe(false);
  });

  it("get_booking_contact: open for the last day + 7, closed at last day + 8, for each status and party", async () => {
    for (const status of [
      "accepted",
      "completed",
      "no_show_customer",
      "no_show_chef",
    ]) {
      const { chef, cust, id } = await accepted("cp-win-" + status, status);
      const clients = [await clientFor(cust), await clientFor(chef)];
      await setLastDay(id, dayPlus(todayTo, -7));
      for (const c of clients) {
        const r = await contactOf(c, id);
        expectRows(r, 1);
        expect(r.data?.[0].visible_until).not.toBeNull();
      }
      await setLastDay(id, dayPlus(todayTo, -8));
      for (const c of clients) expectRows(await contactOf(c, id), 0);
    }
  });

  it("D-56: requested, declined, expired and cancelled bookings never show contact, window open or not", async () => {
    for (const status of ["requested", "declined", "expired", "cancelled"]) {
      const { chef, cust, id } = await accepted("cp-no-" + status, status);
      for (const c of [await clientFor(cust), await clientFor(chef)])
        expectRows(await contactOf(c, id), 0);
    }
  });
});

describe("set_chef_kitchen_address (N3, L4)", () => {
  const call = (
    chef: string,
    expected: string,
    line = "5 New Place",
    status: string | null = "pending",
  ) =>
    svc.rpc("set_chef_kitchen_address", {
      p_chef: chef,
      p_expected_updated_at: expected,
      p_line: line,
      p_city: "Mississauga",
      p_postal: "L5B1A2",
      p_kitchen_status: status,
      p_allergen_ack_at: null,
      p_hygiene_ack_at: null,
    });
  const stamp = async (chef: string) =>
    (
      await svc
        .from("chef_private")
        .select("updated_at")
        .eq("chef_id", chef)
        .single()
    ).data!.updated_at as string;

  it("no browser role can call it", async () => {
    const chef = await homeChef("cp-fn-chef");
    const t = await stamp(chef.id);
    for (const c of [
      anonClient(),
      await clientFor(chef),
      await clientFor(await makeCustomer(svc, "cp-fn-cust")),
    ]) {
      const r = await c.rpc("set_chef_kitchen_address", {
        p_chef: chef.id,
        p_expected_updated_at: t,
        p_line: "x",
        p_city: "y",
        p_postal: "L5B1A2",
        p_kitchen_status: null,
        p_allergen_ack_at: null,
        p_hygiene_ack_at: null,
      });
      expect(r.error).not.toBeNull();
    }
  });

  it("writes, resets the kitchen check, switches chef's home off; a stale stamp is a conflict", async () => {
    const chef = await homeChef("cp-ok-chef");
    const t = await stamp(chef.id);
    const ok = await call(chef.id, t);
    expect(ok.data).toEqual({ result: "ok" });
    const row = await svc
      .from("chef_private")
      .select("kitchen_address_line, kitchen_status")
      .eq("chef_id", chef.id)
      .single();
    expect(row.data).toEqual({
      kitchen_address_line: "5 New Place",
      kitchen_status: "pending",
    });
    const c = await svc
      .from("chefs")
      .select("chef_home_enabled")
      .eq("profile_id", chef.id)
      .single();
    expect(c.data?.chef_home_enabled).toBe(false);
    expect((await call(chef.id, t)).data).toEqual({ result: "conflict" });
  });

  it("is refused while a chef's-home booking is accepted, allowed once it is completed", async () => {
    const chef = await homeChef("cp-use-chef");
    const cust = await makeCustomer(svc, "cp-use-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [far(8)],
      location: "chef_home",
    });
    await accept(b.id, chef.id);
    expect((await call(chef.id, await stamp(chef.id))).data).toEqual({
      result: "kitchen_in_use",
    });
    await svc.from("bookings").update({ status: "completed" }).eq("id", b.id);
    expect((await call(chef.id, await stamp(chef.id))).data).toEqual({
      result: "ok",
    });
  });

  it("a concurrent accept and address change never end with an accepted booking and a changed address", async () => {
    for (let i = 0; i < 4; i++) {
      const chef = await homeChef("cp-race-chef" + i);
      const cust = await makeCustomer(svc, "cp-race-cust" + i);
      const b = await makeBooking(svc, {
        customer: cust,
        chef,
        dates: [far(10 + i)],
        location: "chef_home",
      });
      const t = await stamp(chef.id);
      const [a, c] = await Promise.all([
        accept(b.id, chef.id),
        call(chef.id, t, "7 Race Road"),
      ]);
      const acceptedOk = (a.data as { result: string }).result === "ok";
      const changed = (c.data as { result: string }).result === "ok";
      expect(acceptedOk && changed, JSON.stringify([a.data, c.data])).toBe(
        false,
      );
      if (acceptedOk) {
        expect((c.data as { result: string }).result).toBe("kitchen_in_use");
        const snap = await svc
          .from("booking_kitchen_addresses")
          .select("address_line")
          .eq("booking_id", b.id)
          .single();
        expect(snap.data?.address_line).toBe("12 Kitchen Lane");
      } else {
        expect((a.data as { result: string }).result).toBe(
          "chef_home_not_enabled",
        );
      }
    }
  });
});
