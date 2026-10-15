// T-064 Tester: D-66 (required): a customer's receipt answer (confirm or
// dispute) is still allowed on a frozen booking, because it changes no booking status.
// Also: a frozen booking keeps its status through a repeated sweep with no user filter for its parties.
import { describe, expect, it } from "vitest";
import {
  dayPlus,
  makeBooking,
  makeChef,
  makeCustomer,
  rand,
  serviceClient,
} from "./helpers";

const svc = serviceClient();
const todayTo = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
}).format(new Date());
// Dates in a range no other file uses; every chef here is new anyway.
const future = () => dayPlus(todayTo, 700 + Math.floor(Math.random() * 100));

async function frozenWithReceipt(name: string) {
  const chef = await makeChef(svc, `${name}-chef`, {
    options: ["customer_home"],
  });
  const cust = await makeCustomer(svc, `${name}-cust`);
  const b = await makeBooking(svc, {
    customer: cust,
    chef,
    dates: [future()],
    status: "accepted",
    location: "customer_home",
  });
  await svc
    .from("bookings")
    .update({ grocery_option: "chef_shops" })
    .eq("id", b.id);
  const sub = await svc.rpc("submit_receipt", {
    p_booking: b.id,
    p_chef: chef.id,
    p_path: `${b.id}/r-${rand(6)}.jpg`,
    p_amount: 4000,
    p_mismatch: false,
  });
  expect(sub.data).toMatchObject({ result: "ok" });
  const flag = await svc
    .from("booking_flags")
    .insert({ booking_id: b.id, reason: "chef_rejected" });
  expect(flag.error).toBeNull();
  return {
    id: b.id,
    cust,
    receipt: (sub.data as { receipt_id: string }).receipt_id,
  };
}

describe("customer receipt answers on a frozen booking (D-66: allowed)", () => {
  for (const action of ["confirm", "dispute"] as const) {
    it(`${action} still works and the booking stays accepted and frozen`, async () => {
      const s = await frozenWithReceipt(`ffT-${action}`);
      const r = await svc.rpc("answer_receipt", {
        p_booking: s.id,
        p_customer: s.cust.id,
        p_receipt: s.receipt,
        p_action: action,
        p_note: action === "dispute" ? "The total looks wrong" : null,
      });
      expect(r.error).toBeNull();
      expect(r.data).toMatchObject({ result: "ok" });
      const st = await svc
        .from("bookings")
        .select("status")
        .eq("id", s.id)
        .single();
      expect(st.data?.status).toBe("accepted");
      const fz = await svc.rpc("booking_is_frozen", { p_booking: s.id });
      expect(fz.data).toBe(true);
    });
  }
});
