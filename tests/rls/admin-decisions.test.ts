// T-035: the admin decision functions (migration 20261010120000) are callable by the server
// (service role) only. A signed-in browser, even an admin's, cannot call them over the REST API:
// the route is the only caller, and it checks profiles.role = 'admin' first.
import pg from "pg";
import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  clientFor,
  expectDenied,
  localEnv,
  serviceClient,
} from "./helpers";

const fx = inject("fx");
const svc = serviceClient();

type Call = [string, Record<string, unknown>];
const calls = (id: string): Call[] => [
  ["admin_approve_chef", { p_chef_id: id }],
  ["admin_reject_chef", { p_chef_id: id, p_reason: "Because" }],
  [
    "admin_review_kitchen",
    {
      p_chef_id: id,
      p_decision: "reject",
      p_note: "Because",
      p_photos: [],
      p_address: null,
    },
  ],
];

describe("admin decision functions", () => {
  let clients: [string, SupabaseClient][];
  beforeAll(async () => {
    clients = [
      ["anon", anonClient()],
      ["admin", await clientFor(fx.admin)],
      ["customer", await clientFor(fx.c1)],
      ["chef", await clientFor(fx.h1)],
      ["pending chef (the target)", await clientFor(fx.hp)],
    ];
  });

  it("anon, customers, chefs and even admins cannot call them with their own session", async () => {
    for (const [who, c] of clients)
      for (const [fn, args] of calls(fx.hp.id)) {
        const res = await c.rpc(fn, args);
        expectDenied(res);
        expect(res.data, `${who} ${fn}`).toBeFalsy();
      }
    // Nothing changed.
    const chef = await svc
      .from("chefs")
      .select("status")
      .eq("profile_id", fx.hp.id)
      .single();
    expect(chef.data?.status).toBe("pending");
    const n = await svc
      .from("notifications")
      .select("id")
      .eq("user_id", fx.hp.id);
    expect(n.data).toEqual([]);
  });

  it("the service role can call them: an unknown chef is 'not_found' and nothing is written", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    for (const [fn, args] of calls(id)) {
      const res = await svc.rpc(fn, args);
      expect(res.error, fn).toBeNull();
      expect(res.data).toEqual({ result: "not_found" });
    }
  });

  it("they are SECURITY INVOKER with a fixed search_path and no PUBLIC execute", async () => {
    const client = new pg.Client({ connectionString: localEnv().dbUrl });
    await client.connect();
    try {
      const res = await client.query(`
        select p.proname, p.prosecdef, p.proconfig,
               has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
               has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        where p.proname in ('admin_approve_chef','admin_reject_chef','admin_review_kitchen')
        order by p.proname`);
      expect(res.rows.map((r) => r.proname)).toEqual([
        "admin_approve_chef",
        "admin_reject_chef",
        "admin_review_kitchen",
      ]);
      for (const r of res.rows) {
        expect(r.prosecdef, r.proname).toBe(false);
        expect(r.proconfig, r.proname).toContain('search_path=""');
        expect(r.public_exec, r.proname).toBe(false);
        expect(r.service_exec, r.proname).toBe(true);
      }
    } finally {
      await client.end();
    }
  });
});
