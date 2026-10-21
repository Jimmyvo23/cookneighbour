// T-051 (Tester): CLAUDE.md section 10 sweep. See docs/edge-case-matrix.md.
import { describe, expect, it } from "vitest";
import { addressKey } from "./address";
import { cancellationTiming } from "./cancellation";

describe("T-051 second free trial from the same normalized address (CLAUDE.md 6.6, A-2)", () => {
  it("T51-B1 (fixed in T-060): full-width digits are folded, so different house numbers get different keys", () => {
    expect(addressKey("１００ Fictional Street", "L5B 1A1")).not.toBe(
      addressKey("２００ Fictional Street", "L5B 1A1"),
    );
  });

  it("ASCII house numbers still tell two homes on one street apart", () => {
    expect(addressKey("100 Fictional Street", "L5B 1A1")).not.toBe(
      addressKey("200 Fictional Street", "L5B 1A1"),
    );
  });
});

describe("T-051 chef cancellation timing (D-20, A-22)", () => {
  it("a chef who cancels inside 48 hours of day 1 is late; a week ahead is on time", () => {
    const first = "2026-11-10";
    const late = cancellationTiming({
      now: new Date("2026-11-09T12:00:00Z"),
      firstVisitDate: first,
      cancelledBy: "chef",
    });
    expect(late.timing).toBe("late");
    expect(late.cancelledBy).toBe("chef");
    const early = cancellationTiming({
      now: new Date("2026-11-03T12:00:00Z"),
      firstVisitDate: first,
      cancelledBy: "chef",
    });
    expect(early.timing).toBe("on_time");
  });
});
