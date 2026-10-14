import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/client";
import type { PublicDish } from "@/lib/api/types";
import {
  allergyText,
  buildRequest,
  classifyBookingError,
  dayMinutes,
  emptyDraft,
  fieldDomId,
  isInsideLateWindow,
  issuesToErrors,
  localConflicts,
  localProblems,
  normalizeServerFields,
  orderedErrors,
  resizeDays,
  visitLimitMessage,
  type BookingDraft,
} from "@/lib/booking/form";

const dish = (
  id: string,
  cookMinutes: number,
  allergens: string[] = [],
): PublicDish => ({
  id,
  name: `Dish ${id}`,
  photoPath: null,
  description: null,
  cuisine: "Vietnamese",
  cookMinutes,
  ingredientCostCents: 2000,
  servings: 4,
  allergens,
  shelfLifeDays: 2,
});
const DISHES = [dish("a", 120, ["soy"]), dish("b", 200, ["peanuts"])];

function filled(): BookingDraft {
  return {
    ...emptyDraft(),
    days: [{ date: "2030-01-10", quantities: { a: 1 } }],
    locationType: "customer_home",
    address: { line: "1 Main St", city: "Mississauga", postalCode: "L5B 1M2" },
    groceryOption: "customer_buys",
    noAllergies: true,
    noDietaryNeeds: true,
  };
}

describe("resizeDays", () => {
  it("keeps the days that stay and adds empty ones, 1 to 3 only", () => {
    const one = [{ date: "2030-01-10", quantities: { a: 1 } }];
    const three = resizeDays(one, 3);
    expect(three).toHaveLength(3);
    expect(three[0]).toEqual(one[0]);
    expect(three[2]).toEqual({ date: "", quantities: {} });
    expect(resizeDays(three, 1)).toEqual(one);
    expect(resizeDays(three, 9)).toHaveLength(3);
    expect(resizeDays(three, 0)).toHaveLength(1);
    expect(resizeDays(three, Number.NaN)).toHaveLength(1);
  });
});

describe("visit time and the 6 hour limit", () => {
  it("adds minutes times quantity", () => {
    expect(dayMinutes({ date: "", quantities: { a: 2, b: 1 } }, DISHES)).toBe(
      440,
    );
  });
  it("is silent at exactly 6 hours and warns above", () => {
    expect(visitLimitMessage(360)).toBeNull();
    expect(visitLimitMessage(361)).toMatch(/over the 6 hour limit/);
    expect(visitLimitMessage(440)).toMatch(/Remove dishes or move some/);
  });
});

describe("allergies", () => {
  it("builds the same text the server stores", () => {
    const d = {
      ...emptyDraft(),
      allergens: ["peanuts"],
      allergyNotes: " EpiPen ",
    };
    expect(allergyText(d)).toBe("peanuts, EpiPen");
    expect(allergyText({ ...d, noAllergies: true })).toBe("None");
  });
  it("finds a conflict with synonyms (D-24) once per dish", () => {
    const d: BookingDraft = {
      ...filled(),
      noAllergies: false,
      allergyNotes: "severe peanut allergy",
      days: [
        { date: "2030-01-10", quantities: { b: 1 } },
        { date: "2030-01-11", quantities: { b: 2 } },
      ],
    };
    expect(localConflicts(d, DISHES)).toEqual([
      { dishId: "b", dishName: "Dish b", allergens: ["peanuts"] },
    ]);
    expect(localConflicts({ ...d, noAllergies: true }, DISHES)).toEqual([]);
  });
});

describe("buildRequest", () => {
  it("sends the cooking address only for the customer's home", () => {
    const home = buildRequest("c1", filled(), DISHES, true);
    expect(home.address).toEqual({
      line: "1 Main St",
      city: "Mississauga",
      postalCode: "L5B 1M2",
    });
    const chefHome = buildRequest(
      "c1",
      { ...filled(), locationType: "chef_home" },
      DISHES,
      false,
    );
    expect("address" in chefHome).toBe(false);
    expect(chefHome.useFreeTrial).toBe(false);
  });
  it("sends an explicit no-allergies answer without allergen fields (D-23)", () => {
    const b = buildRequest("c1", filled(), DISHES, true);
    expect(b.intake).toEqual({ noAllergies: true, noDietaryNeeds: true });
    const c = buildRequest(
      "c1",
      {
        ...filled(),
        noAllergies: false,
        allergens: ["milk"],
        allergyNotes: " x ",
        noDietaryNeeds: false,
        dietaryNotes: " halal ",
      },
      DISHES,
      true,
    );
    expect(c.intake).toEqual({
      allergens: ["milk"],
      allergyNotes: "x",
      dietaryNotes: "halal",
    });
  });
  it("lists only picked dishes in menu order and acknowledges a real conflict only", () => {
    const d: BookingDraft = {
      ...filled(),
      noAllergies: false,
      allergens: ["peanuts"],
      days: [{ date: "2030-01-10", quantities: { b: 2, a: 1 } }],
      conflictAcknowledged: true,
    };
    const b = buildRequest("c1", d, DISHES, true);
    expect(b.days[0].dishes).toEqual([
      { dishId: "a", quantity: 1 },
      { dishId: "b", quantity: 2 },
    ]);
    expect(b.allergyConflictAcknowledged).toBe(true);
    const none = buildRequest(
      "c1",
      { ...d, allergens: ["fish"], conflictAcknowledged: true },
      DISHES,
      true,
    );
    expect(none.allergyConflictAcknowledged).toBe(false);
  });
});

describe("localProblems", () => {
  const both = ["customer_home", "chef_home"] as const;
  it("passes a complete form", () => {
    expect(localProblems(filled(), DISHES, both)).toEqual({});
  });
  it("asks for every missing answer with the contract's keys", () => {
    const e = localProblems(emptyDraft(), DISHES, both);
    expect(Object.keys(e).sort()).toEqual(
      [
        "days.0.date",
        "days.0.dishes",
        "groceryOption",
        "intake.allergies",
        "intake.dietaryNotes",
        "locationType",
      ].sort(),
    );
  });
  it("needs an address, a postal code and a valid location", () => {
    const e = localProblems(
      { ...filled(), address: { line: "", city: "", postalCode: "zzz" } },
      DISHES,
      both,
    );
    expect(Object.keys(e).sort()).toEqual([
      "address.city",
      "address.line",
      "address.postalCode",
    ]);
    // chef_home is not offered: the choice is refused
    expect(
      localProblems({ ...filled(), locationType: "chef_home" }, DISHES, [
        "customer_home",
      ]).locationType,
    ).toBeTruthy();
    // chef's home needs no address
    expect(
      localProblems(
        {
          ...filled(),
          locationType: "chef_home",
          address: { line: "", city: "", postalCode: "" },
        },
        DISHES,
        both,
      ),
    ).toEqual({});
  });
  it("blocks a day over 6 hours until dishes are removed", () => {
    const d = {
      ...filled(),
      days: [{ date: "2030-01-10", quantities: { a: 2, b: 1 } }],
    };
    expect(localProblems(d, DISHES, both)["days.0.dishes"]).toMatch(
      /Day 1: This day adds up to 7 h 20 min/,
    );
    const ok = {
      ...filled(),
      days: [{ date: "2030-01-10", quantities: { a: 1, b: 1 } }],
    };
    expect(localProblems(ok, DISHES, both)).toEqual({});
  });
  it("refuses a repeated date and a quantity above 10", () => {
    const d = {
      ...filled(),
      days: [
        { date: "2030-01-10", quantities: { a: 1 } },
        { date: "2030-01-10", quantities: { a: 11 } },
      ],
    };
    const e = localProblems(d, DISHES, both);
    expect(e["days.1.date"]).toMatch(/different date/);
    expect(e["days.1.dishes"]).toMatch(/1 to 10/);
  });
  it("needs the allergy conflict to be acknowledged", () => {
    const d: BookingDraft = {
      ...filled(),
      noAllergies: false,
      allergens: ["peanuts"],
      days: [{ date: "2030-01-10", quantities: { b: 1 } }],
    };
    expect(
      localProblems(d, DISHES, both).allergyConflictAcknowledged,
    ).toBeTruthy();
    expect(
      localProblems({ ...d, conflictAcknowledged: true }, DISHES, both),
    ).toEqual({});
  });
  it("refuses control characters and notes that are too long", () => {
    const base = { ...filled(), noAllergies: false, noDietaryNeeds: false };
    expect(
      localProblems(
        { ...base, allergyNotes: "a\u0000b", dietaryNotes: "x" },
        DISHES,
        both,
      )["intake.allergies"],
    ).toMatch(/invalid/);
    expect(
      localProblems(
        { ...base, allergyNotes: "x".repeat(301), dietaryNotes: "x" },
        DISHES,
        both,
      )["intake.allergies"],
    ).toMatch(/300/);
    expect(
      localProblems(
        { ...base, allergyNotes: "x", dietaryNotes: "y".repeat(501) },
        DISHES,
        both,
      )["intake.dietaryNotes"],
    ).toMatch(/500/);
  });
});

describe("error keys", () => {
  it("makes DOM ids from dotted keys", () => {
    expect(fieldDomId("days.0.date")).toBe("bk-days-0-date");
    expect(fieldDomId("intake.allergies")).toBe("bk-intake-allergies");
  });
  it("orders the summary like the page", () => {
    const keys = orderedErrors({
      "intake.dietaryNotes": "d",
      groceryOption: "g",
      "days.1.date": "b",
      "days.0.dishes": "a2",
      "days.0.date": "a1",
      locationType: "l",
    }).map((x) => x.key);
    expect(keys).toEqual([
      "days.0.date",
      "days.1.date",
      "days.0.dishes",
      "locationType",
      "groceryOption",
      "intake.dietaryNotes",
    ]);
  });
  it("moves server keys without a control to one that has one", () => {
    expect(
      normalizeServerFields({
        "days.0.dishes.2.quantity": "q",
        intake: "i",
        "intake.noDietaryNeeds": "n",
        "address.postalCode": "p",
      }),
    ).toEqual({
      "days.0.dishes": "q",
      "intake.allergies": "i",
      "intake.dietaryNotes": "n",
      "address.postalCode": "p",
    });
  });
  it("turns issues into field errors", () => {
    expect(
      issuesToErrors([
        { code: "DOUBLE_BOOKED", message: "booked", dayIndex: 1 },
        { code: "VISIT_TOO_LONG", message: "long", dayIndex: 0 },
        { code: "OUTSIDE_SERVICE_AREA", message: "far" },
      ]),
    ).toEqual({
      "days.1.date": "booked",
      "days.0.dishes": "long",
      "address.postalCode": "far",
    });
  });
});

describe("late-cancellation window (D-20)", () => {
  it("is late when day 1 is less than 48 hours away, Toronto midnight, inclusive cut-off", () => {
    // Day 1 is 2030-01-12; 48 h before its Toronto midnight (05:00Z) is 2030-01-10 05:00Z.
    expect(
      isInsideLateWindow("2030-01-12", new Date("2030-01-10T05:00:00Z")),
    ).toBe(false);
    expect(
      isInsideLateWindow("2030-01-12", new Date("2030-01-10T05:00:01Z")),
    ).toBe(true);
    expect(
      isInsideLateWindow("2030-01-20", new Date("2030-01-10T05:00:01Z")),
    ).toBe(false);
  });
});

describe("classifyBookingError", () => {
  const err = (
    status: number,
    code: ConstructorParameters<typeof ApiClientError>[1],
    extra: ConstructorParameters<typeof ApiClientError>[3] = {},
  ) => new ApiClientError(status, code, `msg ${code}`, extra);

  it("maps each server answer to one screen action", () => {
    expect(classifyBookingError(err(404, "NOT_FOUND")).kind).toBe("not_found");
    expect(classifyBookingError(err(401, "UNAUTHENTICATED")).kind).toBe(
      "signed_out",
    );
    expect(classifyBookingError(err(409, "TOO_MANY_OPEN_REQUESTS")).kind).toBe(
      "too_many_open",
    );
    expect(classifyBookingError(err(409, "FREE_TRIAL_USED")).kind).toBe(
      "trial_used",
    );
    expect(classifyBookingError(err(409, "PHONE_NOT_VERIFIED")).kind).toBe(
      "phone",
    );
    expect(classifyBookingError(err(409, "PHONE_NOT_SUBMITTED")).kind).toBe(
      "phone",
    );
    expect(classifyBookingError(err(409, "ADDRESS_NOT_SET")).kind).toBe(
      "address",
    );
    expect(classifyBookingError(err(500, "INTERNAL")).kind).toBe("other");
    expect(classifyBookingError(new Error("x")).kind).toBe("other");
  });
  it("puts a double booking on the day's date field", () => {
    const f = classifyBookingError(
      err(409, "DOUBLE_BOOKED", {
        issues: [{ code: "DOUBLE_BOOKED", message: "booked", dayIndex: 1 }],
      }),
    );
    expect(f).toMatchObject({
      kind: "date_conflict",
      fields: { "days.1.date": "booked" },
    });
    const d = classifyBookingError(
      err(409, "DATE_BOOKED", { dates: ["2030-01-10"] }),
    );
    expect(d.kind).toBe("date_conflict");
  });
  it("keeps field errors from a 422, with issues and fields merged", () => {
    const f = classifyBookingError(
      err(422, "VALIDATION_FAILED", {
        fields: { "intake.allergies": "need" },
        issues: [{ code: "DATE_TOO_SOON", message: "soon", dayIndex: 0 }],
      }),
    );
    expect(f).toMatchObject({
      kind: "fields",
      fields: { "intake.allergies": "need", "days.0.date": "soon" },
    });
  });
});
