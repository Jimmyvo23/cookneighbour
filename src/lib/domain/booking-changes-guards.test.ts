// T-063: static guards for migration 20261011200000. The reject function must equal the D-21 one
// plus the marked D-22 cascade; every new function is server-only (SECURITY INVOKER, empty
// search_path, service_role only); the lock order is chef then booking.
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
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const RAW = read("supabase/migrations/20261011200000_booking_changes.sql");
const NEW = strip(RAW);
const D21 = strip(
  read("supabase/migrations/20261010150000_admin_rules_d21.sql"),
);

function body(sql: string, fn: string): string {
  const start = sql.indexOf(`function public.${fn}(`);
  expect(start, fn).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf("as $$", start);
  return sql.slice(open, sql.indexOf("$$;", open + 5));
}

describe("migration 20261011200000", () => {
  it("every function is SECURITY INVOKER with an empty search_path and no delete", () => {
    expect(NEW).not.toMatch(/security\s+definer/i);
    const fns = NEW.match(/create or replace function/g) ?? [];
    expect(fns.length).toBe(7);
    expect(NEW.match(/set search_path = ''/g)).toHaveLength(fns.length);
    expect(NEW).not.toMatch(/\bdelete\s+from\b|\btruncate\b|\bdrop\b/i);
  });
  it("grants only to service_role (plus select on the two new tables to authenticated)", () => {
    expect(NEW).not.toMatch(/\bto\s+(public|anon)\b/i);
    const grants = NEW.match(/\bgrant\b[^;]*;/gi) ?? [];
    for (const g of grants)
      expect(g).toMatch(
        /to service_role;|grant select on public\.(pickup_proposals|booking_flags) to authenticated;/i,
      );
    expect(NEW).toContain(
      "alter table public.pickup_proposals enable row level security",
    );
    expect(NEW).toContain(
      "alter table public.booking_flags enable row level security",
    );
  });
  it("reject: the D-21 body plus the marked D-22 cascade, nothing else", () => {
    const o = body(D21, "admin_reject_chef");
    // The cascade markers are comments, so compare using the raw text.
    const raw = body(RAW, "admin_reject_chef")
      .replace(/-- D-22 cascade begin[\s\S]*?-- D-22 cascade end/, "")
      .replace(
        "return jsonb_build_object('result', 'ok', 'cancelled', to_jsonb(v_cancelled), 'flagged', to_jsonb(v_flagged));",
        "return jsonb_build_object('result', 'ok');",
      )
      .replace(/\n\s*v_cancelled uuid\[\];\n\s*v_flagged uuid\[\];/, "")
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");
    expect(squash(raw)).toBe(squash(o));
  });
  it("lock order is chef, then booking, in answer_booking", () => {
    const a = squash(body(NEW, "answer_booking"));
    expect(
      a.indexOf("from public.chefs where profile_id = p_chef for share"),
    ).toBeGreaterThan(0);
    expect(
      a.indexOf("from public.chefs where profile_id = p_chef for share"),
    ).toBeLessThan(
      a.indexOf(
        "from public.bookings where id = p_booking and chef_id = p_chef for update",
      ),
    );
    expect(a).toContain("not c.chef_home_enabled");
  });
  it("change_booking locks the booking row first and every state change is under that lock", () => {
    const c = squash(body(NEW, "change_booking"));
    expect(c).toContain("from public.bookings where id = p_booking for update");
    expect(c.indexOf("for update")).toBeLessThan(
      c.indexOf("update public.bookings"),
    );
  });
});
