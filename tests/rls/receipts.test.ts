// T-044: the database side of grocery receipts (migration 20261014100000).
// - submit_receipt / answer_receipt are server-only (SECURITY INVOKER, service_role only).
// - Receipts (and the new dispute columns) are readable by the two parties and admin only; no
//   browser writes them.
// - Storage: only the booking's chef uploads, only while accepted or completed, never overwrites
//   or deletes; one registered path per object, one current receipt per booking.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  rand,
  serviceClient,
  type Person,
} from "./helpers";

const fx = inject("fx");
const svc = serviceClient();
const todayTo = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
}).format(new Date());
const far = (n: number) => dayPlus(todayTo, 30 + n);
const png = () =>
  new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

async function chefShopsBooking(
  chef: Person,
  cust: Person,
  status: string,
  n: number,
) {
  const b = await makeBooking(svc, {
    customer: cust,
    chef,
    dates: [far(n)],
    status,
  });
  const up = await svc
    .from("bookings")
    .update({ grocery_option: "chef_shops", est_ingredients_cents: 2500 })
    .eq("id", b.id);
  expect(up.error).toBeNull();
  return b.id;
}

describe("receipt functions are server-only", () => {
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
    const chef = await makeChef(svc, "rc-fn-chef");
    const cust = await makeCustomer(svc, "rc-fn-cust");
    const id = await chefShopsBooking(chef, cust, "accepted", 1);
    for (const [who, c] of clients) {
      const sub = await c.rpc("submit_receipt", {
        p_booking: id,
        p_chef: chef.id,
        p_path: `${id}/${who}.png`,
        p_amount: 100,
        p_mismatch: false,
      });
      expectDenied(sub);
      const ans = await c.rpc("answer_receipt", {
        p_booking: id,
        p_customer: cust.id,
        p_receipt: randomUUID(),
        p_action: "confirm",
        p_note: null,
      });
      expectDenied(ans);
    }
    const rows = await svc.from("receipts").select("id").eq("booking_id", id);
    expect(rows.data).toEqual([]);
  });

  it("SECURITY INVOKER, fixed search_path, service role only", async () => {
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
          where p.proname in ('submit_receipt', 'answer_receipt') order by p.proname`,
      );
      expect(res.rows.map((r) => r.proname)).toEqual([
        "answer_receipt",
        "submit_receipt",
      ]);
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

describe("receipts table: parties read, nobody writes from a browser", () => {
  it("parties and admin read (including the dispute columns); strangers and anon do not", async () => {
    const chef = await makeChef(svc, "rc-rd-chef");
    const cust = await makeCustomer(svc, "rc-rd-cust");
    const id = await chefShopsBooking(chef, cust, "accepted", 2);
    const ins = await svc
      .from("receipts")
      .insert({
        booking_id: id,
        uploaded_by: chef.id,
        file_path: `${id}/a.png`,
        amount_cents: 2500,
        customer_disputed_at: new Date().toISOString(),
        dispute_note: "Wrong total",
      })
      .select("id");
    expect(ins.error).toBeNull();
    const cols = "id, dispute_note, customer_disputed_at, superseded_at";
    const [c, h, admin, c2, h2] = await Promise.all(
      [cust, chef, fx.admin, fx.c2, fx.h2].map((p) => clientFor(p)),
    );
    for (const cl of [c, h, admin])
      expectRows(
        await cl.from("receipts").select(cols).eq("booking_id", id),
        1,
      );
    for (const cl of [c2, h2, anonClient()])
      expectNoRows(await cl.from("receipts").select(cols).eq("booking_id", id));
  });

  it("neither party can insert, update or delete a receipt", async () => {
    const chef = await makeChef(svc, "rc-wr-chef");
    const cust = await makeCustomer(svc, "rc-wr-cust");
    const id = await chefShopsBooking(chef, cust, "accepted", 3);
    const row = await svc
      .from("receipts")
      .insert({
        booking_id: id,
        uploaded_by: chef.id,
        file_path: `${id}/b.png`,
        amount_cents: 2500,
      })
      .select("id")
      .single();
    expect(row.error).toBeNull();
    const [c, h] = await Promise.all([cust, chef].map((p) => clientFor(p)));
    expectDenied(
      await h
        .from("receipts")
        .insert({
          booking_id: id,
          uploaded_by: chef.id,
          file_path: `${id}/c.png`,
          amount_cents: 1,
        })
        .select(),
    );
    expectDenied(
      await c
        .from("receipts")
        .update({ customer_confirmed_at: new Date().toISOString() })
        .eq("id", row.data!.id)
        .select(),
    );
    expectDenied(
      await h
        .from("receipts")
        .update({ amount_cents: 1 })
        .eq("id", row.data!.id)
        .select(),
    );
    expectDenied(
      await c.from("receipts").delete().eq("id", row.data!.id).select(),
    );
    const after = await svc
      .from("receipts")
      .select("amount_cents, customer_confirmed_at")
      .eq("id", row.data!.id)
      .single();
    expect(after.data).toMatchObject({
      amount_cents: 2500,
      customer_confirmed_at: null,
    });
  });
});

describe("receipts table constraints", () => {
  it("a file path is registered once; one current receipt per booking; not both answers", async () => {
    const chef = await makeChef(svc, "rc-ct-chef");
    const cust = await makeCustomer(svc, "rc-ct-cust");
    const id = await chefShopsBooking(chef, cust, "accepted", 4);
    const base = { booking_id: id, uploaded_by: chef.id, amount_cents: 100 };
    expect(
      (await svc.from("receipts").insert({ ...base, file_path: `${id}/1.png` }))
        .error,
    ).toBeNull();
    // same path again
    const dup = await svc.from("receipts").insert({
      ...base,
      file_path: `${id}/1.png`,
      superseded_at: new Date().toISOString(),
    });
    expect(dup.error?.code).toBe("23505");
    // a second current receipt
    const two = await svc
      .from("receipts")
      .insert({ ...base, file_path: `${id}/2.png` });
    expect(two.error?.code).toBe("23505");
    // a superseded one is fine
    expect(
      (
        await svc.from("receipts").insert({
          ...base,
          file_path: `${id}/3.png`,
          superseded_at: new Date().toISOString(),
        })
      ).error,
    ).toBeNull();
    // both answers
    const both = await svc
      .from("receipts")
      .update({
        customer_confirmed_at: new Date().toISOString(),
        customer_disputed_at: new Date().toISOString(),
        dispute_note: "xyz",
      })
      .eq("file_path", `${id}/1.png`);
    expect(both.error?.code).toBe("23514");
    const note = await svc
      .from("receipts")
      .update({
        customer_disputed_at: new Date().toISOString(),
        dispute_note: "x",
      })
      .eq("file_path", `${id}/1.png`);
    expect(note.error?.code).toBe("23514");
  });
});

describe("storage: receipts upload rules", () => {
  it("the chef uploads only while the booking is accepted or completed", async () => {
    const chef = await makeChef(svc, "rc-st-chef");
    const cust = await makeCustomer(svc, "rc-st-cust");
    const h = await clientFor(chef);
    const up = async (id: string) =>
      (
        await h.storage
          .from("receipts")
          .upload(`${id}/r-${rand(4)}.png`, png(), { contentType: "image/png" })
      ).error;
    expect(
      await up(await chefShopsBooking(chef, cust, "accepted", 5)),
    ).toBeNull();
    expect(
      await up(await chefShopsBooking(chef, cust, "completed", 6)),
    ).toBeNull();
    for (const [s, n] of [
      ["requested", 7],
      ["declined", 8],
      ["cancelled", 9],
      ["expired", 10],
    ] as const)
      expect(
        await up(await chefShopsBooking(chef, cust, s, n)),
        s,
      ).not.toBeNull();
  });

  it("the chef of an accepted option A (customer_buys) booking cannot upload", async () => {
    const chef = await makeChef(svc, "rc-oa-chef");
    const cust = await makeCustomer(svc, "rc-oa-cust");
    const id = await chefShopsBooking(chef, cust, "accepted", 12);
    const h = await clientFor(chef);
    const up = async () =>
      (
        await h.storage
          .from("receipts")
          .upload(`${id}/r-${rand(4)}.png`, png(), { contentType: "image/png" })
      ).error;
    expect(await up()).toBeNull(); // allowed control: option B
    const set = await svc
      .from("bookings")
      .update({ grocery_option: "customer_buys" })
      .eq("id", id);
    expect(set.error).toBeNull();
    expect(await up()).not.toBeNull();
  });

  it("nobody can overwrite or delete an uploaded receipt", async () => {
    const chef = await makeChef(svc, "rc-ow-chef");
    const cust = await makeCustomer(svc, "rc-ow-cust");
    const id = await chefShopsBooking(chef, cust, "accepted", 11);
    const [h, c] = await Promise.all([chef, cust].map((p) => clientFor(p)));
    const path = `${id}/r-${rand(4)}.png`;
    expect(
      (
        await h.storage
          .from("receipts")
          .upload(path, png(), { contentType: "image/png" })
      ).error,
    ).toBeNull();
    const over = await h.storage
      .from("receipts")
      .upload(
        path,
        new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
        { contentType: "image/png", upsert: true },
      );
    expect(over.error).not.toBeNull();
    const moved = await h.storage
      .from("receipts")
      .move(path, `${id}/moved-${rand(4)}.png`);
    expect(moved.error).not.toBeNull();
    for (const cl of [h, c]) {
      await cl.storage.from("receipts").remove([path]);
      const still = await svc.storage.from("receipts").exists(path);
      expect(still.data).toBe(true);
    }
  });
});
