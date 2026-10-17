// T-063: the database side of the booking changes (migration 20261011200000).
// - change_booking and the sweep are server-only; so are the time helpers.
// - pickup_proposals are visible to the two parties and admin only, and nobody writes them from a browser.
// - booking_flags (D-22) are admin only.
// - The SQL cancellation timing equals the TypeScript rule at the boundary (A-22).
import pg from "pg";
import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cancellationTiming } from "../../src/lib/domain/cancellation";
import {
  completionDue,
  completesOnPickup,
  pickupDeadline,
} from "../../src/lib/domain/bookingChanges";
import {
  anonClient,
  clientFor,
  dayPlus,
  expectDenied,
  expectNoRows,
  expectRows,
  localEnv,
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
const far = (n: number) => dayPlus(todayTo, 10 + n);

const SERVER_ONLY = [
  "change_booking",
  "sweep_booking_changes",
  "booking_cancellation_timing",
  "booking_pickup_end",
  "booking_auto_complete_at",
  "booking_all_picked_up", // T-081
];

describe("booking-change functions are server-only", () => {
  let clients: [string, SupabaseClient][];
  beforeAll(async () => {
    clients = [
      ["anon", anonClient()],
      ["admin", await clientFor(fx.admin)],
      ["customer", await clientFor(fx.c1)],
      ["chef", await clientFor(fx.h1)],
    ];
  });

  it("no browser role can call them, not even with their own ids", async () => {
    const chef = await makeChef(svc, "bc-fn-chef");
    const cust = await makeCustomer(svc, "bc-fn-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [far(1)],
      status: "accepted",
    });
    const calls: [string, Record<string, unknown>][] = [
      [
        "change_booking",
        {
          p_booking: b.id,
          p_actor: cust.id,
          p_action: "cancel",
          p_args: { free_hours: 48 },
        },
      ],
      ["sweep_booking_changes", { p_user: null }],
      [
        "booking_cancellation_timing",
        {
          p_first_day: far(1),
          p_at: new Date().toISOString(),
          p_free_hours: 48,
        },
      ],
      ["booking_pickup_end", { p_eat_by: far(1) }],
      ["booking_auto_complete_at", { p_booking: b.id }],
      ["booking_all_picked_up", { p_booking: b.id }],
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
    expect(row.data?.status).toBe("accepted");
  });

  it("they are SECURITY INVOKER with a fixed search_path, no PUBLIC execute, and the service role can run them", async () => {
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
        [[...SERVER_ONLY, "answer_booking", "admin_reject_chef"]],
      );
      expect(res.rows.map((r) => r.proname)).toEqual(
        [...SERVER_ONLY, "answer_booking", "admin_reject_chef"].sort(),
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

describe("pickup_proposals and booking_flags: who can read, nobody writes from a browser", () => {
  it("parties and admin read proposals; strangers and anon do not; browsers cannot write", async () => {
    const chef = await makeChef(svc, "bc-pp-chef", {
      options: ["customer_home", "chef_home"],
      chefHomeEnabled: true,
    });
    const cust = await makeCustomer(svc, "bc-pp-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [far(2)],
      status: "accepted",
      location: "chef_home",
    });
    const ins = await svc
      .from("pickup_proposals")
      .insert({
        booking_id: b.id,
        booking_day_id: b.dayIds[0],
        proposed_by: cust.id,
        proposed_at: new Date(Date.now() + 3600_000).toISOString(),
      })
      .select("id");
    expect(ins.error).toBeNull();
    const id = (ins.data as { id: string }[])[0].id;

    const asCust = await clientFor(cust);
    const asChef = await clientFor(chef);
    const asAdmin = await clientFor(fx.admin);
    const stranger = await clientFor(fx.c1);
    const otherChef = await clientFor(fx.h1);
    for (const c of [asCust, asChef, asAdmin])
      expectRows(await c.from("pickup_proposals").select("id").eq("id", id), 1);
    for (const c of [stranger, otherChef, anonClient()])
      expectNoRows(await c.from("pickup_proposals").select("id").eq("id", id));

    for (const c of [asCust, asChef, asAdmin, stranger]) {
      expectDenied(
        await c
          .from("pickup_proposals")
          .insert({
            booking_id: b.id,
            booking_day_id: b.dayIds[0],
            proposed_by: cust.id,
            proposed_at: new Date(Date.now() + 7200_000).toISOString(),
          })
          .select("id"),
      );
      expectDenied(
        await c
          .from("pickup_proposals")
          .update({ status: "accepted" })
          .eq("id", id)
          .select("id"),
      );
    }
    const row = await svc
      .from("pickup_proposals")
      .select("status")
      .eq("id", id)
      .single();
    expect(row.data?.status).toBe("proposed");
  });

  it("at most one live proposal per day (unique index backstop)", async () => {
    const chef = await makeChef(svc, "bc-uq-chef", {
      options: ["customer_home", "chef_home"],
      chefHomeEnabled: true,
    });
    const cust = await makeCustomer(svc, "bc-uq-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [far(3)],
      status: "accepted",
      location: "chef_home",
    });
    const row = {
      booking_id: b.id,
      booking_day_id: b.dayIds[0],
      proposed_by: cust.id,
      proposed_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    expect((await svc.from("pickup_proposals").insert(row)).error).toBeNull();
    const dup = await svc.from("pickup_proposals").insert(row);
    expect(dup.error?.code).toBe("23505");
    // A declined or void one does not count.
    await svc
      .from("pickup_proposals")
      .update({ status: "declined" })
      .eq("booking_id", b.id);
    expect((await svc.from("pickup_proposals").insert(row)).error).toBeNull();
  });

  it("booking_flags are admin only", async () => {
    const chef = await makeChef(svc, "bc-fl-chef");
    const cust = await makeCustomer(svc, "bc-fl-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [far(4)],
      status: "accepted",
    });
    expect(
      (
        await svc
          .from("booking_flags")
          .insert({ booking_id: b.id, reason: "chef_rejected" })
      ).error,
    ).toBeNull();
    expectRows(
      await (
        await clientFor(fx.admin)
      )
        .from("booking_flags")
        .select("booking_id")
        .eq("booking_id", b.id),
      1,
    );
    for (const c of [
      await clientFor(cust),
      await clientFor(chef),
      anonClient(),
    ]) {
      expectNoRows(
        await c
          .from("booking_flags")
          .select("booking_id")
          .eq("booking_id", b.id),
      );
      expectDenied(
        await c
          .from("booking_flags")
          .insert({ booking_id: b.id, reason: "chef_rejected" })
          .select("booking_id"),
      );
    }
  });
});

describe("T-066: no_day_cooked flags", () => {
  it("the new reason is allowed, others are not; only the admin reads it", async () => {
    const chef = await makeChef(svc, "bc-nd-chef");
    const cust = await makeCustomer(svc, "bc-nd-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      // far(90): booking-api.test.ts asserts exactly which chefs are booked on far(5) in the shared database.
      dates: [far(90)],
      status: "accepted",
    });
    const bad = await svc
      .from("booking_flags")
      .insert({ booking_id: b.id, reason: "something_else" });
    expect(bad.error).not.toBeNull();
    const ok = await svc
      .from("booking_flags")
      .insert({ booking_id: b.id, reason: "no_day_cooked" });
    expect(ok.error).toBeNull();
    // One flag per booking: a second reason cannot be added.
    const dup = await svc
      .from("booking_flags")
      .insert({ booking_id: b.id, reason: "chef_rejected" });
    expect(dup.error).not.toBeNull();
    expectRows(
      await (
        await clientFor(fx.admin)
      )
        .from("booking_flags")
        .select("booking_id, reason")
        .eq("booking_id", b.id),
      1,
    );
    for (const c of [
      await clientFor(cust),
      await clientFor(chef),
      anonClient(),
    ]) {
      expectNoRows(
        await c
          .from("booking_flags")
          .select("booking_id")
          .eq("booking_id", b.id),
      );
    }
  });
});

describe("the SQL time rules equal the TypeScript ones", () => {
  it("cancellation timing agrees at the 48-hour boundary, across a daylight-saving change", async () => {
    const client = new pg.Client({ connectionString: localEnv().dbUrl });
    await client.connect();
    try {
      for (const first of ["2026-10-20", "2026-11-02", "2027-03-15"]) {
        const cutoff = cancellationTiming({
          now: new Date(),
          firstVisitDate: first,
          cancelledBy: "customer",
        }).freeUntil.getTime();
        for (const off of [-3_600_000, -1000, 0, 1000, 3_600_000]) {
          const at = new Date(cutoff + off);
          const r = await client.query(
            "select public.booking_cancellation_timing($1::date, $2::timestamptz, 48) as t",
            [first, at.toISOString()],
          );
          expect(r.rows[0].t, `${first} ${off}`).toBe(
            cancellationTiming({
              now: at,
              firstVisitDate: first,
              cancelledBy: "customer",
            }).timing,
          );
        }
      }
    } finally {
      await client.end();
    }
  });
});

describe("the SQL completion and pickup rules equal the TypeScript ones (L5)", () => {
  // 2026-10-31 -> the clocks go back on 2026-11-01; 2027-03-12 -> they go forward on 2027-03-14.
  const lastDays = ["2026-10-31", "2026-12-20", "2027-03-12"];

  it("booking_pickup_end equals pickupDeadline", async () => {
    const client = new pg.Client({ connectionString: localEnv().dbUrl });
    await client.connect();
    try {
      for (const eat of [...lastDays, "2026-11-01", "2027-03-13"]) {
        const r = await client.query(
          "select public.booking_pickup_end($1::date) as t",
          [eat],
        );
        expect(new Date(r.rows[0].t).getTime(), eat).toBe(
          pickupDeadline(eat).getTime(),
        );
      }
    } finally {
      await client.end();
    }
  });

  it("booking_auto_complete_at equals completionDue (customer's home) and the later of the two rules (chef's home)", async () => {
    const client = new pg.Client({ connectionString: localEnv().dbUrl });
    await client.connect();
    try {
      for (const last of lastDays) {
        const chef = await makeChef(svc, `bc-ac-${last}`);
        const cust = await makeCustomer(svc, `bc-ac-c-${last}`);
        const home = await makeBooking(svc, {
          customer: cust,
          chef,
          dates: [last],
          status: "accepted",
        });
        const r = await client.query(
          "select public.booking_auto_complete_at($1) as t",
          [home.id],
        );
        expect(new Date(r.rows[0].t).getTime(), last).toBe(
          completionDue(last).getTime(),
        );

        // Chef's home: the earliest eat-by of the day decides the pickup deadline.
        for (const eatOffset of [1, 6]) {
          const chef2 = await makeChef(svc, `bc-ac2-${last}-${eatOffset}`, {
            options: ["customer_home", "chef_home"],
            chefHomeEnabled: true,
          });
          const b = await makeBooking(svc, {
            customer: cust,
            chef: chef2,
            dates: [last],
            status: "accepted",
            location: "chef_home",
          });
          const eat = dayPlus(last, eatOffset);
          for (const e of [dayPlus(last, eatOffset + 3), eat]) {
            const ins = await svc.from("booking_day_dishes").insert({
              booking_day_id: b.dayIds[0],
              dish_name: "Pho",
              cook_minutes: 60,
              eat_by_date: e,
            });
            expect(ins.error).toBeNull();
          }
          const q = await client.query(
            "select public.booking_auto_complete_at($1) as t",
            [b.id],
          );
          expect(new Date(q.rows[0].t).getTime(), `${last} +${eatOffset}`).toBe(
            Math.max(
              completionDue(last).getTime(),
              pickupDeadline(eat).getTime(),
            ),
          );
        }
      }
    } finally {
      await client.end();
    }
  });
});

describe("T-081: booking_all_picked_up equals completesOnPickup", () => {
  it("agrees for chef's home and customer's home, picked up or not, cancelled days ignored", async () => {
    const client = new pg.Client({ connectionString: localEnv().dbUrl });
    await client.connect();
    try {
      const cust = await makeCustomer(svc, "ap-cust");
      const now = new Date().toISOString();
      type Day = { cooked: boolean; picked: boolean; active: boolean };
      const cases: ["customer_home" | "chef_home", Day[]][] = [
        ["chef_home", [{ cooked: true, picked: true, active: true }]],
        [
          "chef_home",
          [
            { cooked: true, picked: true, active: true },
            { cooked: true, picked: true, active: true },
          ],
        ],
        [
          "chef_home",
          [
            { cooked: true, picked: true, active: true },
            { cooked: false, picked: false, active: true },
          ],
        ],
        [
          "chef_home",
          [
            { cooked: true, picked: true, active: true },
            { cooked: true, picked: false, active: true },
          ],
        ],
        [
          "chef_home",
          [
            { cooked: true, picked: true, active: true },
            { cooked: false, picked: false, active: false },
          ],
        ],
        ["chef_home", [{ cooked: false, picked: false, active: false }]],
        ["customer_home", [{ cooked: true, picked: true, active: true }]],
      ];
      let n = 0;
      for (const [loc, days] of cases) {
        const chef = await makeChef(svc, `ap-chef-${n}`, {
          options: ["customer_home", "chef_home"],
          chefHomeEnabled: true,
        });
        const b = await makeBooking(svc, {
          customer: cust,
          chef,
          dates: days.map((_, i) => far(20 + n * 4 + i)),
          status: "accepted",
          location: loc,
        });
        for (let i = 0; i < days.length; i++) {
          const up = await svc
            .from("booking_days")
            .update({
              cooked_at: days[i].cooked ? now : null,
              picked_up_at: days[i].picked ? now : null,
              is_active: days[i].active,
            })
            .eq("id", b.dayIds[i]);
          expect(up.error).toBeNull();
        }
        const r = await client.query(
          "select public.booking_all_picked_up($1) as t",
          [b.id],
        );
        expect(r.rows[0].t, `case ${n}`).toBe(
          completesOnPickup(
            loc,
            days.map((d) => ({
              isActive: d.active,
              cookedAt: d.cooked ? now : null,
              pickedUpAt: d.picked ? now : null,
            })),
          ),
        );
        n++;
      }
    } finally {
      await client.end();
    }
  });
});

describe("T-081 tester: more booking_all_picked_up vs completesOnPickup cases", () => {
  it("agrees on cooked-only, picked-without-cooked, a cancelled day that is done, and 3 days", async () => {
    const client = new pg.Client({ connectionString: localEnv().dbUrl });
    await client.connect();
    try {
      const cust = await makeCustomer(svc, "ap2-cust");
      const now = new Date().toISOString();
      type Day = { cooked: boolean; picked: boolean; active: boolean };
      const D = (cooked: boolean, picked: boolean, active = true): Day => ({
        cooked,
        picked,
        active,
      });
      const cases: ["customer_home" | "chef_home", Day[]][] = [
        ["chef_home", [D(true, false)]],
        ["chef_home", [D(false, true)]], // cannot happen through the API; the two rules still agree
        ["chef_home", [D(true, true), D(true, true, false), D(true, false)]],
        ["chef_home", [D(true, true), D(true, true), D(true, true)]],
        ["chef_home", [D(true, true), D(true, true), D(false, false)]],
        ["customer_home", [D(true, true), D(true, true)]],
      ];
      let n = 0;
      for (const [loc, days] of cases) {
        const chef = await makeChef(svc, `ap2-chef-${n}`, {
          options: ["customer_home", "chef_home"],
          chefHomeEnabled: true,
        });
        const b = await makeBooking(svc, {
          customer: cust,
          chef,
          dates: days.map((_, i) => far(60 + n * 4 + i)),
          status: "accepted",
          location: loc,
        });
        for (let i = 0; i < days.length; i++) {
          const up = await svc
            .from("booking_days")
            .update({
              cooked_at: days[i].cooked ? now : null,
              picked_up_at: days[i].picked ? now : null,
              is_active: days[i].active,
            })
            .eq("id", b.dayIds[i]);
          expect(up.error).toBeNull();
        }
        const r = await client.query(
          "select public.booking_all_picked_up($1) as t",
          [b.id],
        );
        expect(r.rows[0].t, `case ${n}`).toBe(
          completesOnPickup(
            loc,
            days.map((d) => ({
              isActive: d.active,
              cookedAt: d.cooked ? now : null,
              pickedUpAt: d.picked ? now : null,
            })),
          ),
        );
        n++;
      }
    } finally {
      await client.end();
    }
  });
});

describe("T-071: booking_days.picked_up_at (D-55)", () => {
  it("parties and admin read it; strangers do not; no browser can set it", async () => {
    const chef = await makeChef(svc, "pc-chef", {
      options: ["customer_home", "chef_home"],
      chefHomeEnabled: true,
    });
    const cust = await makeCustomer(svc, "pc-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [far(3)],
      status: "accepted",
      location: "chef_home",
    });
    const set = await svc
      .from("booking_days")
      .update({ picked_up_at: new Date().toISOString() })
      .eq("id", b.dayIds[0]);
    expect(set.error).toBeNull();

    const asCust = await clientFor(cust);
    const asChef = await clientFor(chef);
    const asAdmin = await clientFor(fx.admin);
    for (const c of [asCust, asChef, asAdmin])
      expectRows(
        await c
          .from("booking_days")
          .select("picked_up_at")
          .eq("id", b.dayIds[0])
          .not("picked_up_at", "is", null),
        1,
      );
    for (const c of [
      await clientFor(fx.c1),
      await clientFor(fx.h1),
      anonClient(),
    ])
      expectNoRows(
        await c
          .from("booking_days")
          .select("picked_up_at")
          .eq("id", b.dayIds[0]),
      );
    // Nobody confirms or clears it from a browser.
    for (const c of [asCust, asChef, asAdmin, await clientFor(fx.c1)])
      expectDenied(
        await c
          .from("booking_days")
          .update({ picked_up_at: null })
          .eq("id", b.dayIds[0])
          .select("id"),
      );
    const row = await svc
      .from("booking_days")
      .select("picked_up_at")
      .eq("id", b.dayIds[0])
      .single();
    expect(row.data?.picked_up_at).not.toBeNull();
  });
});
