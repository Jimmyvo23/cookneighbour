// T-042: the database side of the booking API (migrations 20261011100000 and 20261011100100).
// - The writer functions are for the server (service role) only.
// - The two date helpers are public but return dates / chef ids only.
// - `expired` frees the chef's date like `declined` and `cancelled`.
// - Contact details stay hidden before acceptance (table level), also for an expired booking.
import pg from "pg";
import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  clientFor,
  dayPlus,
  expectDenied,
  expectNoRows,
  localEnv,
  makeBooking,
  makeChef,
  makeCustomer,
  rand,
  serviceClient,
} from "./helpers";

const fx = inject("fx");
const svc = serviceClient();
// Far-future dates keep these chefs away from every other test's dates.
const far = (n: number) => dayPlus(fx.baseDay, 900 + n);
const BOOKING_FUNCTIONS = [
  "create_booking",
  "answer_booking",
  "expire_stale_bookings",
  "chef_remove_availability",
  "record_free_trial_block",
];

describe("booking functions are server-only", () => {
  let clients: [string, SupabaseClient][];
  beforeAll(async () => {
    clients = [
      ["anon", anonClient()],
      ["admin", await clientFor(fx.admin)],
      ["customer", await clientFor(fx.c1)],
      ["chef", await clientFor(fx.h1)],
    ];
  });

  it("no browser role can call a writer function, not even with their own ids", async () => {
    const chef = await makeChef(svc, "fn-chef");
    const cust = await makeCustomer(svc, "fn-cust");
    const b = await makeBooking(svc, { customer: cust, chef, dates: [far(1)] });
    const calls: [string, Record<string, unknown>][] = [
      ["create_booking", { p: { customer_id: cust.id, chef_id: chef.id } }],
      [
        "answer_booking",
        {
          p_booking: b.id,
          p_chef: chef.id,
          p_action: "decline",
          p_reason: null,
        },
      ],
      ["expire_stale_bookings", { p_user: null }],
      ["chef_remove_availability", { p_chef: chef.id, p_days: [far(1)] }],
      [
        "record_free_trial_block",
        { p_customer: cust.id, p_reason: "phone", p_window_minutes: 60 },
      ],
    ];
    for (const [who, c] of clients)
      for (const [fn, args] of calls) {
        const res = await c.rpc(fn, args);
        expectDenied(res);
        expect(res.data, `${who} ${fn}`).toBeFalsy();
      }
    const row = await svc
      .from("bookings")
      .select("status")
      .eq("id", b.id)
      .single();
    expect(row.data?.status).toBe("requested");
    const blocks = await svc
      .from("free_trial_blocks")
      .select("id")
      .eq("customer_id", cust.id);
    expect(blocks.data).toEqual([]);
  });

  it("they are SECURITY INVOKER with a fixed search_path and no PUBLIC execute; the service role can run them", async () => {
    const client = new pg.Client({ connectionString: localEnv().dbUrl });
    await client.connect();
    try {
      const res = await client.query(
        `select p.proname, p.prosecdef, p.proconfig,
                has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
                has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
          where p.proname = any ($1) order by p.proname`,
        [BOOKING_FUNCTIONS],
      );
      expect(res.rows.map((r) => r.proname)).toEqual(
        [...BOOKING_FUNCTIONS].sort(),
      );
      for (const r of res.rows) {
        expect(r.prosecdef, r.proname).toBe(false);
        expect(r.proconfig, r.proname).toContain('search_path=""');
        expect(r.public_exec, r.proname).toBe(false);
        expect(r.anon_exec, r.proname).toBe(false);
        expect(r.auth_exec, r.proname).toBe(false);
        expect(r.service_exec, r.proname).toBe(true);
      }
    } finally {
      await client.end();
    }
  });
});

describe("the public date helpers return dates and chef ids only", () => {
  it("anon sees that a chef is taken on a day, not by whom, and an inactive booking does not count", async () => {
    const chef = await makeChef(svc, "pub-chef");
    const a = await makeCustomer(svc, "pub-a");
    const b = await makeCustomer(svc, "pub-b");
    await makeBooking(svc, { customer: a, chef, dates: [far(10), far(11)] });
    const declined = await makeBooking(svc, {
      customer: b,
      chef,
      dates: [far(12)],
      status: "declined",
    });
    expect(declined.id).toBeTruthy();
    const anon = anonClient();
    const dates = await anon.rpc("chef_booked_dates", {
      p_chef: chef.id,
      p_from: far(9),
      p_to: far(13),
    });
    expect(dates.error).toBeNull();
    expect(dates.data).toEqual([far(10), far(11)]);
    expect(JSON.stringify(dates.data)).not.toContain(a.id);
    const taken = await anon.rpc("chefs_booked_on", { p_day: far(10) });
    expect(taken.error).toBeNull();
    expect(taken.data).toEqual([chef.id]);
    const free = await anon.rpc("chefs_booked_on", { p_day: far(12) });
    expect(free.data).toEqual([]);
    // A signed-in customer gets the same answer.
    const asCustomer = await (
      await clientFor(fx.c2)
    ).rpc("chef_booked_dates", {
      p_chef: chef.id,
      p_from: far(9),
      p_to: far(13),
    });
    expect(asCustomer.data).toEqual([far(10), far(11)]);
  });

  it("an unanswered request past its expiry is ignored", async () => {
    const chef = await makeChef(svc, "pub-stale");
    const a = await makeCustomer(svc, "pub-stale-a");
    const b = await makeBooking(svc, { customer: a, chef, dates: [far(20)] });
    const open = await anonClient().rpc("chefs_booked_on", { p_day: far(20) });
    expect(open.data).toEqual([chef.id]);
    await svc
      .from("bookings")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", b.id);
    const stale = await anonClient().rpc("chefs_booked_on", { p_day: far(20) });
    expect(stale.data).toEqual([]);
    const dates = await anonClient().rpc("chef_booked_dates", {
      p_chef: chef.id,
      p_from: far(20),
      p_to: far(20),
    });
    expect(dates.data).toEqual([]);
  });
});

describe("the expired status", () => {
  it("frees the chef's dates like declined and cancelled", async () => {
    const chef = await makeChef(svc, "exp-chef");
    const a = await makeCustomer(svc, "exp-a");
    const c = await makeCustomer(svc, "exp-b");
    const first = await makeBooking(svc, {
      customer: a,
      chef,
      dates: [far(30), far(31)],
    });
    await expect(
      makeBooking(svc, { customer: c, chef, dates: [far(31)] }),
    ).rejects.toThrow(/duplicate key/);
    const up = await svc
      .from("bookings")
      .update({ status: "expired" })
      .eq("id", first.id)
      .select("status");
    expect(up.error).toBeNull();
    const days = await svc
      .from("booking_days")
      .select("is_active")
      .eq("booking_id", first.id);
    expect(days.data).toEqual([{ is_active: false }, { is_active: false }]);
    await expect(
      makeBooking(svc, { customer: c, chef, dates: [far(31)] }),
    ).resolves.toBeTruthy();
  });

  it("a day added to an already-expired booking starts inactive", async () => {
    const chef = await makeChef(svc, "exp-chef2");
    const a = await makeCustomer(svc, "exp-a2");
    const b = await makeBooking(svc, {
      customer: a,
      chef,
      dates: [far(40)],
      status: "expired",
    });
    const d = await svc
      .from("booking_days")
      .select("is_active")
      .eq("booking_id", b.id);
    expect(d.data).toEqual([{ is_active: false }]);
  });

  it("a customer reads their expired booking but still gets no contact details; a stranger gets nothing", async () => {
    const chef = await makeChef(svc, "exp-chef3");
    const a = await makeCustomer(svc, "exp-a3");
    const b = await makeBooking(svc, {
      customer: a,
      chef,
      dates: [far(50)],
      status: "expired",
    });
    const mine = await (
      await clientFor(a)
    )
      .from("bookings")
      .select("status")
      .eq("id", b.id);
    expect(mine.data).toEqual([{ status: "expired" }]);
    const contact = await (
      await clientFor(a)
    ).rpc("get_booking_contact", { p_booking: b.id });
    expect(contact.data ?? []).toEqual([]);
    const stranger = await (
      await clientFor(fx.c2)
    )
      .from("bookings")
      .select("id")
      .eq("id", b.id);
    expectNoRows(stranger);
  });
});

describe("free_trial_blocks log", () => {
  it("counts repeated attempts in one row per customer and reason, and only admins read it", async () => {
    const cust = await makeCustomer(svc, "blk-" + rand(2));
    for (let i = 0; i < 3; i++) {
      const r = await svc.rpc("record_free_trial_block", {
        p_customer: cust.id,
        p_reason: "phone",
        p_window_minutes: 60,
      });
      expect(r.error).toBeNull();
    }
    await svc.rpc("record_free_trial_block", {
      p_customer: cust.id,
      p_reason: "address",
      p_window_minutes: 60,
    });
    const rows = await svc
      .from("free_trial_blocks")
      .select("reason, attempts")
      .eq("customer_id", cust.id)
      .order("reason");
    // The enum sorts customer, phone, address.
    expect(rows.data).toEqual([
      { reason: "phone", attempts: 3 },
      { reason: "address", attempts: 1 },
    ]);
    // Outside the window a new row starts.
    await svc
      .from("free_trial_blocks")
      .update({
        last_attempt_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
      })
      .eq("customer_id", cust.id)
      .eq("reason", "phone");
    await svc.rpc("record_free_trial_block", {
      p_customer: cust.id,
      p_reason: "phone",
      p_window_minutes: 60,
    });
    const again = await svc
      .from("free_trial_blocks")
      .select("attempts")
      .eq("customer_id", cust.id)
      .eq("reason", "phone")
      .order("attempts");
    expect(again.data).toEqual([{ attempts: 1 }, { attempts: 3 }]);
    const own = await (
      await clientFor(cust)
    )
      .from("free_trial_blocks")
      .select("id")
      .eq("customer_id", cust.id);
    expectNoRows(own);
    const admin = await (
      await clientFor(fx.admin)
    )
      .from("free_trial_blocks")
      .select("id")
      .eq("customer_id", cust.id);
    expect((admin.data ?? []).length).toBe(3);
  });
});
