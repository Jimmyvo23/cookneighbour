// T-048 fix round: guards on the text of migration 20261023100000. The behaviour is tested on the
// database in tests/api and tests/rls; these catch an edit that would silently bring a rule back.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  "supabase/migrations/20261023100000_report_never_blocks.sql",
  "utf8",
);
const code = SQL.split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n")
  .replace(/\s+/g, " ");

const part = (from: string, to: string) =>
  code.slice(code.indexOf(from), code.indexOf(to));

describe("migration 20261023100000", () => {
  it("anon reads only the safe review columns", () => {
    expect(code).toContain("revoke select on public.reviews from anon;");
    expect(code).toContain(
      "grant select (id, author_role, rating, comment, created_at) on public.reviews to anon;",
    );
    const grant = code.slice(code.indexOf("grant select (id,"));
    const cols = grant.slice(0, grant.indexOf(")"));
    for (const hidden of [
      "author_id",
      "booking_id",
      "subject_id",
      "author_display_name",
    ])
      expect(cols).not.toContain(hidden);
  });

  it("no completion path looks at a report any more", () => {
    const change = part(
      "create or replace function public.change_booking",
      "create or replace function public.sweep_booking_changes",
    );
    const sweep = part(
      "create or replace function public.sweep_booking_changes",
      "create or replace function public.admin_decide_booking",
    );
    expect(code).not.toContain("problem_reported");
    expect(change).not.toMatch(/public\.reports/);
    expect(sweep).not.toMatch(/public\.reports/);
  });

  it("the decision function is still service role only", () => {
    expect(code).toContain(
      "revoke execute on function public.admin_decide_booking(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;",
    );
    expect(code).toContain(
      "grant execute on function public.admin_decide_booking(uuid, text, uuid, uuid, text, text) to service_role;",
    );
  });

  it("a completed booking may be given a final status; the reporter alone gets the closing notice", () => {
    expect(code).toContain(
      "if b.status not in ('accepted', 'completed') and p_final is not null",
    );
    expect(code).toContain("values (r.reporter_id, b.id, 'report_closed'");
    expect(code).toContain("'An admin closed your problem report'");
    const body = code.slice(
      code.indexOf("'An admin has looked at your report"),
      code.indexOf("'An admin has looked at your report") + 80,
    );
    expect(body).not.toMatch(/note|reason/i);
  });
});
