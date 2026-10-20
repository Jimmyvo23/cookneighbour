// @vitest-environment jsdom
// T-049 Tester: rules at their edges, and the admin chat wording. Real fetch is stubbed.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  harness,
  json,
  routes,
  type Harness,
} from "@/components/booking/testkit";
import {
  parseDecisionForm,
  parseReportForm,
  parseReviewForm,
} from "@/lib/engagement/rules";
import { AdminChatView } from "./AdminEngagementViews";

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

describe("T-049 tester: review and report form edges", () => {
  it.each([0, 6, 2.5, -1, Number.NaN, null])("rating %s is refused", (r) => {
    expect(parseReviewForm({ rating: r, comment: "" }).ok).toBe(false);
  });
  it("comment: 1000 characters pass (trailing spaces do not count), 1001 do not; line breaks pass, NUL does not", () => {
    expect(
      parseReviewForm({ rating: 5, comment: `${"a".repeat(1000)}   ` }).ok,
    ).toBe(true);
    expect(parseReviewForm({ rating: 5, comment: "a".repeat(1001) }).ok).toBe(
      false,
    );
    expect(parseReviewForm({ rating: 5, comment: "a\nb\tc" }).ok).toBe(true);
    expect(parseReviewForm({ rating: 5, comment: "a\u0000b" }).ok).toBe(false);
    const empty = parseReviewForm({ rating: 3, comment: "   " });
    expect(empty.ok && empty.request).toEqual({ rating: 3 });
  });
  it("report: category and description are both required; 2000 characters pass, 2001 do not", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(
      parseReportForm({ clientId: id, category: "", description: "  " }),
    ).toMatchObject({ ok: false, fields: { category: expect.any(String) } });
    expect(
      parseReportForm({ clientId: id, category: "other", description: "x" }).ok,
    ).toBe(true);
    expect(
      parseReportForm({
        clientId: id,
        category: "other",
        description: "x".repeat(2000),
      }).ok,
    ).toBe(true);
    expect(
      parseReportForm({
        clientId: id,
        category: "other",
        description: "x".repeat(2001),
      }).ok,
    ).toBe(false);
    expect(
      parseReportForm({ clientId: id, category: "hack", description: "x" }).ok,
    ).toBe(false);
  });
});

describe("T-049 tester: admin decision form edges (D-54, D-57, contract 7D)", () => {
  const base = { finalStatus: "", note: "Checked with both." };
  it("note: 2 characters refused, 3 pass, 500 pass, 501 refused", () => {
    const p = (note: string) =>
      parseDecisionForm({
        kind: "dismiss",
        bookingStatus: "accepted",
        finalStatus: "",
        note,
      }).ok;
    expect([p("ab"), p("abc"), p("a".repeat(500)), p("a".repeat(501))]).toEqual(
      [false, true, true, false],
    );
    expect(p("   ab   ")).toBe(false);
  });
  it("dismiss never sends a status, even if one is left in the form", () => {
    const r = parseDecisionForm({
      kind: "dismiss",
      bookingStatus: "accepted",
      finalStatus: "cancelled",
      note: "ok then",
    });
    expect(r.ok && r.request).toEqual({ note: "ok then" });
  });
  it("resolve: a status is required on accepted, optional on completed, never sent on any other status", () => {
    expect(
      parseDecisionForm({ kind: "resolve", bookingStatus: "accepted", ...base })
        .ok,
    ).toBe(false);
    const done = parseDecisionForm({
      kind: "resolve",
      bookingStatus: "completed",
      ...base,
    });
    expect(done.ok && done.request).toEqual({ note: base.note });
    const keep = parseDecisionForm({
      kind: "resolve",
      bookingStatus: "completed",
      finalStatus: "completed",
      note: base.note,
    });
    expect(keep.ok && keep.request).toEqual({ note: base.note });
    const moved = parseDecisionForm({
      kind: "resolve",
      bookingStatus: "completed",
      finalStatus: "no_show_chef",
      note: base.note,
    });
    expect(moved.ok && moved.request).toEqual({
      note: base.note,
      finalStatus: "no_show_chef",
    });
    for (const s of ["cancelled", "declined", "expired", "no_show_customer"]) {
      const r = parseDecisionForm({
        kind: "resolve",
        bookingStatus: s,
        finalStatus: "cancelled",
        note: base.note,
      });
      expect(r.ok && r.request).toEqual({ note: base.note });
    }
  });
  it("flag: a status is always required", () => {
    expect(
      parseDecisionForm({ kind: "flag", bookingStatus: "accepted", ...base })
        .ok,
    ).toBe(false);
    expect(
      parseDecisionForm({
        kind: "flag",
        bookingStatus: "accepted",
        finalStatus: "completed",
        note: base.note,
      }).ok,
    ).toBe(true);
  });
});

describe("T-049 tester: admin chat", () => {
  it("the chat count line says 'oldest first', not 'newest first' (T49-F1)", async () => {
    const id = "00000000-0000-4000-8000-000000000002";
    routes(h.fetchMock, {
      [`GET /api/admin/bookings/${id}/messages`]: json(200, {
        items: [
          {
            id: "00000000-0000-4000-8000-000000000003",
            bookingId: id,
            senderId: "00000000-0000-4000-8000-000000000004",
            senderRole: "customer",
            senderName: "Priya Patel",
            clientId: null,
            body: "Hello chef",
            createdAt: "2026-10-20T10:00:00.000Z",
          },
        ],
        nextCursor: null,
      }),
    });
    await h.mount(<AdminChatView bookingId={id} />);
    expect(h.q("list-count")!.textContent).not.toMatch(/newest first/i);
    expect(h.q("list-count")!.textContent).toMatch(/oldest first/i);
  });
});
