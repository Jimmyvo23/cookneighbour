// T-048: guards on the text of migration 20261022100000 (reviews, reports, admin decisions). The
// real behaviour is tested on the database in tests/rls and tests/api; these catch an edit that
// would silently weaken a rule.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bookingDecidedBody } from "./reviews";

const SQL = readFileSync(
  "supabase/migrations/20261022100000_reviews_reports.sql",
  "utf8",
);
const code = SQL.split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n")
  .replace(/\s+/g, " ");

describe("migration 20261022100000", () => {
  it("the decision function is service role only", () => {
    expect(code).toContain(
      "revoke execute on function public.admin_decide_booking(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;",
    );
    expect(code).toContain(
      "grant execute on function public.admin_decide_booking(uuid, text, uuid, uuid, text, text) to service_role;",
    );
  });
  it("the decision function locks the booking row before the report row", () => {
    const b = code.indexOf(
      "from public.bookings where id = v_booking for update",
    );
    const r = code.indexOf(
      "from public.reports where id = p_report for update",
    );
    expect(b).toBeGreaterThan(0);
    expect(r).toBeGreaterThan(b);
    // Every status change comes after both locks.
    expect(code.indexOf("update public.bookings set status")).toBeGreaterThan(
      r,
    );
  });
  it("the audit table has row-level security and no client grant", () => {
    expect(code).toContain(
      "alter table public.admin_decisions enable row level security;",
    );
    expect(code).not.toMatch(/grant [^;]* on public\.admin_decisions/);
  });
  it("reports cannot be updated from a browser, and one open report per reporter is a unique index", () => {
    expect(code).toContain(
      "revoke update on public.reports from authenticated;",
    );
    expect(code).toMatch(
      /create unique index reports_one_open_per_reporter on public\.reports \(reporter_id, booking_id\) where status in \('open', 'reviewing'\);/,
    );
    expect(code).toContain(
      "create unique index reports_reporter_client_id on public.reports (reporter_id, client_id);",
    );
  });
  it("the review insert policy checks the completed status and the window", () => {
    const policy = code.slice(
      code.indexOf("create policy reviews_insert_party"),
    );
    expect(policy).toContain("b.status = 'completed'");
    expect(policy).toContain("public.review_window_days() * 24");
    expect(policy).toContain("author_id = (select auth.uid())");
  });
  it("the notice text in SQL is the text of bookingDecidedBody for every status", () => {
    expect(code).toContain(
      "'An admin reviewed this booking and set it to ' || v_words || '.'",
    );
    const words: Record<string, string> = {
      completed: "completed",
      cancelled: "cancelled",
      no_show_chef: "a chef no-show",
      no_show_customer: "a customer no-show",
    };
    for (const [status, w] of Object.entries(words)) {
      expect(code).toContain(`'${w}'`);
      expect(
        bookingDecidedBody(status as keyof typeof words as "completed"),
      ).toBe(`An admin reviewed this booking and set it to ${w}.`);
    }
    // The notice never mentions a report, a flag or a note.
    const notice = code.slice(
      code.indexOf("'booking_decided'"),
      code.indexOf("'booking_decided'") + 200,
    );
    expect(notice).not.toMatch(/report|flag|note/i);
  });
  it("the cancel path stores no admin note as the cancel reason", () => {
    const cancelled = code.slice(
      code.indexOf("elsif v_status = 'cancelled'"),
      code.indexOf("no_show_reported_at = v_at"),
    );
    expect(cancelled).not.toContain("cancel_reason");
  });
});
