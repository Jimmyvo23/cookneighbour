// T-101 tester (D-148): extra edges for the intake read window. Local Supabase (runs in CI).
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

const fx = inject("fx");
const svc = serviceClient();
const todayTo = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
}).format(new Date());

async function bookingWith(name: string, status: string, lastDay: string) {
  const chef = await makeChef(svc, name + "-chef");
  const cust = await makeCustomer(svc, name + "-cust");
  const b = await makeBooking(svc, {
    customer: cust,
    chef,
    dates: [dayPlus(lastDay, -1), lastDay],
    status,
  });
  const ins = await svc
    .from("intake_forms")
    .insert({ booking_id: b.id, allergies: "sesame", dietary_notes: "vegan" });
  expect(ins.error).toBeNull();
  return { chef, cust, id: b.id };
}
const read = (c: SupabaseClient, id: string) =>
  c.from("intake_forms").select("allergies").eq("booking_id", id);

describe("intake window, extra edges", () => {
  it("no-show statuses: chef loses the form after the window, keeps it inside", async () => {
    for (const status of ["no_show_customer", "no_show_chef"]) {
      const out = await bookingWith(
        "iwt-out-" + status,
        status,
        dayPlus(todayTo, -8),
      );
      expectNoRows(await read(await clientFor(out.chef), out.id));
      expectRows(await read(await clientFor(out.cust), out.id), 1);
      const inn = await bookingWith(
        "iwt-in-" + status,
        status,
        dayPlus(todayTo, -7),
      );
      expectRows(await read(await clientFor(inn.chef), inn.id), 1);
    }
  });

  it("far past the window (30 days): chef cannot read, customer can", async () => {
    const { chef, cust, id } = await bookingWith(
      "iwt-old",
      "completed",
      dayPlus(todayTo, -30),
    );
    expectNoRows(await read(await clientFor(chef), id));
    expectRows(await read(await clientFor(cust), id), 1);
  });

  it("accepted booking in the future: chef reads it; a different chef does not", async () => {
    const { chef, id } = await bookingWith(
      "iwt-fut",
      "accepted",
      dayPlus(todayTo, 20),
    );
    expectRows(await read(await clientFor(chef), id), 1);
    expectNoRows(await read(await clientFor(fx.h2), id));
    expectNoRows(await read(await clientFor(fx.c2), id));
    expectNoRows(await read(anonClient(), id));
  });

  it("a status change closes the window at once (requested -> declined)", async () => {
    const { chef, id } = await bookingWith(
      "iwt-flip",
      "requested",
      dayPlus(todayTo, 20),
    );
    const cl = await clientFor(chef);
    expectRows(await read(cl, id), 1);
    const up = await svc
      .from("bookings")
      .update({ status: "declined" })
      .eq("id", id);
    expect(up.error).toBeNull();
    expectNoRows(await read(cl, id));
  });

  it("chef cannot write or delete a form, and an unfiltered read never leaks another booking's form", async () => {
    const a = await bookingWith("iwt-w-a", "requested", dayPlus(todayTo, 20));
    const b = await bookingWith("iwt-w-b", "requested", dayPlus(todayTo, 21));
    const cl = await clientFor(a.chef);
    const all = await cl.from("intake_forms").select("booking_id");
    expect((all.data ?? []).map((r) => r.booking_id)).toEqual([a.id]);
    await cl
      .from("intake_forms")
      .update({ allergies: "none" })
      .eq("booking_id", a.id);
    await cl.from("intake_forms").delete().eq("booking_id", a.id);
    const row = await svc
      .from("intake_forms")
      .select("allergies")
      .eq("booking_id", a.id)
      .single();
    expect(row.data?.allergies).toBe("sesame");
    expectNoRows(await read(cl, b.id));
  });
});
