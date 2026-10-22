// T-098 Tester (WO-T098-tester): extra checks on the route-only write path for reviews and reports.
// Upsert, one-column inserts, rpc on the guard functions, the privilege and function catalog, and the
// edges of the trigger rules (window, status, role, completed_at fallback). LOCAL Supabase (CI).
import { randomUUID } from "node:crypto";
import pg from "pg";
import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  clientFor,
  dayPlus,
  expectCode,
  expectRows,
  localEnv,
  makeBooking,
  makeChef,
  makeCustomer,
  serviceClient,
  type Person,
} from "./helpers";

const fx = inject("fx");
const svc = serviceClient();
const DAY = 24 * 3_600_000;

let cust: Person;
let chef: Person;
let stranger: Person;
let browsers: [string, SupabaseClient][];
let n = 0;

beforeAll(async () => {
  cust = await makeCustomer(svc, "t98t-customer");
  stranger = await makeCustomer(svc, "t98t-stranger");
  chef = await makeChef(svc, "t98t-chef", { status: "approved" });
  const [cC, cH, cA, cS] = await Promise.all(
    [cust, chef, fx.admin, stranger].map(clientFor),
  );
  browsers = [
    ["customer", cC],
    ["chef", cH],
    ["admin", cA],
    ["stranger", cS],
    ["anon", anonClient()],
  ];
});

async function booking(
  status: string,
  ago: number | null = 1000,
): Promise<string> {
  n += 1;
  const b = await makeBooking(svc, {
    customer: cust,
    chef,
    dates: [dayPlus(fx.baseDay, 1300 + n)],
    status,
  });
  if (status === "completed" && ago !== null) {
    const up = await svc
      .from("bookings")
      .update({ completed_at: new Date(Date.now() - ago).toISOString() })
      .eq("id", b.id);
    expect(up.error).toBeNull();
  }
  return b.id;
}

/** Strict: a browser write must fail with 42501 (an empty result alone would hide a success). */
function expect42501(res: {
  error: { code?: string; message: string } | null;
}) {
  expectCode({ data: null, error: res.error }, "42501");
}

const review = (id: string, over: Record<string, unknown> = {}) => ({
  booking_id: id,
  author_id: cust.id,
  subject_id: chef.id,
  author_role: "customer",
  rating: 4,
  comment: "ok",
  ...over,
});

describe("T-098 tester: upsert and one-column inserts are refused too", () => {
  it("upsert (insert, and the update branch on an existing row) is refused for every browser role", async () => {
    const done = await booking("completed");
    const open = await booking("accepted");
    const rv = await svc
      .from("reviews")
      .insert(review(done))
      .select("id")
      .single();
    expect(rv.error).toBeNull();
    const rp = await svc
      .from("reports")
      .insert({ booking_id: open, reporter_id: cust.id, description: "first" })
      .select("id")
      .single();
    expect(rp.error).toBeNull();
    for (const [who, c] of browsers) {
      // New row through upsert.
      const fresh = await booking("completed");
      expect42501(
        await c
          .from("reviews")
          .upsert(review(fresh, { comment: `upsert ${who}` }))
          .select("id"),
      );
      expect42501(
        await c
          .from("reviews")
          .upsert(review(fresh), { onConflict: "booking_id,author_id" })
          .select("id"),
      );
      // Existing row: the conflict branch would be an update.
      expect42501(
        await c
          .from("reviews")
          .upsert(
            { ...review(done), id: rv.data?.id, rating: 1, comment: who },
            { onConflict: "id" },
          )
          .select("id"),
      );
      expect42501(
        await c
          .from("reports")
          .upsert(
            {
              id: rp.data?.id,
              booking_id: open,
              reporter_id: cust.id,
              description: `upsert ${who}`,
              status: "resolved",
            },
            { onConflict: "id" },
          )
          .select("id"),
      );
      expect42501(
        await c
          .from("reports")
          .upsert(
            { booking_id: open, reporter_id: cust.id, description: who },
            { ignoreDuplicates: true },
          ),
      );
    }
    const a = await svc
      .from("reviews")
      .select("rating, comment")
      .eq("id", rv.data?.id)
      .single();
    expect(a.data).toEqual({ rating: 4, comment: "ok" });
    const b = await svc
      .from("reports")
      .select("status, description")
      .eq("id", rp.data?.id)
      .single();
    expect(b.data).toEqual({ status: "open", description: "first" });
  });

  it("no single column can be inserted or updated by a browser role (column-level grants are gone)", async () => {
    const done = await booking("completed");
    const open = await booking("accepted");
    const rv = await svc
      .from("reviews")
      .insert(review(done))
      .select("id")
      .single();
    expect(rv.error).toBeNull();
    const rp = await svc
      .from("reports")
      .insert({ booking_id: open, reporter_id: cust.id, description: "x" })
      .select("id")
      .single();
    expect(rp.error).toBeNull();
    const reviewCols: Record<string, unknown> = {
      id: randomUUID(),
      booking_id: done,
      author_id: cust.id,
      subject_id: chef.id,
      author_role: "customer",
      rating: 5,
      comment: "c",
      created_at: new Date().toISOString(),
      author_display_name: "Someone",
    };
    const reportCols: Record<string, unknown> = {
      id: randomUUID(),
      booking_id: open,
      reporter_id: cust.id,
      category: "safety",
      description: "d",
      status: "open",
      created_at: new Date().toISOString(),
      resolved_at: null,
      client_id: randomUUID(),
    };
    for (const [, c] of browsers) {
      for (const [k, v] of Object.entries(reviewCols))
        expect42501(await c.from("reviews").insert({ [k]: v }));
      for (const [k, v] of Object.entries(reportCols))
        expect42501(await c.from("reports").insert({ [k]: v }));
      for (const k of ["rating", "comment"])
        expect42501(
          await c
            .from("reviews")
            .update({ [k]: k === "rating" ? 1 : "z" })
            .eq("id", rv.data?.id)
            .select(),
        );
      for (const [k, v] of [
        ["status", "resolved"],
        ["description", "z"],
        ["category", "other"],
        ["resolved_at", new Date().toISOString()],
      ])
        expect42501(
          await c
            .from("reports")
            .update({ [k]: v })
            .eq("id", rp.data?.id)
            .select(),
        );
    }
  });

  it("the guard functions cannot be called through rpc by any browser role", async () => {
    for (const [, c] of browsers)
      for (const fn of ["reviews_guard_insert", "reports_guard_insert"]) {
        const r = await c.rpc(fn);
        expect(r.error, fn).not.toBeNull();
        expect(r.data ?? null).toBeNull();
      }
  });
});

describe("T-098 tester: catalog (privileges, definer functions, trigger order)", () => {
  it("anon and authenticated hold SELECT only on reviews and reports; the guard functions are definer, search_path empty, service role only", async () => {
    const client = new pg.Client({ connectionString: localEnv().dbUrl });
    await client.connect();
    try {
      for (const role of ["anon", "authenticated"])
        for (const t of ["reviews", "reports"]) {
          const r = await client.query(
            `select p as priv, has_table_privilege($1, $2, p) as tbl,
                    has_any_column_privilege($1, $2, p) as col
               from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p`,
            [role, `public.${t}`],
          );
          for (const row of r.rows) {
            expect(row.tbl, `${role} ${t} table ${row.priv}`).toBe(false);
            expect(row.col, `${role} ${t} column ${row.priv}`).toBe(false);
          }
        }
      const res = await client.query(
        `select p.proname, p.prosecdef, p.proconfig, p.prorettype::regtype::text as ret,
                has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
                has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
          where p.proname in ('reviews_guard_insert', 'reports_guard_insert') order by p.proname`,
      );
      expect(res.rows.map((r) => r.proname)).toEqual([
        "reports_guard_insert",
        "reviews_guard_insert",
      ]);
      for (const r of res.rows) {
        expect(r.ret, r.proname).toBe("trigger");
        expect(r.prosecdef, r.proname).toBe(true);
        expect(r.proconfig, r.proname).toContain('search_path=""');
        expect(r.public_exec, r.proname).toBe(false);
        expect(r.anon_exec, r.proname).toBe(false);
        expect(r.auth_exec, r.proname).toBe(false);
      }
      // No insert policy is left on either table.
      const pol = await client.query(
        `select tablename, policyname, cmd from pg_policies
          where schemaname = 'public' and tablename in ('reviews', 'reports')
            and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')`,
      );
      expect(pol.rows).toEqual([]);
      // Both triggers are BEFORE INSERT, row level, enabled; the review guard sorts before the
      // display-name trigger so a refused row never gets a name.
      const trg = await client.query(
        `select c.relname, t.tgname, t.tgenabled, (t.tgtype & 1) = 1 as row_level,
                (t.tgtype & 2) = 2 as before_ev, (t.tgtype & 4) = 4 as on_insert
           from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal and c.relname in ('reviews', 'reports')
            and t.tgname in ('reviews_a_guard_insert', 'reports_guard_insert')
          order by t.tgname`,
      );
      expect(trg.rows.length).toBe(2);
      for (const r of trg.rows) {
        expect(r.tgenabled, r.tgname).toBe("O");
        expect(r.row_level && r.before_ev && r.on_insert, r.tgname).toBe(true);
      }
      const order = await client.query(
        `select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal and c.relname = 'reviews' and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4
          order by t.tgname`,
      );
      const names = order.rows.map((r) => r.tgname);
      expect(names.indexOf("reviews_a_guard_insert")).toBeLessThan(
        names.indexOf("reviews_before_insert"),
      );
    } finally {
      await client.end();
    }
  });
});

describe("T-098 tester: trigger rules match the old policies", () => {
  it("a chef's review of the customer is accepted inside the window, and gets a display name", async () => {
    const id = await booking("completed", 13 * DAY);
    const r = await svc
      .from("reviews")
      .insert(
        review(id, {
          author_id: chef.id,
          subject_id: cust.id,
          author_role: "chef",
        }),
      )
      .select("id, author_display_name");
    expectRows(r, 1);
    expect(
      (r.data as { author_display_name: string }[])[0].author_display_name,
    ).toBeTruthy();
  });

  it("the window edge: 1 minute inside is accepted, 1 minute past is refused (42501, nothing stored)", async () => {
    const inside = await booking("completed", 14 * DAY - 60_000);
    expectRows(
      await svc.from("reviews").insert(review(inside)).select("id"),
      1,
    );
    const past = await booking("completed", 14 * DAY + 60_000);
    expectCode(
      await svc.from("reviews").insert(review(past)).select("id"),
      "42501",
    );
    const rows = await svc.from("reviews").select("id").eq("booking_id", past);
    expect(rows.data).toEqual([]);
  });

  it("completed_at null falls back to updated_at, which is fresh after the update (accepted)", async () => {
    const id = await booking("completed", null);
    const nul = await svc
      .from("bookings")
      .update({ completed_at: null })
      .eq("id", id);
    expect(nul.error).toBeNull();
    expectRows(await svc.from("reviews").insert(review(id)).select("id"), 1);
  });

  it("every status except completed is refused for a review; a report is allowed on any status", async () => {
    for (const status of [
      "requested",
      "accepted",
      "declined",
      "cancelled",
      "no_show_customer",
      "no_show_chef",
    ]) {
      const id = await booking(status);
      expectCode(
        await svc.from("reviews").insert(review(id)).select("id"),
        "42501",
        "review not allowed",
      );
      // Reports have no status rule on the booking (old policy: a party of the booking).
      expectRows(
        await svc
          .from("reports")
          .insert({
            booking_id: id,
            reporter_id: status === "accepted" ? chef.id : cust.id,
            description: status,
          })
          .select("id"),
        1,
      );
    }
  });

  it("role and subject must pair up: customer author with role chef, chef author with role customer, self as subject", async () => {
    const id = await booking("completed");
    for (const over of [
      { author_role: "chef" },
      { author_id: chef.id, subject_id: cust.id, author_role: "customer" },
      { author_id: chef.id, subject_id: chef.id, author_role: "chef" },
      { subject_id: cust.id },
      { author_id: stranger.id, subject_id: chef.id },
    ])
      expectCode(
        await svc.from("reviews").insert(review(id, over)).select("id"),
        "42501",
      );
    expectRows(await svc.from("reviews").insert(review(id)).select("id"), 1);
    // One review per author and booking is still the unique key (23505, not 42501).
    expectCode(
      await svc.from("reviews").insert(review(id)).select("id"),
      "23505",
    );
  });

  it("a report is refused with a resolved status, a resolved_at, a stranger reporter or an unknown booking, with the guard's message", async () => {
    const id = await booking("accepted");
    const base = { booking_id: id, reporter_id: cust.id, description: "x" };
    expectCode(
      await svc
        .from("reports")
        .insert({ ...base, status: "reviewing" })
        .select("id"),
      "42501",
      "must be open",
    );
    expectCode(
      await svc
        .from("reports")
        .insert({ ...base, status: "dismissed" })
        .select("id"),
      "42501",
    );
    expectCode(
      await svc
        .from("reports")
        .insert({ ...base, reporter_id: stranger.id })
        .select("id"),
      "42501",
      "only a party",
    );
    expectCode(
      await svc
        .from("reports")
        .insert({ ...base, booking_id: randomUUID() })
        .select("id"),
      "42501",
    );
    const rows = await svc.from("reports").select("id").eq("booking_id", id);
    expect(rows.data).toEqual([]);
  });
});
