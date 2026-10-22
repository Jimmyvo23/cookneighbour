// T-101 (D-148, security review LOW-2): who reads the intake form, and when
// (migration 20261026100000, intake_forms_select_party).
// - the customer reads their own form at every status;
// - the chef reads it while `requested` and from acceptance until the D-52 contact window ends
//   (00:00 Toronto on last visit day + 8); not after decline, cancel, expiry or the window;
// - admin reads every form.
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

async function bookingWith(name: string, status: string) {
  const chef = await makeChef(svc, name + "-chef");
  const cust = await makeCustomer(svc, name + "-cust");
  const b = await makeBooking(svc, {
    customer: cust,
    chef,
    dates: [dayPlus(todayTo, 40), dayPlus(todayTo, 41)],
    status,
  });
  const ins = await svc.from("intake_forms").insert({
    booking_id: b.id,
    allergies: "peanuts",
    dietary_notes: "halal",
  });
  expect(ins.error).toBeNull();
  return { chef, cust, id: b.id };
}
const read = (c: SupabaseClient, id: string) =>
  c.from("intake_forms").select("allergies").eq("booking_id", id);
const setLastDay = async (id: string, date: string) => {
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

describe("intake form read window", () => {
  it("requested: customer and chef read it", async () => {
    const { chef, cust, id } = await bookingWith("iw-req", "requested");
    expectRows(await read(await clientFor(cust), id), 1);
    expectRows(await read(await clientFor(chef), id), 1);
  });

  it("accepted, inside the window (last day + 7): chef reads it", async () => {
    for (const status of [
      "accepted",
      "completed",
      "no_show_customer",
      "no_show_chef",
    ]) {
      const { chef, cust, id } = await bookingWith("iw-in-" + status, status);
      await setLastDay(id, dayPlus(todayTo, -7));
      expectRows(await read(await clientFor(chef), id), 1);
      expectRows(await read(await clientFor(cust), id), 1);
    }
  });

  it("after the window (last day + 8): chef no longer reads it, customer and admin still do", async () => {
    for (const status of ["accepted", "completed"]) {
      const { chef, cust, id } = await bookingWith("iw-out-" + status, status);
      await setLastDay(id, dayPlus(todayTo, -8));
      expectNoRows(await read(await clientFor(chef), id));
      expectRows(await read(await clientFor(cust), id), 1);
      expectRows(await read(await clientFor(fx.admin), id), 1);
    }
  });

  it("declined, cancelled, expired: chef cannot read it, customer and admin can", async () => {
    for (const status of ["declined", "cancelled", "expired"]) {
      const { chef, cust, id } = await bookingWith("iw-end-" + status, status);
      expectNoRows(await read(await clientFor(chef), id));
      expectRows(await read(await clientFor(cust), id), 1);
      expectRows(await read(await clientFor(fx.admin), id), 1);
    }
  });

  it("a stranger and anon never read it", async () => {
    const { id } = await bookingWith("iw-str", "requested");
    expectNoRows(await read(await clientFor(fx.c2), id));
    expectNoRows(await read(await clientFor(fx.h2), id));
    expectNoRows(await read(anonClient(), id));
  });

  it("the helper is not callable by anon", async () => {
    const { id } = await bookingWith("iw-anon", "requested");
    const r = await anonClient().rpc("can_read_intake", { p_booking: id });
    expect(r.error).not.toBeNull();
  });
});
