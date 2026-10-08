import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_HORIZON_DAYS,
  addDays,
  isRealDate,
  parseAvailabilityBody,
  parseDishBody,
  torontoToday,
} from "./dishes";
import { checkStoragePath } from "./chef-application";

const CHEF = "1111111a-2222-4333-8444-55555555555b";
const U1 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const valid = { name: "Pho bo", cuisine: "Vietnamese", cookMinutes: 180 };

describe("parseDishBody (create)", () => {
  it("accepts the minimum and applies the documented defaults", () => {
    const r = parseDishBody(valid, "create");
    expect(r.errors).toEqual({});
    expect(r.value).toEqual({
      name: "Pho bo",
      cuisine: "Vietnamese",
      cookMinutes: 180,
      ingredientCostCents: 0,
      servings: 1,
      allergens: [],
      shelfLifeDays: 2,
    });
  });

  it("requires name, cuisine and cookMinutes", () => {
    expect(Object.keys(parseDishBody({}, "create").errors).sort()).toEqual([
      "cookMinutes",
      "cuisine",
      "name",
    ]);
  });

  it("trims, stores a blank description as null and keeps line breaks", () => {
    const r = parseDishBody(
      { ...valid, name: "  Pho  ", description: "  line1\nline2\tx " },
      "create",
    );
    expect(r.value.name).toBe("Pho");
    expect(r.value.description).toBe("line1\nline2\tx");
    expect(
      parseDishBody({ ...valid, description: "   " }, "create").value
        .description,
    ).toBeNull();
    expect(
      parseDishBody({ ...valid, description: null }, "create").value
        .description,
    ).toBeNull();
  });

  it("refuses control characters and lone surrogates in every text field", () => {
    for (const bad of ["a\u0000b", "a\u0007b", "a\ud800b", "a\udc00b"]) {
      for (const key of ["name", "cuisine"]) {
        const r = parseDishBody({ ...valid, [key]: bad }, "create");
        expect(r.errors[key], `${key} ${JSON.stringify(bad)}`).toBeTruthy();
      }
      expect(
        parseDishBody({ ...valid, description: bad }, "create").errors
          .description,
      ).toBeTruthy();
      expect(
        parseDishBody({ ...valid, allergens: [bad] }, "create").errors
          .allergens,
      ).toBeTruthy();
    }
    // newline is fine in a description but not in a name
    expect(
      parseDishBody({ ...valid, name: "a\nb" }, "create").errors.name,
    ).toBeTruthy();
  });

  it("enforces length bounds", () => {
    expect(
      parseDishBody({ ...valid, name: "x".repeat(121) }, "create").errors.name,
    ).toBeTruthy();
    expect(
      parseDishBody({ ...valid, name: "x".repeat(120) }, "create").errors.name,
    ).toBeUndefined();
    expect(
      parseDishBody({ ...valid, name: "   " }, "create").errors.name,
    ).toBeTruthy();
    expect(
      parseDishBody({ ...valid, cuisine: "x".repeat(41) }, "create").errors
        .cuisine,
    ).toBeTruthy();
    expect(
      parseDishBody({ ...valid, description: "x".repeat(1001) }, "create")
        .errors.description,
    ).toBeTruthy();
    expect(
      parseDishBody({ ...valid, description: "x".repeat(1000) }, "create")
        .errors.description,
    ).toBeUndefined();
  });

  it("bounds the numbers and refuses non-integers and non-numbers", () => {
    const cases: [string, unknown[], unknown[]][] = [
      [
        "cookMinutes",
        [5, 360],
        [4, 361, 0, -1, 1.5, "60", null, NaN, Infinity],
      ],
      ["ingredientCostCents", [0, 50000], [-1, 50001, 1.5, "5", null]],
      ["servings", [1, 50], [0, 51, 2.5, "2", null]],
      ["shelfLifeDays", [0, 7], [-1, 8, 1.5, "2", null]],
    ];
    for (const [key, good, bad] of cases) {
      for (const v of good)
        expect(
          parseDishBody({ ...valid, [key]: v }, "create").errors[key],
          `${key}=${v}`,
        ).toBeUndefined();
      for (const v of bad)
        expect(
          parseDishBody({ ...valid, [key]: v }, "create").errors[key],
          `${key}=${String(v)}`,
        ).toBeTruthy();
    }
  });

  it("lower-cases, trims and de-duplicates allergens; bounds the list", () => {
    const r = parseDishBody(
      { ...valid, allergens: [" Peanuts ", "SOY", "soy", "Tree Nuts"] },
      "create",
    );
    expect(r.value.allergens).toEqual(["peanuts", "soy", "tree nuts"]);
    expect(
      parseDishBody(
        {
          ...valid,
          allergens: Array(15)
            .fill("a")
            .map((a, i) => a + i),
        },
        "create",
      ).errors.allergens,
    ).toBeTruthy();
    expect(
      parseDishBody({ ...valid, allergens: ["x".repeat(41)] }, "create").errors
        .allergens,
    ).toBeTruthy();
    expect(
      parseDishBody({ ...valid, allergens: [""] }, "create").errors.allergens,
    ).toBeTruthy();
    expect(
      parseDishBody({ ...valid, allergens: "soy" }, "create").errors.allergens,
    ).toBeTruthy();
    expect(
      parseDishBody({ ...valid, allergens: [1] }, "create").errors.allergens,
    ).toBeTruthy();
  });

  it("takes photoPath as a string or null and leaves the path rules to the route", () => {
    expect(
      parseDishBody({ ...valid, photoPath: null }, "create").value.photoPath,
    ).toBeNull();
    expect(
      parseDishBody({ ...valid, photoPath: "x/y" }, "create").value.photoPath,
    ).toBe("x/y");
    expect(
      parseDishBody({ ...valid, photoPath: 5 }, "create").errors.photoPath,
    ).toBeTruthy();
    expect(
      parseDishBody({ ...valid, photoPath: "" }, "create").errors.photoPath,
    ).toBeTruthy();
  });

  it("does not accept isActive on create", () => {
    expect(
      parseDishBody({ ...valid, isActive: false }, "create").errors.isActive,
    ).toBeTruthy();
  });
});

describe("parseDishBody (update)", () => {
  it("accepts {} and returns only the keys that were sent", () => {
    expect(parseDishBody({}, "update")).toEqual({ value: {}, errors: {} });
    expect(
      parseDishBody({ servings: 3, isActive: false }, "update").value,
    ).toEqual({
      servings: 3,
      isActive: false,
    });
  });
  it("validates what was sent, with no defaults", () => {
    expect(
      parseDishBody({ cookMinutes: 1 }, "update").errors.cookMinutes,
    ).toBeTruthy();
    expect(parseDishBody({ name: "" }, "update").errors.name).toBeTruthy();
    expect(
      parseDishBody({ isActive: "no" }, "update").errors.isActive,
    ).toBeTruthy();
  });
});

describe("dish-photo storage path (contract section 2, rule 7)", () => {
  const check = (file: string) =>
    checkStoragePath("dish_photo", CHEF, `${CHEF}/${file}`);
  it("accepts dish-<uuid>.<ext> in the dish-photos bucket", () => {
    for (const ext of ["jpg", "jpeg", "png", "webp"])
      expect(check(`dish-${U1}.${ext}`)).toEqual({
        ok: true,
        bucket: "dish-photos",
        path: `${CHEF}/dish-${U1}.${ext}`,
      });
  });
  it("rejects other prefixes, extensions, upper case and foreign folders", () => {
    for (const f of [
      `photo-${U1}.png`,
      `dish-${U1}.pdf`,
      `dish-${U1}.PNG`,
      `dish-${U1.toUpperCase()}.png`,
      "dish-x.png",
      `dish-${U1}.png/../x`,
    ])
      expect(check(f), f).toMatchObject({ ok: false, kind: "invalid" });
    expect(
      checkStoragePath("dish_photo", CHEF, `${U1}/dish-${U1}.png`),
    ).toMatchObject({ ok: false, kind: "foreign" });
  });
});

describe("dates", () => {
  it("isRealDate accepts real YYYY-MM-DD dates only", () => {
    for (const d of ["2026-10-08", "2028-02-29", "2026-12-31"])
      expect(isRealDate(d), d).toBe(true);
    for (const d of [
      "2026-02-30",
      "2027-02-29",
      "2026-13-01",
      "2026-00-10",
      "2026-10-8",
      "26-10-08",
      "2026-10-08T00:00:00Z",
      " 2026-10-08",
      "",
      "2026/10/08",
      "2026-10-081",
    ])
      expect(isRealDate(d), d).toBe(false);
    expect(isRealDate(20261008 as unknown as string)).toBe(false);
  });
  it("addDays crosses month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-08", 180)).toBe("2027-04-06");
  });
  it("torontoToday follows Toronto time, not UTC", () => {
    // 2026-10-08 02:30 UTC is still 22:30 on the 7th in Toronto (EDT, UTC-4)
    expect(torontoToday(new Date("2026-10-08T02:30:00Z"))).toBe("2026-10-07");
    expect(torontoToday(new Date("2026-10-08T04:00:00Z"))).toBe("2026-10-08");
    // winter: EST, UTC-5
    expect(torontoToday(new Date("2027-01-15T04:59:00Z"))).toBe("2027-01-14");
    expect(torontoToday(new Date("2027-01-15T05:00:00Z"))).toBe("2027-01-15");
  });
});

describe("parseAvailabilityBody", () => {
  const today = "2026-10-08";
  const last = addDays(today, AVAILABILITY_HORIZON_DAYS);
  const run = (b: Record<string, unknown>) => parseAvailabilityBody(b, today);

  it("accepts add and remove, de-duplicates and sorts", () => {
    const r = run({
      add: ["2026-10-10", "2026-10-09", "2026-10-10"],
      remove: ["2026-01-01"],
    });
    expect(r.errors).toEqual({});
    expect(r.add).toEqual(["2026-10-09", "2026-10-10"]);
    expect(r.remove).toEqual(["2026-01-01"]);
  });
  it("accepts today and the last bookable day; refuses yesterday and the day after", () => {
    expect(run({ add: [today, last] }).errors).toEqual({});
    expect(run({ add: [addDays(today, -1)] }).errors.add).toBeTruthy();
    expect(run({ add: [addDays(last, 1)] }).errors.add).toBeTruthy();
  });
  it("allows removing past dates but still requires a real date", () => {
    expect(run({ remove: ["2020-01-01"] }).errors).toEqual({});
    expect(run({ remove: ["2020-02-31"] }).errors.remove).toBeTruthy();
  });
  it("needs at least one date", () => {
    expect(run({}).errors.add).toBeTruthy();
    expect(run({ add: [], remove: [] }).errors.add).toBeTruthy();
  });
  it("refuses a date in both lists", () => {
    expect(
      run({ add: ["2026-10-10"], remove: ["2026-10-10"] }).errors.remove,
    ).toBeTruthy();
  });
  it("refuses non-arrays, non-strings, bad formats and more than 200 per list", () => {
    expect(run({ add: "2026-10-10" }).errors.add).toBeTruthy();
    expect(run({ add: [20261010] }).errors.add).toBeTruthy();
    expect(run({ add: ["10/10/2026"] }).errors.add).toBeTruthy();
    expect(run({ add: null }).errors.add).toBeTruthy();
    const many = Array.from({ length: 201 }, (_, i) => addDays(today, i % 180));
    expect(run({ add: many }).errors.add).toBeTruthy();
    const ok200 = Array.from({ length: 200 }, (_, i) =>
      addDays(today, i % 180),
    );
    expect(run({ add: ok200 }).errors).toEqual({});
  });
});
