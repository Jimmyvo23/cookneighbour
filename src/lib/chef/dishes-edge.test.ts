import { afterEach, describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/client";
import {
  buildDishBody,
  emptyDishForm,
  uploadRejected,
} from "@/lib/chef/dishes";
import {
  addDays,
  dayLabel,
  diffDays,
  inWindow,
  monthGrid,
  moveFocus,
} from "@/lib/chef/calendar";
import { torontoToday } from "@/lib/domain/dishes";

// Tester edge cases for T-034 (dollars to cents, D-16 bounds, allergens, calendar time zones).

const valid = () => ({
  ...emptyDishForm(),
  name: "Pho bo",
  cuisine: "Vietnamese",
  cookMinutes: "180",
  cost: "25.50",
  servings: "4",
  shelfLifeDays: "2",
});
const create = (over: Record<string, unknown>) =>
  buildDishBody({ ...valid(), ...over }, { mode: "create" });

describe("dollars to cents at the edges", () => {
  it.each([
    ["0", 0],
    ["0.00", 0],
    ["$0", 0],
    ["0.5", 50],
    ["0.05", 5],
    ["25", 2500],
    ["$25.5", 2550],
    [" 25.50 ", 2550],
    ["499.99", 49999],
    ["500", 50000],
    ["500.00", 50000],
    ["0123", 12300],
  ])("accepts %s as %i cents", (cost, cents) => {
    const r = create({ cost });
    expect(r.errors).toEqual({});
    expect(r.body?.ingredientCostCents).toBe(cents);
  });

  it.each([
    "500.01",
    "501",
    "999999",
    "9999999",
    "1000000000000",
    "-1",
    "-0",
    "-0.01",
    "0.001",
    "25.505",
    "1e3",
    "NaN",
    "Infinity",
    "abc",
    "",
    "   ",
    ".5",
    "25.",
    "1,000",
    "1 000",
    "$$5",
    "5$",
    "0x10",
    "١٢",
  ])("refuses %j with the dollar message", (cost) => {
    const r = create({ cost });
    expect(r.body).toBeUndefined();
    expect(r.errors.ingredientCostCents).toMatch(/in dollars from \$0\.00/);
  });
});

describe("D-16 bounds at the exact edges", () => {
  const ok = (over: Record<string, unknown>) =>
    expect(create(over).errors).toEqual({});
  const bad = (over: Record<string, unknown>, field: string) =>
    expect(create(over).errors[field]).toBeTruthy();

  it("cooking time 5 to 360", () => {
    ok({ cookMinutes: "5" });
    ok({ cookMinutes: "360" });
    bad({ cookMinutes: "4" }, "cookMinutes");
    bad({ cookMinutes: "361" }, "cookMinutes");
    bad({ cookMinutes: "0" }, "cookMinutes");
    bad({ cookMinutes: "" }, "cookMinutes");
    bad({ cookMinutes: "90.5" }, "cookMinutes");
    bad({ cookMinutes: "1e2" }, "cookMinutes");
    bad({ cookMinutes: "9999999" }, "cookMinutes");
  });
  it("servings 1 to 50", () => {
    ok({ servings: "1" });
    ok({ servings: "50" });
    bad({ servings: "0" }, "servings");
    bad({ servings: "51" }, "servings");
    bad({ servings: "-1" }, "servings");
  });
  it("eat-by days 0 to 7", () => {
    ok({ shelfLifeDays: "0" });
    ok({ shelfLifeDays: "7" });
    bad({ shelfLifeDays: "8" }, "shelfLifeDays");
    bad({ shelfLifeDays: "-1" }, "shelfLifeDays");
    bad({ shelfLifeDays: "" }, "shelfLifeDays");
  });
  it("name 1 to 120 and cuisine 1 to 40 characters (after trimming)", () => {
    ok({ name: "a".repeat(120) });
    bad({ name: "a".repeat(121) }, "name");
    bad({ name: "   " }, "name");
    ok({ cuisine: "c".repeat(40) });
    bad({ cuisine: "c".repeat(41) }, "cuisine");
    expect(create({ name: `  ${"a".repeat(120)}  ` }).body?.name).toHaveLength(
      120,
    );
  });
  it("description up to 1000 characters; blank becomes null", () => {
    ok({ description: "d".repeat(1000) });
    bad({ description: "d".repeat(1001) }, "description");
    expect(create({ description: "   " }).body?.description).toBeNull();
  });
});

describe("unsafe text uses the shared rule in every free-text field", () => {
  it.each(["name", "cuisine"])(
    "%s refuses control characters and lone surrogates",
    (f) => {
      for (const bad of ["a\u0007b", "a\u0000b", "a\nb", "a\ud800b"]) {
        const r = create({ [f]: bad });
        expect(r.body, `${f} ${JSON.stringify(bad)}`).toBeUndefined();
        expect(r.errors[f]).toBeTruthy();
      }
    },
  );
  it("description refuses control characters but allows new lines", () => {
    expect(create({ description: "a\u0007b" }).errors.description).toBeTruthy();
    expect(create({ description: "a\ud800b" }).errors.description).toBeTruthy();
    expect(create({ description: "line1\nline2" }).errors).toEqual({});
  });
  it("other allergens refuse control characters and lone surrogates", () => {
    expect(
      create({ otherAllergens: "celery\u0007" }).errors.allergens,
    ).toBeTruthy();
    expect(
      create({ otherAllergens: "cel\ud800ery" }).errors.allergens,
    ).toBeTruthy();
  });
});

describe("allergens", () => {
  it("lower-cases, trims and removes duplicates between picker and other", () => {
    const r = create({
      allergens: ["milk", "tree nuts"],
      otherAllergens: " Celery ,LUPIN,, Milk ",
    });
    expect(r.errors).toEqual({});
    expect(r.body?.allergens?.sort()).toEqual(
      ["celery", "lupin", "milk", "tree nuts"].sort(),
    );
  });
  it("accepts exactly 14 and refuses 15 entries", () => {
    const list = (n: number) =>
      Array.from({ length: n }, (_, i) => `a${i}`).join(",");
    expect(create({ otherAllergens: list(14) }).errors).toEqual({});
    expect(create({ otherAllergens: list(15) }).errors.allergens).toBeTruthy();
  });
  it("accepts an entry of 40 characters and refuses 41", () => {
    expect(create({ otherAllergens: "x".repeat(40) }).errors).toEqual({});
    expect(
      create({ otherAllergens: "x".repeat(41) }).errors.allergens,
    ).toBeTruthy();
  });
  // Observation (tester finding F4): the 14-entry limit counts duplicates before they are merged,
  // so 13 ticked + "Milk" typed again (14 unique) is refused even though only 13 are distinct.
  it("counts duplicates against the limit (documents current behaviour)", () => {
    const all13 = [
      "milk",
      "eggs",
      "peanuts",
      "tree nuts",
      "sesame",
      "soy",
      "wheat",
      "gluten",
      "fish",
      "crustaceans",
      "molluscs",
      "mustard",
      "sulphites",
    ];
    expect(
      create({ allergens: all13, otherAllergens: "celery" }).errors,
    ).toEqual({});
    expect(
      create({ allergens: all13, otherAllergens: "celery, Milk" }).errors
        .allergens,
    ).toBeTruthy();
  });
});

describe("calendar never reads the browser clock or time zone", () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it.each([
    "Pacific/Kiritimati",
    "Pacific/Pago_Pago",
    "America/Los_Angeles",
    "UTC",
  ])("date helpers give the same answers in %s", (tz) => {
    process.env.TZ = tz;
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    // DST end in Toronto (2026-11-01) and the spring jump (2027-03-14) do not shift days.
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
    expect(addDays("2027-03-13", 2)).toBe("2027-03-15");
    expect(dayLabel("2026-10-08")).toBe("Thursday, October 8, 2026");
    expect(monthGrid("2026-10-08")[0].indexOf("2026-10-01")).toBe(4);
    expect(
      moveFocus("2026-10-08", "ArrowRight", "2026-10-08", "2027-04-06"),
    ).toBe("2026-10-09");
    expect(inWindow("2027-04-06", "2026-10-08", "2027-04-06")).toBe(true);
    expect(diffDays(["2026-10-09"], ["2026-10-09", "2026-10-10"])).toEqual({
      add: ["2026-10-10"],
      remove: [],
    });
  });

  it("the server's Toronto day changes at Toronto midnight, whatever the machine zone", () => {
    for (const tz of ["Pacific/Kiritimati", "UTC", "America/Los_Angeles"]) {
      process.env.TZ = tz;
      // 03:59:59Z on Oct 8 is 23:59:59 on Oct 7 in Toronto (EDT, UTC-4); 04:00:00Z is Oct 8.
      expect(torontoToday(new Date("2026-10-08T03:59:59Z"))).toBe("2026-10-07");
      expect(torontoToday(new Date("2026-10-08T04:00:00Z"))).toBe("2026-10-08");
      // After the clocks go back (EST, UTC-5) midnight is 05:00Z.
      expect(torontoToday(new Date("2026-11-02T04:59:59Z"))).toBe("2026-11-01");
      expect(torontoToday(new Date("2026-11-02T05:00:00Z"))).toBe("2026-11-02");
    }
  });
});

describe("uploadRejected (round 2)", () => {
  const e = (
    status: number,
    code: ApiClientError["code"],
    fields?: Record<string, string>,
  ) => new ApiClientError(status, code, "x", fields ? { fields } : {});
  it("keeps the upload for the cap, other field errors, network and server errors", () => {
    expect(uploadRejected(e(409, "INVALID_STATE"))).toBe(false);
    expect(uploadRejected(e(422, "VALIDATION_FAILED", { name: "x" }))).toBe(
      false,
    );
    expect(uploadRejected(e(0, "NETWORK"))).toBe(false);
    expect(uploadRejected(e(500, "UNKNOWN"))).toBe(false);
    expect(uploadRejected(e(404, "NOT_FOUND"))).toBe(false);
    expect(uploadRejected(new Error("boom"))).toBe(false);
    expect(uploadRejected(undefined)).toBe(false);
  });
  it("drops the upload for 403 and for a photoPath error, even beside other errors", () => {
    expect(uploadRejected(e(403, "FORBIDDEN"))).toBe(true);
    expect(
      uploadRejected(
        e(422, "VALIDATION_FAILED", { name: "x", photoPath: "y" }),
      ),
    ).toBe(true);
  });
});
