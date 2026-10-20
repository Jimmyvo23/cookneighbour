import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REVIEW_WINDOW_DAYS } from "./config";
import {
  FINAL_STATUSES,
  firstNameOf,
  REPORT_CATEGORIES,
  bookingDecidedBody,
  parseDecisionBody,
  parseReportBody,
  parseReviewBody,
  reviewAllowance,
  reviewWindowEnd,
} from "./reviews";

const DAY = 24 * 3_600_000;
const COMPLETED = new Date("2026-10-01T15:00:00.000Z");

describe("review window (14 days, configurable)", () => {
  it("is 14 days and the SQL function says the same number", () => {
    expect(REVIEW_WINDOW_DAYS).toBe(14);
    const sql = readFileSync(
      "supabase/migrations/20261022100000_reviews_reports.sql",
      "utf8",
    );
    const m = sql.match(
      /function public\.review_window_days\(\)[\s\S]*?select\s+(\d+)/i,
    );
    expect(Number(m?.[1])).toBe(REVIEW_WINDOW_DAYS);
  });

  it("ends exactly 14 x 24 hours after completion", () => {
    expect(reviewWindowEnd(COMPLETED).getTime()).toBe(
      COMPLETED.getTime() + 14 * DAY,
    );
  });

  it("is open on day 14 (to the instant) and closed one millisecond later", () => {
    const end = reviewWindowEnd(COMPLETED);
    const base = { status: "completed", completedAt: COMPLETED };
    expect(
      reviewAllowance({ ...base, now: new Date(end.getTime() - 1) }).allowed,
    ).toBe(true);
    expect(reviewAllowance({ ...base, now: end }).allowed).toBe(true);
    const late = reviewAllowance({ ...base, now: new Date(end.getTime() + 1) });
    expect(late).toEqual({
      allowed: false,
      reason: "window_closed",
      closesAt: end.toISOString(),
    });
  });

  it("day 14 versus day 15 for a completion at noon", () => {
    const noon = new Date("2026-10-01T12:00:00.000Z");
    const day14 = new Date(noon.getTime() + 14 * DAY - 60_000);
    const day15 = new Date(noon.getTime() + 15 * DAY);
    expect(
      reviewAllowance({ status: "completed", completedAt: noon, now: day14 })
        .allowed,
    ).toBe(true);
    expect(
      reviewAllowance({ status: "completed", completedAt: noon, now: day15 })
        .reason,
    ).toBe("window_closed");
  });

  it("only a completed booking can be reviewed", () => {
    for (const status of [
      "requested",
      "accepted",
      "declined",
      "cancelled",
      "expired",
      "no_show_customer",
      "no_show_chef",
    ])
      expect(
        reviewAllowance({ status, completedAt: null, now: COMPLETED }),
      ).toEqual({ allowed: false, reason: "not_completed", closesAt: null });
  });

  it("a second review is refused and says so first", () => {
    expect(
      reviewAllowance({
        status: "completed",
        completedAt: COMPLETED,
        now: COMPLETED,
        alreadyReviewed: true,
      }).reason,
    ).toBe("already_reviewed");
  });
});

describe("parseReviewBody", () => {
  it("accepts a rating alone and a trimmed comment", () => {
    expect(parseReviewBody({ rating: 5 })).toEqual({
      ok: true,
      rating: 5,
      comment: null,
    });
    expect(parseReviewBody({ rating: 3, comment: "  Lovely\nfood " })).toEqual({
      ok: true,
      rating: 3,
      comment: "Lovely\nfood",
    });
    expect(parseReviewBody({ rating: 4, comment: "   " })).toMatchObject({
      ok: true,
      comment: null,
    });
  });
  it("refuses a bad rating, a long or unsafe comment and unknown keys, all at once", () => {
    for (const rating of [0, 6, 2.5, "5", null, undefined, NaN])
      expect(parseReviewBody({ rating })).toMatchObject({
        ok: false,
        fields: { rating: expect.any(String) },
      });
    expect(parseReviewBody({ rating: 5, comment: "x".repeat(1001) })).toEqual({
      ok: false,
      fields: { comment: expect.any(String) },
    });
    expect(parseReviewBody({ rating: 5, comment: "a\u0000b" })).toMatchObject({
      ok: false,
    });
    expect(parseReviewBody({ rating: 5, comment: "\ud800" })).toMatchObject({
      ok: false,
    });
    expect(parseReviewBody({ rating: 5, comment: 7 })).toMatchObject({
      ok: false,
    });
    const r = parseReviewBody({ rating: 9, authorId: "x" });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok)
      expect(Object.keys(r.fields).sort()).toEqual(["authorId", "rating"]);
    expect(parseReviewBody({ rating: 5, comment: "x".repeat(1000) }).ok).toBe(
      true,
    );
  });
});

describe("parseReportBody", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  it("accepts the minimal body and defaults the category to other", () => {
    expect(
      parseReportBody({ clientId: id, description: " It was late " }),
    ).toEqual({
      ok: true,
      clientId: id,
      category: "other",
      description: "It was late",
    });
    for (const category of REPORT_CATEGORIES)
      expect(
        parseReportBody({ clientId: id, category, description: "x" }),
      ).toMatchObject({ ok: true, category });
  });
  it("refuses a missing or upper-case clientId, a bad category, empty or long text, unknown keys", () => {
    expect(parseReportBody({ description: "x" })).toMatchObject({
      ok: false,
      fields: { clientId: expect.any(String) },
    });
    expect(
      parseReportBody({ clientId: id.toUpperCase(), description: "x" }),
    ).toMatchObject({ ok: false });
    expect(
      parseReportBody({ clientId: id, category: "rude", description: "x" }),
    ).toMatchObject({ ok: false, fields: { category: expect.any(String) } });
    expect(parseReportBody({ clientId: id, description: "  " })).toMatchObject({
      ok: false,
      fields: { description: expect.any(String) },
    });
    expect(
      parseReportBody({ clientId: id, description: "x".repeat(2001) }),
    ).toMatchObject({ ok: false });
    expect(
      parseReportBody({ clientId: id, description: "x".repeat(2000) }).ok,
    ).toBe(true);
    expect(
      parseReportBody({ clientId: id, description: "bad\u0007text" }).ok,
    ).toBe(false);
    expect(
      parseReportBody({ clientId: id, description: "x", status: "resolved" }),
    ).toMatchObject({ ok: false, fields: { status: expect.any(String) } });
  });
});

describe("parseDecisionBody", () => {
  it("lists the four final statuses of D-54", () => {
    expect([...FINAL_STATUSES].sort()).toEqual([
      "cancelled",
      "completed",
      "no_show_chef",
      "no_show_customer",
    ]);
  });
  it("needs a note of 3 to 500 safe characters", () => {
    expect(parseDecisionBody({ note: "ab" }, "none").ok).toBe(false);
    expect(parseDecisionBody({}, "none").ok).toBe(false);
    expect(parseDecisionBody({ note: "x".repeat(501) }, "none").ok).toBe(false);
    expect(parseDecisionBody({ note: "a\u0000b!" }, "none").ok).toBe(false);
    expect(parseDecisionBody({ note: " Checked it " }, "none")).toEqual({
      ok: true,
      finalStatus: null,
      note: "Checked it",
    });
  });
  it("required: finalStatus must be one of the four", () => {
    expect(parseDecisionBody({ note: "abc" }, "required")).toMatchObject({
      ok: false,
      fields: { finalStatus: expect.any(String) },
    });
    for (const bad of ["accepted", "expired", "declined", 1, ""])
      expect(
        parseDecisionBody({ note: "abc", finalStatus: bad }, "required").ok,
      ).toBe(false);
    expect(
      parseDecisionBody(
        { note: "abc", finalStatus: "no_show_chef" },
        "required",
      ),
    ).toEqual({ ok: true, finalStatus: "no_show_chef", note: "abc" });
  });
  it("optional: may be left out; none: the key is unknown", () => {
    expect(parseDecisionBody({ note: "abc" }, "optional")).toMatchObject({
      ok: true,
      finalStatus: null,
    });
    expect(
      parseDecisionBody({ note: "abc", finalStatus: "completed" }, "optional")
        .ok,
    ).toBe(true);
    expect(
      parseDecisionBody({ note: "abc", finalStatus: "completed" }, "none"),
    ).toMatchObject({ ok: false, fields: { finalStatus: "Unknown field." } });
  });
});

describe("booking_decided notice", () => {
  it("never mentions a report, a flag or a note", () => {
    for (const s of FINAL_STATUSES) {
      const body = bookingDecidedBody(s);
      expect(body).toMatch(/^An admin reviewed this booking and set it to /);
      expect(body.toLowerCase()).not.toMatch(
        /report|flag|reporter|note|problem/,
      );
    }
  });
});

describe("firstNameOf (public reviews show the first name only)", () => {
  it("keeps the first word of a multi-word name", () => {
    expect(firstNameOf("Mei Ling Chen")).toBe("Mei");
  });
  it("keeps a single word", () => {
    expect(firstNameOf("Priya")).toBe("Priya");
  });
  it("ignores leading and trailing spaces and any whitespace between words", () => {
    expect(firstNameOf("   Daniel   Okafor  ")).toBe("Daniel");
    expect(firstNameOf("\tAna Silva\n")).toBe("Ana");
  });
  it("falls back to Customer for an empty name", () => {
    expect(firstNameOf("")).toBe("Customer");
    expect(firstNameOf("   ")).toBe("Customer");
  });
});
