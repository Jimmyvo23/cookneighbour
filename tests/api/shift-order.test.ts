// T-086: pure ordering rule behind `shiftDays`. Needs no database.
import { describe, expect, it } from "vitest";
import { orderForShift } from "./shift-order";

describe("T-086: orderForShift", () => {
  const days = [
    { id: "b", visit_date: "2030-01-02" },
    { id: "c", visit_date: "2030-01-03" },
    { id: "a", visit_date: "2030-01-01" },
  ];
  it("moving earlier (n > 0): oldest date first, whatever the input order", () => {
    expect(orderForShift(days, 1).map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(orderForShift([...days].reverse(), 2).map((d) => d.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  it("moving later (n < 0): newest date first, whatever the input order", () => {
    expect(orderForShift(days, -1).map((d) => d.id)).toEqual(["c", "b", "a"]);
    expect(orderForShift([...days].reverse(), -2).map((d) => d.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });
  it("does not change the input array", () => {
    const copy = days.map((d) => d.id);
    orderForShift(days, 1);
    expect(days.map((d) => d.id)).toEqual(copy);
  });
});
