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
  serviceClient,
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
    // T-032: clients cannot write dishes any more; the route (service role) creates it
    const created = await serviceClient()
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

  // Expected client privileges, written out in full. Any grant added or removed in a migration
  // must show up here (and get a test), so the change is reviewed on purpose.
  const allTables = [
    "availability",
    "booking_addresses",
    "booking_day_dishes",
    "booking_days",
    "bookings",
    "chef_private",
    "chefs",
    "dishes",
    "free_trial_blocks",
    "free_trial_claims",
    "intake_forms",
    "messages",
    "notifications",
    "postal_prefixes",
    "profile_private",
    "profiles",
    "receipts",
    "reports",
    "reviews",
  ];
  const expectedTable: string[] = [
    ...["availability", "chefs", "dishes", "postal_prefixes", "reviews"].map(
      (t) => `anon ${t} select`,
    ),
    ...allTables.map((t) => `authenticated ${t} select`),
    // T-028: chef_private, chefs and profiles are written by routes only (no client update).
    "authenticated reports update",
    // T-032: dishes and availability are written by routes only (no client write privilege).
  ].sort();
  const expectedColumns: string[] = [
    ...[
      "author_id",
      "author_role",
      "booking_id",
      "comment",
      "rating",
      "subject_id",
    ].map((c) => `authenticated reviews.${c} insert`),
    ...["body", "booking_id", "sender_id"].map(
      (c) => `authenticated messages.${c} insert`,
    ),
    ...["booking_id", "category", "description", "reporter_id"].map(
      (c) => `authenticated reports.${c} insert`,
    ),
    "authenticated notifications.read_at update",
  ].sort();
  const expectedFunctions: string[] = [
    "booking_contact_unlocked",
    "can_view_kitchen_photos",
    "get_booking_contact",
    "is_admin",
    "is_booking_chef",
    "is_booking_party",
    "is_chef",
    "shares_booking_with",
    "storage_booking_id",
    "storage_folder_uuid",
  ]
    .map((f) => `authenticated ${f} execute`)
    // T-042: two read-only helpers for the public chef page and search. They return dates or chef
    // ids only (migration 20261011100100); everything else the booking API adds is server-only.
    .concat(
      ["chef_booked_dates", "chefs_booked_on"].flatMap((f) => [
        `anon ${f} execute`,
        `authenticated ${f} execute`,
      ]),
    )
    .sort();

  it("table privileges for anon and authenticated match the snapshot exactly", async () => {
    const res = await client.query(`
      select r.rolname || ' ' || c.relname || ' ' || lower(p.priv) as line
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      cross join (values ('anon'), ('authenticated')) r(rolname)
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
      where c.relkind in ('r','p','v','m','f') and has_table_privilege(r.rolname, c.oid, p.priv)`);
    expect(res.rows.map((r) => r.line as string).sort()).toEqual(expectedTable);
  });

  it("column-level privileges for anon and authenticated match the snapshot exactly", async () => {
    const res = await client.query(`
      select pg_get_userbyid(x.grantee) || ' ' || c.relname || '.' || a.attname || ' ' || lower(x.privilege_type) as line
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      cross join lateral aclexplode(a.attacl) x
      where a.attacl is not null and not a.attisdropped and x.grantee <> 0
        and pg_get_userbyid(x.grantee) in ('anon', 'authenticated')`);
    expect(res.rows.map((r) => r.line as string).sort()).toEqual(
      expectedColumns,
    );
  });

  it("function execute privileges for anon and authenticated match the snapshot exactly", async () => {
    const res = await client.query(`
      select r.rolname || ' ' || p.proname || ' execute' as line
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      cross join (values ('anon'), ('authenticated')) r(rolname)
      where p.prokind = 'f'
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
        and has_function_privilege(r.rolname, p.oid, 'EXECUTE')`);
    expect(res.rows.map((r) => r.line as string).sort()).toEqual(
      expectedFunctions,
    );
  });
});
