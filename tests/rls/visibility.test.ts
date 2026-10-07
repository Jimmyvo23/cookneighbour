import pg from "pg";
import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  clientFor,
  expectNoRows,
  expectRows,
  ids,
  localEnv,
} from "./helpers";

const fx = inject("fx");

describe("search visibility: approved chefs only", () => {
  let c1: SupabaseClient;
  let hp: SupabaseClient;
  let admin: SupabaseClient;
  beforeAll(async () => {
    c1 = await clientFor(fx.c1);
    hp = await clientFor(fx.hp);
    admin = await clientFor(fx.admin);
  });

  it("anon sees approved chefs but never pending or rejected ones", async () => {
    const list = ids(await anonClient().from("chefs").select("profile_id"));
    expect(list).toContain(fx.h1.id);
    expect(list).toContain(fx.h2.id);
    expect(list).not.toContain(fx.hp.id);
    expect(list).not.toContain(fx.hr.id);
    // direct lookups by id also return nothing
    expectNoRows(
      await anonClient().from("chefs").select("*").eq("profile_id", fx.hp.id),
    );
    expectNoRows(
      await anonClient().from("chefs").select("*").eq("profile_id", fx.hr.id),
    );
  });

  it("a customer sees approved chefs only, not pending or rejected", async () => {
    const list = ids(await c1.from("chefs").select("profile_id"));
    expect(list).toContain(fx.h1.id);
    expect(list).toContain(fx.h2.id);
    expect(list).not.toContain(fx.hp.id);
    expect(list).not.toContain(fx.hr.id);
  });

  it("a pending chef sees their own row, the admin sees every status", async () => {
    expectRows(
      await hp.from("chefs").select("*").eq("profile_id", fx.hp.id),
      1,
    );
    const all = ids(await admin.from("chefs").select("profile_id"));
    expect(all).toEqual(
      expect.arrayContaining([fx.h1.id, fx.h2.id, fx.hp.id, fx.hr.id]),
    );
  });

  it("dishes of pending and rejected chefs are hidden from anon and customers; approved dishes shown", async () => {
    for (const client of [anonClient(), c1]) {
      const list = ids(await client.from("dishes").select("id"));
      expect(list).toContain(fx.approvedDishId);
      expect(list).not.toContain(fx.pendingDishId);
      expect(list).not.toContain(fx.rejectedDishId);
    }
    expectRows(
      await hp.from("dishes").select("id").eq("id", fx.pendingDishId),
      1,
    ); // owner allowed
  });

  it("availability of pending and rejected chefs is hidden; approved shown", async () => {
    for (const client of [anonClient(), c1]) {
      const rows = (await client.from("availability").select("chef_id"))
        .data as { chef_id: string }[];
      const chefs = rows.map((r) => r.chef_id);
      expect(chefs).toContain(fx.h1.id);
      expect(chefs).not.toContain(fx.hp.id);
      expect(chefs).not.toContain(fx.hr.id);
    }
    expectRows(
      await hp.from("availability").select("chef_id").eq("chef_id", fx.hp.id),
      1,
    );
  });

  it("an inactive dish of an approved chef is hidden from the public but visible to its chef", async () => {
    const h1 = await clientFor(fx.h1);
    const created = await h1
      .from("dishes")
      .insert({
        chef_id: fx.h1.id,
        name: "hidden dish",
        cuisine: "Vietnamese",
        cook_minutes: 30,
        is_active: false,
      })
      .select("id");
    expectRows(created, 1);
    const id = (created.data as { id: string }[])[0].id;
    expectNoRows(await anonClient().from("dishes").select("id").eq("id", id));
    expectRows(await h1.from("dishes").select("id").eq("id", id), 1);
  });

  it("postal_prefixes reference data is public", async () => {
    const res = await anonClient().from("postal_prefixes").select("prefix");
    expect(res.error).toBeNull();
  });
});

describe("database-level guarantees", () => {
  const client = new pg.Client({ connectionString: localEnv().dbUrl });
  beforeAll(async () => {
    await client.connect();
    return async () => {
      await client.end();
    };
  });

  it("row-level security is enabled on every public table", async () => {
    const res = await client.query(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')`,
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(19);
    const off = res.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    expect(off).toEqual([]);
  });

  it("anon has no write privilege and no read on private tables", async () => {
    const q = async (role: string, priv: string, table: string) =>
      (
        await client.query("select has_table_privilege($1, $2, $3) as ok", [
          role,
          `public.${table}`,
          priv,
        ])
      ).rows[0].ok;
    for (const t of [
      "bookings",
      "profile_private",
      "chef_private",
      "messages",
      "free_trial_claims",
      "booking_addresses",
    ]) {
      expect(await q("anon", "select", t), `anon select ${t}`).toBe(false);
    }
    for (const t of ["chefs", "bookings", "free_trial_claims", "profiles"]) {
      expect(await q("anon", "insert", t), `anon insert ${t}`).toBe(false);
      expect(
        await q("authenticated", "delete", t),
        `authenticated delete ${t}`,
      ).toBe(false);
    }
    // control: the grants that should exist do exist
    expect(await q("anon", "select", "chefs")).toBe(true);
    expect(await q("authenticated", "select", "bookings")).toBe(true);
  });
});
