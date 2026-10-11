import { describe, expect, it } from "vitest";
import {
  addMonths,
  bookedDatesMessage,
  dayLabel,
  daysInMonth,
  diffDays,
  inWindow,
  monthGrid,
  monthLabel,
  moveFocus,
} from "@/lib/chef/calendar";

const TODAY = "2026-10-08"; // a Thursday
const LAST = "2027-04-06";

describe("month grid", () => {
  it("lays October 2026 out Sunday first with null padding", () => {
    const g = monthGrid("2026-10-15");
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g[0].slice(0, 4)).toEqual([null, null, null, null]);
    expect(g[0][4]).toBe("2026-10-01");
    expect(g.flat().filter(Boolean)).toHaveLength(31);
    expect(g.flat().filter(Boolean).at(-1)).toBe("2026-10-31");
  });
  it("handles February in a leap year and year ends", () => {
    expect(daysInMonth("2028-02-10")).toBe(29);
    expect(daysInMonth("2027-02-10")).toBe(28);
    expect(addMonths("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2027-01-31", -1)).toBe("2026-12-01");
  });
  it("labels months and days in English", () => {
    expect(monthLabel("2026-10-08")).toBe("October 2026");
    expect(dayLabel("2026-10-08")).toBe("Thursday, October 8, 2026");
  });
});

describe("window", () => {
  it("includes both ends and nothing outside", () => {
    expect(inWindow(TODAY, TODAY, LAST)).toBe(true);
    expect(inWindow(LAST, TODAY, LAST)).toBe(true);
    expect(inWindow("2026-10-07", TODAY, LAST)).toBe(false);
    expect(inWindow("2027-04-07", TODAY, LAST)).toBe(false);
  });
});

describe("moveFocus", () => {
  it("moves by day and week", () => {
    expect(moveFocus("2026-10-15", "ArrowRight", TODAY, LAST)).toBe(
      "2026-10-16",
    );
    expect(moveFocus("2026-10-15", "ArrowLeft", TODAY, LAST)).toBe(
      "2026-10-14",
    );
    expect(moveFocus("2026-10-15", "ArrowDown", TODAY, LAST)).toBe(
      "2026-10-22",
    );
    expect(moveFocus("2026-10-15", "ArrowUp", TODAY, LAST)).toBe("2026-10-08");
  });
  it("crosses month boundaries", () => {
    expect(moveFocus("2026-10-31", "ArrowRight", TODAY, LAST)).toBe(
      "2026-11-01",
    );
  });
  it("stays inside the window", () => {
    expect(moveFocus(TODAY, "ArrowLeft", TODAY, LAST)).toBe(TODAY);
    expect(moveFocus("2026-10-10", "ArrowUp", TODAY, LAST)).toBe("2026-10-10");
    expect(moveFocus(LAST, "ArrowRight", TODAY, LAST)).toBe(LAST);
    expect(moveFocus("2027-04-01", "ArrowDown", TODAY, LAST)).toBe(
      "2027-04-01",
    );
  });
  it("Home and End go to the week row ends, clamped", () => {
    expect(moveFocus("2026-10-15", "Home", TODAY, LAST)).toBe("2026-10-11");
    expect(moveFocus("2026-10-15", "End", TODAY, LAST)).toBe("2026-10-17");
    expect(moveFocus("2026-10-09", "Home", TODAY, LAST)).toBe(TODAY);
    expect(moveFocus("2027-04-05", "End", TODAY, LAST)).toBe(LAST);
  });
  it("PageUp/PageDown change month and keep the day number where possible", () => {
    expect(moveFocus("2026-10-31", "PageDown", TODAY, LAST)).toBe("2026-11-30");
    expect(moveFocus("2026-11-20", "PageUp", TODAY, LAST)).toBe("2026-10-20");
    expect(moveFocus("2026-10-09", "PageUp", TODAY, LAST)).toBe(TODAY);
    expect(moveFocus("2027-03-31", "PageDown", TODAY, LAST)).toBe(LAST);
  });
});

describe("diffDays", () => {
  it("returns added and removed dates, sorted", () => {
    expect(
      diffDays(
        ["2026-10-09", "2026-10-12"],
        ["2026-10-12", "2026-10-11", "2026-10-10"],
      ),
    ).toEqual({
      add: ["2026-10-10", "2026-10-11"],
      remove: ["2026-10-09"],
    });
  });
  it("is empty when nothing changed", () => {
    expect(diffDays(["2026-10-09"], ["2026-10-09"])).toEqual({
      add: [],
      remove: [],
    });
  });
});

describe("bookedDatesMessage", () => {
  it("names every booked date and says nothing was saved", () => {
    const m = bookedDatesMessage(["2026-10-13", "2026-10-14"]);
    expect(m).toContain("Nothing was saved");
    expect(m).toContain("Tuesday, October 13, 2026");
    expect(m).toContain("Wednesday, October 14, 2026");
    expect(m.toLowerCase()).not.toContain("cancel");
    expect(bookedDatesMessage(["2026-10-13"]).toLowerCase()).not.toContain(
      "cancel",
    );
    expect(bookedDatesMessage([]).toLowerCase()).not.toContain("cancel");
  });
  it("still works without dates", () => {
    expect(bookedDatesMessage([])).toContain("Nothing was saved");
  });
});
