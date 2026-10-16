// T-063: pure rules for booking changes (cancel reason, day numbers, pickup time, refusal texts)
// and the D-26 "cooked" marker that decides what a cancellation does to the free trial.
import { describe, expect, it } from "vitest";
import {
  CHANGE_REFUSALS,
  parseCancelReason,
  parseDayNumber,
  parsePickupAccept,
  parseProposedAt,
  pickupDeadline,
  completionDue,
} from "./bookingChanges";
import { freeTrialEffect } from "./cancellation";
import { transitionFreeTrial } from "./freeTrial";

describe("freeTrialEffect with the D-26 cooked marker", () => {
  it("a cancellation before any day was cooked releases the trial", () => {
    expect(freeTrialEffect("cancelled")).toBe("release");
    expect(freeTrialEffect("cancelled", { anyDayCooked: false })).toBe(
      "release",
    );
  });
  it("a cancellation after at least one day was cooked consumes it", () => {
    expect(freeTrialEffect("cancelled", { anyDayCooked: true })).toBe(
      "consume",
    );
  });
  it("the marker changes nothing for the other events", () => {
    for (const e of [
      "requested",
      "accepted",
      "declined",
      "expired",
      "completed",
      "no_show_customer",
    ] as const)
      expect(freeTrialEffect(e, { anyDayCooked: true })).toBe(
        freeTrialEffect(e),
      );
  });
  it("D-37: a chef no-show after a cooked day consumes the trial, otherwise it releases", () => {
    expect(freeTrialEffect("no_show_chef")).toBe("release");
    expect(freeTrialEffect("no_show_chef", { anyDayCooked: false })).toBe(
      "release",
    );
    expect(freeTrialEffect("no_show_chef", { anyDayCooked: true })).toBe(
      "consume",
    );
    expect(
      transitionFreeTrial("held", "no_show_chef", { anyDayCooked: true }),
    ).toEqual({ kind: "change", from: "held", to: "consumed" });
  });
  it("transitionFreeTrial passes the marker on", () => {
    expect(
      transitionFreeTrial("held", "cancelled", { anyDayCooked: true }),
    ).toEqual({ kind: "change", from: "held", to: "consumed" });
    expect(transitionFreeTrial("held", "cancelled")).toEqual({
      kind: "change",
      from: "held",
      to: "released",
    });
    // The opposite outcome on a final claim is still invalid.
    expect(
      transitionFreeTrial("released", "cancelled", { anyDayCooked: true }).kind,
    ).toBe("invalid");
  });
});

describe("parseCancelReason", () => {
  it("is optional", () => {
    expect(parseCancelReason({})).toEqual({ value: null });
    expect(parseCancelReason({ reason: null })).toEqual({ value: null });
    expect(parseCancelReason({ reason: "   " })).toEqual({ value: null });
  });
  it("trims and accepts 3 to 500 characters", () => {
    expect(parseCancelReason({ reason: "  Plans changed  " })).toEqual({
      value: "Plans changed",
    });
    expect(parseCancelReason({ reason: "ab" })).toHaveProperty("error");
    expect(parseCancelReason({ reason: "a".repeat(501) })).toHaveProperty(
      "error",
    );
    expect(parseCancelReason({ reason: "a".repeat(500) })).toEqual({
      value: "a".repeat(500),
    });
  });
  it("refuses non-strings and unsafe text", () => {
    expect(parseCancelReason({ reason: 5 })).toHaveProperty("error");
    expect(parseCancelReason({ reason: "bad\u0000text" })).toHaveProperty(
      "error",
    );
    expect(parseCancelReason({ reason: "bad\ud800text" })).toHaveProperty(
      "error",
    );
  });
  it("flags contact details so the route can answer 422 CONTACT_DETAILS_NOT_ALLOWED", () => {
    expect(parseCancelReason({ reason: "call me 416 555 0100" })).toEqual({
      contact: true,
    });
    expect(parseCancelReason({ reason: "mail a@b.com" })).toEqual({
      contact: true,
    });
  });
});

describe("parseDayNumber", () => {
  it("accepts 1 to 3 only", () => {
    expect(parseDayNumber("1")).toBe(1);
    expect(parseDayNumber("3")).toBe(3);
    for (const bad of ["0", "4", "01", "1.5", "-1", "a", "", " 1", "1e0"])
      expect(parseDayNumber(bad), bad).toBeNull();
  });
});

describe("parseProposedAt", () => {
  it("needs an ISO timestamp with Z or an offset", () => {
    const ok = parseProposedAt("2026-10-20T15:30:00-04:00");
    expect("value" in ok && ok.value.toISOString()).toBe(
      "2026-10-20T19:30:00.000Z",
    );
    expect(parseProposedAt("2026-10-20T15:30:00Z")).toHaveProperty("value");
    expect(parseProposedAt("2026-10-20T15:30:00.123Z")).toHaveProperty("value");
  });
  it("refuses everything else", () => {
    for (const bad of [
      "2026-10-20",
      "2026-10-20T15:30:00",
      "tomorrow",
      "2026-13-40T10:00:00Z",
      "2026-02-30T10:00:00Z",
      "",
      "0000-01-01T00:00:00Z",
      "99999-01-01T00:00:00Z",
    ])
      expect(parseProposedAt(bad), bad).toHaveProperty("error");
    expect(parseProposedAt(5 as unknown as string)).toHaveProperty("error");
    expect(parseProposedAt(undefined as unknown as string)).toHaveProperty(
      "error",
    );
  });
});

describe("parsePickupAccept", () => {
  it("needs a boolean", () => {
    expect(parsePickupAccept({ accept: true })).toEqual({ value: true });
    expect(parsePickupAccept({ accept: false })).toEqual({ value: false });
    for (const bad of [{}, { accept: "true" }, { accept: 1 }, { accept: null }])
      expect(parsePickupAccept(bad)).toHaveProperty("error");
  });
});

describe("pickupDeadline and completionDue (mirror of the SQL helpers)", () => {
  it("a pickup can be arranged up to the end of the earliest eat-by date, Toronto time", () => {
    // 2026-10-20 ends at 2026-10-21 00:00 EDT = 04:00Z.
    expect(pickupDeadline("2026-10-20").toISOString()).toBe(
      "2026-10-21T04:00:00.000Z",
    );
    // Across the November change to standard time: 2026-11-01 ends at 05:00Z the next day... (EST).
    expect(pickupDeadline("2026-11-01").toISOString()).toBe(
      "2026-11-02T05:00:00.000Z",
    );
  });
  it("a booking completes one calendar day after the end of its last visit date", () => {
    expect(completionDue("2026-10-20").toISOString()).toBe(
      "2026-10-22T04:00:00.000Z",
    );
  });
});

describe("refusal texts", () => {
  it("every SQL refusal reason has a message and none contains a placeholder", () => {
    const reasons = [
      "expired",
      "wrong_status",
      "chef_use_decline",
      "nothing_left",
      "too_early",
      "no_visit_due",
      "days_not_cooked",
      "problem_reported",
      "frozen", // T-064 (D-53)
      "not_chef_home",
      "pickup_window_open",
      "pickup_confirmed", // T-071 (D-55)
      "day_not_cooked",
      "deadline_passed",
      "proposal_open",
      "pickup_agreed",
      "no_open_proposal",
      "proposal_past",
    ];
    for (const r of reasons) {
      expect(CHANGE_REFUSALS[r], r).toBeTruthy();
      expect(CHANGE_REFUSALS[r]).not.toMatch(/undefined|\{|\}/);
    }
    expect(Object.keys(CHANGE_REFUSALS).sort()).toEqual([...reasons].sort());
  });
});
