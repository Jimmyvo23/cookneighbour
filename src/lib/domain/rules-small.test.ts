import { describe, expect, it } from "vitest";
import { checkReceipt } from "./receipt";
import { eatByDate } from "./eatBy";
import {
  cancellationTiming,
  freeTrialEffect,
  torontoStartOfDay,
  type FreeTrialEvent,
} from "./cancellation";
import { FREE_CANCELLATION_HOURS } from "./config";

describe("checkReceipt (tolerance is ASSUMPTION A-15: max(15%, $5))", () => {
  it("matches an equal receipt and one within tolerance", () => {
    expect(checkReceipt(8000, 8000).mismatch).toBe(false);
    expect(checkReceipt(8000, 9200).mismatch).toBe(false); // exactly 15%
    expect(checkReceipt(8000, 6800).mismatch).toBe(false);
  });
  it("flags more than the tolerance, either direction, and reports the difference", () => {
    const hi = checkReceipt(8000, 9201);
    expect(hi).toEqual({
      mismatch: true,
      differenceCents: 1201,
      toleranceCents: 1200,
    });
    const lo = checkReceipt(8000, 6799);
    expect(lo.mismatch).toBe(true);
    expect(lo.differenceCents).toBe(-1201);
  });
  it("small estimates use the $5 floor", () => {
    expect(checkReceipt(1000, 1500).mismatch).toBe(false);
    expect(checkReceipt(1000, 1501).mismatch).toBe(true);
    expect(checkReceipt(0, 500).mismatch).toBe(false);
    expect(checkReceipt(0, 501).mismatch).toBe(true);
  });
  it("rejects non-integer or negative cents", () => {
    expect(() => checkReceipt(100, 10.5)).toThrow(RangeError);
    expect(() => checkReceipt(100, -1)).toThrow(RangeError);
    expect(() => checkReceipt(-1, 100)).toThrow(RangeError);
  });
});

describe("eatByDate (A-7)", () => {
  it("adds the shelf life to the cook date", () => {
    expect(eatByDate("2026-10-08", 2)).toBe("2026-10-10");
    expect(eatByDate("2026-10-08", 0)).toBe("2026-10-08");
    expect(eatByDate("2026-12-30", 3)).toBe("2027-01-02");
    expect(eatByDate("2028-02-28", 2)).toBe("2028-03-01"); // leap year
    expect(eatByDate("2026-10-08", 7)).toBe("2026-10-15");
  });
  it("rejects bad input", () => {
    expect(() => eatByDate("2026-02-30", 2)).toThrow(RangeError);
    expect(() => eatByDate("2026-10-08", 8)).toThrow(RangeError);
    expect(() => eatByDate("2026-10-08", -1)).toThrow(RangeError);
    expect(() => eatByDate("2026-10-08", 1.5)).toThrow(RangeError);
  });
});

describe("torontoStartOfDay", () => {
  it("handles winter, summer and the daylight-saving change days", () => {
    expect(torontoStartOfDay("2026-01-15").toISOString()).toBe(
      "2026-01-15T05:00:00.000Z",
    );
    expect(torontoStartOfDay("2026-07-15").toISOString()).toBe(
      "2026-07-15T04:00:00.000Z",
    );
    expect(torontoStartOfDay("2026-03-08").toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
    expect(torontoStartOfDay("2026-03-09").toISOString()).toBe(
      "2026-03-09T04:00:00.000Z",
    );
    expect(torontoStartOfDay("2026-11-01").toISOString()).toBe(
      "2026-11-01T04:00:00.000Z",
    );
    expect(torontoStartOfDay("2026-11-02").toISOString()).toBe(
      "2026-11-02T05:00:00.000Z",
    );
  });
});

describe("cancellationTiming (A-6, 48 hours: ASSUMPTION)", () => {
  const first = "2026-10-20"; // starts 2026-10-20T04:00Z, free until 2026-10-18T04:00Z
  it("is on time up to and including 48 hours before day 1", () => {
    const r = cancellationTiming({
      now: new Date("2026-10-18T04:00:00Z"),
      firstVisitDate: first,
      cancelledBy: "customer",
    });
    expect(r.timing).toBe("on_time");
    expect(r.freeUntil.toISOString()).toBe("2026-10-18T04:00:00.000Z");
  });
  it("is late one second after the deadline, on the day, and after the start", () => {
    for (const now of [
      "2026-10-18T04:00:01Z",
      "2026-10-20T03:00:00Z",
      "2026-10-25T00:00:00Z",
    ])
      expect(
        cancellationTiming({
          now: new Date(now),
          firstVisitDate: first,
          cancelledBy: "chef",
        }).timing,
      ).toBe("late");
  });
  it("is on time weeks ahead, for customer and chef", () => {
    for (const by of ["customer", "chef"] as const) {
      const r = cancellationTiming({
        now: new Date("2026-09-01T12:00:00Z"),
        firstVisitDate: first,
        cancelledBy: by,
      });
      expect(r.timing).toBe("on_time");
      expect(r.cancelledBy).toBe(by);
    }
  });
  it("never consumes the free trial", () => {
    expect(
      cancellationTiming({
        now: new Date("2026-10-20T10:00:00Z"),
        firstVisitDate: first,
        cancelledBy: "customer",
      }).consumesFreeTrial,
    ).toBe(false);
  });
  it("uses the configured hours", () => {
    expect(FREE_CANCELLATION_HOURS).toBe(48);
    expect(
      cancellationTiming({
        now: new Date("2026-10-19T04:00:00Z"),
        firstVisitDate: first,
        cancelledBy: "customer",
        freeHours: 24,
      }).timing,
    ).toBe("on_time");
  });
  it("follows daylight saving: the deadline for 2026-03-09 is 2026-03-07T04:00Z minus the hour shift", () => {
    // day 1 starts 2026-03-09T04:00Z (EDT); 48 h earlier is 2026-03-07T04:00Z.
    const r = cancellationTiming({
      now: new Date("2026-03-07T04:00:00Z"),
      firstVisitDate: "2026-03-09",
      cancelledBy: "customer",
    });
    expect(r.timing).toBe("on_time");
    expect(r.freeUntil.toISOString()).toBe("2026-03-07T04:00:00.000Z");
  });
});

describe("freeTrialEffect (CLAUDE.md 6.6)", () => {
  it("consumes on completed and customer no-show only", () => {
    const expected: Record<FreeTrialEvent, string> = {
      requested: "hold",
      accepted: "hold",
      declined: "release",
      cancelled: "release",
      completed: "consume",
      no_show_customer: "consume",
      no_show_chef: "release",
      expired: "release", // A-16: a request that expires
    };
    for (const [s, e] of Object.entries(expected))
      expect(freeTrialEffect(s as FreeTrialEvent)).toBe(e);
  });
});
