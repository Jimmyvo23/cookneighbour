// T-035 Tester: static guards that need no database. They fail if someone changes one side of a
// duplicated rule, loosens the migration's privileges, or moves the admin gate. The database-backed
// behaviour is covered by tests/api/admin-chefs-*.test.ts and tests/rls/admin-decisions.test.ts.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./admin-chefs";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const SQL = read("supabase/migrations/20261010120000_admin_chef_decisions.sql");
const sqlCode = SQL.split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

function body(fn: string): string {
  const start = sqlCode.indexOf(`create function public.${fn}(`);
  expect(start, fn).toBeGreaterThanOrEqual(0);
  const open = sqlCode.indexOf("as $$", start);
  const close = sqlCode.indexOf("$$;", open + 5);
  return sqlCode.slice(open, close);
}

describe("approve rules: SQL and TypeScript list the same items in the same order", () => {
  const ts = read("src/lib/domain/chef-application.ts");
  const fnStart = ts.indexOf("export function computeMissing");
  const tsBody = ts.slice(fnStart, ts.indexOf("\n}\n", fnStart));
  const tsItems = [...tsBody.matchAll(/m\.push\("(\w+)"\)/g)].map((m) => m[1]);
  const sqlItems = [
    ...body("admin_approve_chef").matchAll(/array_append\(missing, '(\w+)'\)/g),
  ].map((m) => m[1]);

  it("has the 16 known items (a new rule must be added to both sides)", () => {
    expect(tsItems).toHaveLength(16);
    expect(sqlItems).toHaveLength(16);
  });
  it("matches item by item", () => {
    expect(sqlItems).toEqual(tsItems);
  });
  it("the kitchen items are the only ones behind the chef_home condition on both sides", () => {
    const kitchen = [
      "kitchenAddress",
      "kitchenPhotos",
      "kitchenHygieneAcknowledgement",
    ];
    expect(tsItems.slice(-3)).toEqual(kitchen);
    expect(sqlItems.slice(-3)).toEqual(kitchen);
    // The kitchen review function uses the same three names in the same order.
    const k = [
      ...body("admin_review_kitchen").matchAll(
        /array_append\(missing, '(\w+)'\)/g,
      ),
    ].map((m) => m[1]);
    expect(k).toEqual(kitchen);
  });
});

describe("migration 20261010120000: privileges and scope", () => {
  const fns = [
    ["admin_approve_chef", "uuid"],
    ["admin_reject_chef", "uuid, text"],
    ["admin_review_kitchen", "uuid, text, text, text[], jsonb"],
  ] as const;

  it("creates exactly three functions, SECURITY INVOKER, search_path ''", () => {
    expect(sqlCode.match(/create (or replace )?function/g)).toHaveLength(3);
    expect(sqlCode).not.toMatch(/security\s+definer/i);
    expect(sqlCode.match(/set search_path = ''/g)).toHaveLength(3);
  });
  it("revokes from public, anon, authenticated and grants only to service_role", () => {
    for (const [name, args] of fns) {
      expect(sqlCode).toContain(
        `revoke execute on function public.${name}(${args}) from public, anon, authenticated;`,
      );
      expect(sqlCode).toContain(
        `grant execute on function public.${name}(${args}) to service_role;`,
      );
    }
    expect(sqlCode.match(/\bgrant\b/gi)).toHaveLength(3);
    expect(sqlCode).not.toMatch(/\bto\s+(public|anon|authenticated)\b/i);
  });
  it("changes no table, column, policy, trigger, index or existing row", () => {
    expect(sqlCode).not.toMatch(
      /\b(create|alter|drop)\s+(table|policy|trigger|index|type|extension|schema)\b/i,
    );
    expect(sqlCode).not.toMatch(/\bdelete\s+from\b|\btruncate\b/i);
    // Writes are limited to the decision columns and the notification insert.
    const updates = [
      ...sqlCode.matchAll(/update public\.(\w+) set (\w+) =/g),
    ].map((m) => `${m[1]}.${m[2]}`);
    expect(new Set(updates)).toEqual(
      new Set([
        "chef_private.reject_reason",
        "chefs.status",
        "chef_private.kitchen_status",
        "chefs.chef_home_enabled",
      ]),
    );
    const inserts = [...sqlCode.matchAll(/insert into public\.(\w+)/g)].map(
      (m) => m[1],
    );
    expect(new Set(inserts)).toEqual(new Set(["notifications"]));
  });
  it("locks chefs, then chef_private, in every function that writes", () => {
    for (const [name] of fns) {
      const b = body(name);
      const a = b.indexOf("from public.chefs where profile_id");
      const c = b.indexOf("from public.chef_private where chef_id");
      expect(a, name).toBeGreaterThan(-1);
      expect(c, name).toBeGreaterThan(a);
      expect(b.slice(a, c), name).toContain("for no key update");
    }
  });
});

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? listTs(p) : [p];
  });
}

describe("admin gate and logging (source guards)", () => {
  const routes = listTs(path.join(ROOT, "src/app/api/admin")).filter((f) =>
    f.endsWith("route.ts"),
  );
  const server = read("src/lib/server/admin-chefs.ts");

  it("finds the six route files", () => {
    expect(routes).toHaveLength(6);
  });
  it("every route calls requireAdmin first, before any other await", () => {
    for (const f of routes) {
      const src = readFileSync(f, "utf8");
      const first = src.indexOf("await ");
      expect(src.slice(first, first + 40), f).toContain("requireAdmin()");
      expect(src, f).not.toMatch(
        /createAdminClient|getSession|user_metadata|app_metadata/,
      );
    }
  });
  it("the service-role client is created in one place, after the role check", () => {
    expect(server.match(/createAdminClient\(\)/g)).toHaveLength(1);
    const gate = server.slice(
      server.indexOf("export async function requireAdmin"),
    );
    expect(gate.indexOf('caller.role !== "admin"')).toBeGreaterThan(-1);
    expect(gate.indexOf('caller.role !== "admin"')).toBeLessThan(
      gate.indexOf("createAdminClient()"),
    );
    expect(server).not.toMatch(/user_metadata|app_metadata|getSession/);
  });
  it("only one log call, and it carries only the action, admin id and chef id", () => {
    expect(server.match(/console\.\w+\(/g)).toHaveLength(1);
    expect(server).toContain(
      "console.info(`api: admin ${action} admin=${adminId} chef=${chefId}`)",
    );
    // Every call site passes a fixed action name, never user text.
    for (const m of server.matchAll(/(?<!function )logDecision\(([^,]+),/g))
      expect(m[1]).toMatch(/^("[a-z ]+"|`kitchen \$\{k\.decision\}`)$/);
  });
  it("signed URLs use a fixed 300 s lifetime and are never logged or cached by the server module", () => {
    expect(server).toContain("export const SIGNED_URL_SECONDS = 300;");
    expect(server).not.toMatch(/console\.\w+\([^)]*(url|signed)/i);
  });
});

describe("cursor tampering (extra cases)", () => {
  const ID = "0b9ff32e-2f0a-4f6e-9a3d-6a5c1d0c9a11";
  const enc = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  it("refuses whitespace, quotes, separators, uppercase ids and oversize input", () => {
    for (const t of [
      "2026-10-08T12:00:00Z ",
      " 2026-10-08T12:00:00Z",
      "2026-10-08 12:00:00Z",
      "2026-10-08T12:00:00Z\n",
      "2026-10-08T12:00:00.1234567Z",
      "2026-10-08T12:00:00",
      "2026-10-08T12:00:00Z,id.gt.0",
      "2026-10-08T12:00:00Z)",
      "2026-10-08T12:00:00+0000",
      "2026-10-08T12:00:00%2B00:00",
    ])
      expect(decodeCursor(enc({ t, id: ID })), t).toBeNull();
    expect(
      decodeCursor(enc({ t: "2026-10-08T12:00:00Z", id: ID.toUpperCase() })),
    ).toBeNull();
    expect(decodeCursor("A".repeat(201))).toBeNull();
  });
  it("round-trips the shorter fractions PostgREST can return", () => {
    for (const t of [
      "2026-10-08T12:00:00+00:00",
      "2026-10-08T12:00:00.1+00:00",
      "2026-10-08T12:00:00.12345+00:00",
    ])
      expect(decodeCursor(encodeCursor(t, ID))?.createdAt).toBe(
        t.replace("+00:00", "Z"),
      );
  });
});
