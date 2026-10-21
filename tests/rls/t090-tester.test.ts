// T-090 Tester additions: the recreated reports_insert_party policy and the function's grants.
import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  clientFor,
  dayPlus,
  expectDenied,
  makeBooking,
  makeChef,
  makeCustomer,
  serviceClient,
  type Person,
} from "./helpers";

const fx = inject("fx");
const svc = serviceClient();

let cust: Person;
let other: Person;
let chef: Person;
let cC: SupabaseClient;
let cO: SupabaseClient;
let bookingId: string;

beforeAll(async () => {
  cust = await makeCustomer(svc, "t90-customer");
  other = await makeCustomer(svc, "t90-other");
  chef = await makeChef(svc, "t90-chef", { status: "approved" });
  [cC, cO] = await Promise.all([cust, other].map(clientFor));
  const b = await makeBooking(svc, {
    customer: cust,
    chef,
    dates: [dayPlus(fx.baseDay, 900)],
    status: "accepted",
  });
  bookingId = b.id;
});

const RPC_ARGS = {
  p_admin: "00000000-0000-0000-0000-000000000000",
  p_kind: "report_dismiss",
  p_booking: null,
  p_report: "00000000-0000-0000-0000-000000000000",
  p_final: null,
  p_note: "tester probe",
};

describe("T-090: reports insert policy after the admin_note drop", () => {
  it("a non-party is refused", async () => {
    expectDenied(
      await cO
        .from("reports")
        .insert({
          booking_id: bookingId,
          reporter_id: other.id,
          description: "not mine",
        })
        .select(),
    );
  });

  it("a spoofed reporter, a closed report and a resolved report are refused", async () => {
    for (const extra of [
      { reporter_id: other.id },
      { status: "dismissed" },
      { status: "resolved" },
      { resolved_at: new Date().toISOString() },
    ]) {
      expectDenied(
        await cC
          .from("reports")
          .insert({
            booking_id: bookingId,
            reporter_id: cust.id,
            description: "probe",
            ...extra,
          })
          .select(),
      );
    }
  });

  it("the column is gone for the service role and a party", async () => {
    expect(
      (await svc.from("reports").select("admin_note").limit(1)).error,
    ).not.toBeNull();
    expect(
      (await cC.from("reports").select("admin_note").limit(1)).error,
    ).not.toBeNull();
    const ins = await cC
      .from("reports")
      .insert({
        booking_id: bookingId,
        reporter_id: cust.id,
        description: "x",
        admin_note: "sneaky",
      })
      .select();
    expect(ins.error).not.toBeNull();
  });

  it("a plain party insert still works", async () => {
    const ins = await cC
      .from("reports")
      .insert({
        booking_id: bookingId,
        reporter_id: cust.id,
        description: "t90 ok",
      })
      .select();
    expect(ins.error).toBeNull();
    expect(Object.keys(ins.data?.[0] ?? {})).not.toContain("admin_note");
    await svc.from("reports").delete().eq("id", ins.data?.[0].id);
  });
});

describe("T-090: admin_decide_booking stays service role only", () => {
  it("anon and a signed-in customer cannot call it", async () => {
    for (const c of [anonClient(), cC]) {
      const r = await c.rpc("admin_decide_booking", RPC_ARGS);
      expect(r.error).not.toBeNull();
      expect(r.error?.code).toBe("42501");
    }
  });
});
