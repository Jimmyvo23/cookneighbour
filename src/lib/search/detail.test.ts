import { describe, expect, it } from "vitest";
import {
  allergenText,
  groupDatesByMonth,
  isBookable,
  locationLabels,
  shortDayLabel,
  windowText,
} from "./detail";

describe("groupDatesByMonth", () => {
  it("groups ascending dates by month, keeps order, and labels the month", () => {
    const g = groupDatesByMonth([
      "2026-10-30",
      "2026-10-31",
      "2026-11-02",
      "2027-01-05",
    ]);
    expect(g.map((m) => m.month)).toEqual(["2026-10", "2026-11", "2027-01"]);
    expect(g[0].label).toBe("October 2026");
    expect(g[0].dates).toEqual(["2026-10-30", "2026-10-31"]);
    expect(g[2].label).toBe("January 2027");
  });
  it("returns nothing for no dates", () => {
    expect(groupDatesByMonth([])).toEqual([]);
  });
  it("sorts and drops duplicates and malformed strings", () => {
    const g = groupDatesByMonth([
      "2026-11-02",
      "2026-10-31",
      "2026-10-31",
      "not-a-date",
      "2026-02-30",
    ]);
    expect(g.flatMap((m) => m.dates)).toEqual(["2026-10-31", "2026-11-02"]);
  });
});

describe("shortDayLabel", () => {
  it("shows weekday, month and day with no time-zone shift", () => {
    expect(shortDayLabel("2026-10-12")).toBe("Mon, Oct 12");
    expect(shortDayLabel("2026-01-01")).toBe("Thu, Jan 1");
  });
});

describe("allergenText", () => {
  it("lists allergens in words", () => {
    expect(allergenText(["soy", "shellfish"])).toBe("Contains: soy, shellfish");
  });
  it("never claims the dish is allergen free", () => {
    const t = allergenText([]);
    expect(t).toBe("No allergens listed by the chef");
    expect(t.toLowerCase()).not.toContain("free");
  });
});

describe("locationLabels", () => {
  it("names each option as the API returned it", () => {
    expect(locationLabels(["customer_home"])).toEqual(["At your home"]);
    expect(locationLabels(["customer_home", "chef_home"])).toEqual([
      "At your home",
      "At the chef's home",
    ]);
    expect(locationLabels([])).toEqual([]);
  });
});

describe("isBookable", () => {
  it("is false with no location option", () => {
    expect(isBookable([])).toBe(false);
    expect(isBookable(["chef_home"])).toBe(true);
  });
});

describe("windowText", () => {
  it("states the window from the server's dates", () => {
    expect(windowText("2026-10-10", "2027-04-08")).toBe(
      "Dates from Sat, Oct 10 to Thu, Apr 8, 2027.",
    );
  });
});
