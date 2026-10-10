// T-061 (D-21): static guards for migration 20261010150000, which replaces two of the T-035
// functions. They fail if the new file drifts from the old one beyond the two intended changes,
// loosens the privileges, or touches anything but those functions.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(path.join(process.cwd(), rel), "utf8");
const strip = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const OLD = strip(
  read("supabase/migrations/20261010120000_admin_chef_decisions.sql"),
);
const NEW = strip(
  read("supabase/migrations/20261010150000_admin_rules_d21.sql"),
);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function body(sql: string, fn: string, create: string): string {
  const start = sql.indexOf(`${create} public.${fn}(`);
  expect(start, fn).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf("as $$", start);
  return sql.slice(open, sql.indexOf("$$;", open + 5));
}

describe("migration 20261010150000: scope and privileges", () => {
  it("only replaces the reject and kitchen-review functions, invoker rights, empty search_path", () => {
    expect(NEW.match(/create or replace function/g)).toHaveLength(2);
    expect(NEW).not.toMatch(/create function/);
    expect(NEW).not.toMatch(/security\s+definer/i);
    expect(NEW.match(/set search_path = ''/g)).toHaveLength(2);
    expect(NEW).not.toMatch(
      /\b(create|alter|drop)\s+(table|policy|trigger|index|type|extension|schema)\b/i,
    );
    expect(NEW).not.toMatch(/\bdelete\s+from\b|\btruncate\b/i);
  });
  it("service_role only", () => {
    for (const sig of [
      "admin_reject_chef(uuid, text)",
      "admin_review_kitchen(uuid, text, text, text[], jsonb)",
    ]) {
      expect(NEW).toContain(
        `revoke execute on function public.${sig} from public, anon, authenticated;`,
      );
      expect(NEW).toContain(
        `grant execute on function public.${sig} to service_role;`,
      );
    }
    expect(NEW.match(/\bgrant\b/gi)).toHaveLength(2);
    expect(NEW).not.toMatch(/\bto\s+(public|anon|authenticated)\b/i);
  });
});

describe("the two replaced functions differ from the old ones only as D-21 says", () => {
  it("reject: same body except chef_home_enabled = false is added to the status update", () => {
    const o = body(OLD, "admin_reject_chef", "create function");
    const n = body(NEW, "admin_reject_chef", "create or replace function");
    expect(n).toContain(
      "update public.chefs set status = 'rejected', chef_home_enabled = false where profile_id = p_chef_id;",
    );
    expect(squash(n.replace(", chef_home_enabled = false", ""))).toBe(
      squash(o),
    );
  });
  it("kitchen review: same body except a pending-or-approved status check before the stale checks", () => {
    const o = body(OLD, "admin_review_kitchen", "create function");
    const n = body(NEW, "admin_review_kitchen", "create or replace function");
    const guard = `if c.status not in ('pending', 'approved') then return jsonb_build_object('result', 'invalid_state', 'status', c.status); end if;`;
    expect(squash(n)).toContain(guard);
    expect(squash(n).replace(guard + " ", "")).toBe(squash(o));
    // The check comes after the locks and before anything is compared or written.
    const flat = squash(n);
    expect(flat.indexOf(guard)).toBeGreaterThan(
      flat.indexOf("for no key update"),
    );
    expect(flat.indexOf(guard)).toBeLessThan(flat.indexOf("'stale'"));
    expect(flat.indexOf(guard)).toBeLessThan(flat.indexOf("update public."));
  });
});
