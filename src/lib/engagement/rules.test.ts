import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/client";
import {
  COMMENT_MAX,
  DESCRIPTION_MAX,
  NOTE_MAX,
  NOTE_MIN,
  allowanceText,
  blockReasonText,
  decisionEffectText,
  finalStatusChoices,
  parseDecisionForm,
  parseReportForm,
  parseReviewForm,
  reportErrorText,
  reportStatusText,
  reviewErrorText,
} from "./rules";

describe("parseReviewForm", () => {
  it("needs a rating from 1 to 5", () => {
    for (const r of [null, 0, 6, 2.5])
      expect(parseReviewForm({ rating: r, comment: "" })).toMatchObject({
        ok: false,
        fields: { rating: expect.any(String) },
      });
  });
  it("trims the comment and leaves an empty one out", () => {
    expect(parseReviewForm({ rating: 5, comment: "  " })).toEqual({
      ok: true,
      request: { rating: 5 },
    });
    expect(parseReviewForm({ rating: 4, comment: " Lovely food \n" })).toEqual({
      ok: true,
      request: { rating: 4, comment: "Lovely food" },
    });
  });
  it("refuses a comment over 1000 characters, counted after trimming", () => {
    expect(
      parseReviewForm({ rating: 3, comment: "a".repeat(COMMENT_MAX + 1) }),
    ).toMatchObject({ ok: false, fields: { comment: expect.any(String) } });
    expect(
      parseReviewForm({ rating: 3, comment: ` ${"a".repeat(COMMENT_MAX)} ` }),
    ).toMatchObject({ ok: true });
  });
  it("refuses control characters but allows line breaks", () => {
    expect(parseReviewForm({ rating: 3, comment: "a\u0000b" })).toMatchObject({
      ok: false,
    });
    expect(parseReviewForm({ rating: 3, comment: "a\nb" })).toMatchObject({
      ok: true,
    });
  });
});

describe("parseReportForm", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("needs a description of 1 to 2000 characters", () => {
    expect(
      parseReportForm({ clientId: id, category: "other", description: " " }),
    ).toMatchObject({ ok: false, fields: { description: expect.any(String) } });
    expect(
      parseReportForm({
        clientId: id,
        category: "other",
        description: "x".repeat(DESCRIPTION_MAX + 1),
      }),
    ).toMatchObject({ ok: false });
  });
  it("sends the category, the client id and the trimmed text", () => {
    expect(
      parseReportForm({
        clientId: id,
        category: "safety",
        description: " It was cold ",
      }),
    ).toEqual({
      ok: true,
      request: { clientId: id, category: "safety", description: "It was cold" },
    });
  });
  it("refuses an unknown category", () => {
    expect(
      parseReportForm({ clientId: id, category: "spam", description: "x" }),
    ).toMatchObject({ ok: false, fields: { category: expect.any(String) } });
  });
});

describe("parseDecisionForm", () => {
  it("needs a note of 3 to 500 characters", () => {
    for (const note of ["", "ab", "x".repeat(NOTE_MAX + 1)])
      expect(
        parseDecisionForm({
          kind: "dismiss",
          bookingStatus: "completed",
          finalStatus: "",
          note,
        }),
      ).toMatchObject({ ok: false, fields: { note: expect.any(String) } });
    expect(NOTE_MIN).toBe(3);
  });
  it("requires a final status when resolving a report on an accepted booking", () => {
    expect(
      parseDecisionForm({
        kind: "resolve",
        bookingStatus: "accepted",
        finalStatus: "",
        note: "Checked it",
      }),
    ).toMatchObject({ ok: false, fields: { finalStatus: expect.any(String) } });
    expect(
      parseDecisionForm({
        kind: "resolve",
        bookingStatus: "accepted",
        finalStatus: "cancelled",
        note: "Checked it",
      }),
    ).toEqual({
      ok: true,
      request: { finalStatus: "cancelled", note: "Checked it" },
    });
  });
  it("leaves the final status out for a booking that is not accepted", () => {
    expect(
      parseDecisionForm({
        kind: "resolve",
        bookingStatus: "completed",
        finalStatus: "cancelled",
        note: "Checked it",
      }),
    ).toEqual({ ok: true, request: { note: "Checked it" } });
  });
  it("never sends a final status with a dismissal", () => {
    expect(
      parseDecisionForm({
        kind: "dismiss",
        bookingStatus: "accepted",
        finalStatus: "cancelled",
        note: "Not an issue",
      }),
    ).toEqual({ ok: true, request: { note: "Not an issue" } });
  });
  it("always requires a final status for a flag", () => {
    expect(
      parseDecisionForm({
        kind: "flag",
        bookingStatus: "accepted",
        finalStatus: "",
        note: "Checked it",
      }),
    ).toMatchObject({ ok: false, fields: { finalStatus: expect.any(String) } });
  });
});

describe("texts", () => {
  it("offers the four final statuses of D-54", () => {
    expect(finalStatusChoices().map((c) => c.value)).toEqual([
      "completed",
      "cancelled",
      "no_show_chef",
      "no_show_customer",
    ]);
  });
  it("says what a final status does to the free trial, using the shared rule", () => {
    expect(decisionEffectText("completed", false, true)).toMatch(/used up/);
    expect(decisionEffectText("cancelled", false, true)).toMatch(/given back/);
    expect(decisionEffectText("cancelled", true, true)).toMatch(/used up/);
    expect(decisionEffectText("no_show_chef", false, false)).not.toMatch(
      /free first booking/,
    );
  });
  it("words each report status plainly", () => {
    expect(reportStatusText("open")).toMatch(/waiting/i);
    expect(reportStatusText("reviewing")).toMatch(/admin/i);
    expect(reportStatusText("resolved")).toMatch(/resolved/i);
    expect(reportStatusText("dismissed")).toMatch(/closed/i);
  });
  it("explains why a review is not allowed", () => {
    expect(
      allowanceText({
        allowed: false,
        reason: "not_completed",
        closesAt: null,
      }),
    ).toMatch(/completed/);
    expect(
      allowanceText({
        allowed: false,
        reason: "window_closed",
        closesAt: "2026-10-01T12:00:00.000Z",
      }),
    ).toMatch(/14 days/);
    expect(
      allowanceText({
        allowed: false,
        reason: "already_reviewed",
        closesAt: null,
      }),
    ).toMatch(/already/);
    expect(
      allowanceText({ allowed: true, reason: null, closesAt: null }),
    ).toBeNull();
  });
  it("words the free-trial block reasons for the admin", () => {
    expect(blockReasonText("phone")).toMatch(/phone/i);
    expect(blockReasonText("address")).toMatch(/address/i);
    expect(blockReasonText("customer")).toMatch(/already/i);
  });
  it("maps review refusals by reason", () => {
    const e = (reason: string) =>
      new ApiClientError(409, "INVALID_STATE", "server text", { reason });
    expect(reviewErrorText(e("window_closed"))).toMatch(/14 days/);
    expect(reviewErrorText(e("already_reviewed"))).toMatch(/already/);
    expect(reviewErrorText(e("not_completed"))).toMatch(/completed/);
  });
  it("uses the server text for report_open and other errors", () => {
    expect(
      reportErrorText(
        new ApiClientError(
          409,
          "INVALID_STATE",
          "You already have a problem report open.",
          {
            reason: "report_open",
          },
        ),
      ),
    ).toBe("You already have a problem report open.");
    expect(reportErrorText(new Error("x"))).toMatch(/went wrong/i);
  });
});
