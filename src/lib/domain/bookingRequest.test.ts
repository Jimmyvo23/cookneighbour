import { describe, expect, it } from "vitest";
import {
  BOOKING_KEYS,
  classifyIssues,
  issuesToFields,
  parseBookingBody,
  requestExpiry,
} from "./bookingRequest";
import type { BookingIssue } from "./bookingValidation";

const CHEF = "0b3f0e0e-5b9f-4f0e-8d57-7a8f3f6a1c11";
const DISH = "1c4f1f1f-6caf-4f1f-9e68-8b9f4f7b2d22";

const body = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  chefId: CHEF,
  locationType: "customer_home",
  address: { line: "100 Main St", city: "Mississauga", postalCode: "l5b 1a1" },
  days: [{ date: "2026-10-20", dishes: [{ dishId: DISH }] }],
  groceryOption: "customer_buys",
  intake: { noAllergies: true, noDietaryNeeds: true },
  ...over,
});

describe("parseBookingBody", () => {
  it("parses a complete create request and normalizes it", () => {
    const r = parseBookingBody(body(), "create");
    expect(r.errors).toEqual({});
    expect(r.value).toEqual({
      chefId: CHEF,
      locationType: "customer_home",
      address: {
        line: "100 Main St",
        city: "Mississauga",
        postalCode: "L5B1A1",
      },
      days: [{ date: "2026-10-20", dishes: [{ dishId: DISH, quantity: 1 }] }],
      groceryOption: "customer_buys",
      intake: { allergies: "None", dietaryNotes: "None" },
      allergyConflictAcknowledged: false,
      useFreeTrial: false,
    });
  });

  it("lists the keys the route accepts", () => {
    expect([...BOOKING_KEYS].sort()).toEqual(
      [
        "address",
        "allergyConflictAcknowledged",
        "chefId",
        "days",
        "groceryOption",
        "intake",
        "locationType",
        "useFreeTrial",
      ].sort(),
    );
  });

  it("reports every shape problem at once, with dotted keys", () => {
    const r = parseBookingBody(
      {
        chefId: "nope",
        locationType: "moon",
        groceryOption: "x",
        days: [
          { date: 5, dishes: [{ dishId: 7 }, { dishId: DISH, quantity: "2" }] },
          "x",
        ],
        allergyConflictAcknowledged: "yes",
        useFreeTrial: 1,
      },
      "create",
    );
    expect(r.value).toBeUndefined();
    expect(Object.keys(r.errors).sort()).toEqual(
      [
        "allergyConflictAcknowledged",
        "chefId",
        "days.0.date",
        "days.0.dishes.0.dishId",
        "days.0.dishes.1.quantity",
        "days.1",
        "groceryOption",
        "intake",
        "locationType",
        "useFreeTrial",
      ].sort(),
    );
  });

  it("days must be an array of at most 10, each with at most 30 dishes", () => {
    expect(
      parseBookingBody(body({ days: "x" }), "create").errors.days,
    ).toBeTruthy();
    expect(
      parseBookingBody(
        body({
          days: Array.from({ length: 11 }, () => ({
            date: "2026-10-20",
            dishes: [],
          })),
        }),
        "create",
      ).errors.days,
    ).toBeTruthy();
    expect(
      parseBookingBody(
        body({
          days: [
            {
              date: "2026-10-20",
              dishes: Array.from({ length: 31 }, () => ({ dishId: DISH })),
            },
          ],
        }),
        "create",
      ).errors["days.0.dishes"],
    ).toBeTruthy();
    // 0 days and 4 days are the domain's DAYS_COUNT issue, not a shape error.
    expect(parseBookingBody(body({ days: [] }), "create").errors).toEqual({});
  });

  it("keeps a non-integer quantity for the domain to refuse (QUANTITY_INVALID)", () => {
    const r = parseBookingBody(
      body({
        days: [
          { date: "2026-10-20", dishes: [{ dishId: DISH, quantity: 1.5 }] },
        ],
      }),
      "create",
    );
    expect(r.errors).toEqual({});
    expect(r.value?.days[0].dishes[0].quantity).toBe(1.5);
  });

  describe("address", () => {
    it("is required for customer_home when creating, optional when estimating", () => {
      expect(
        parseBookingBody(body({ address: undefined }), "create").errors.address,
      ).toBeTruthy();
      const e = parseBookingBody(body({ address: undefined }), "estimate");
      expect(e.errors).toEqual({});
      expect(e.value?.address).toBeNull();
    });
    it("is refused for chef_home (nothing about the customer's address is stored)", () => {
      const r = parseBookingBody(body({ locationType: "chef_home" }), "create");
      expect(r.errors.address).toMatch(/chef's home/i);
      expect(
        parseBookingBody(
          body({ locationType: "chef_home", address: undefined }),
          "create",
        ).errors,
      ).toEqual({});
      expect(
        parseBookingBody(
          body({ locationType: "chef_home", address: null }),
          "create",
        ).errors,
      ).toEqual({});
    });
    it("validates line, city, postal code and refuses unknown keys and unsafe text", () => {
      const r = parseBookingBody(
        body({
          address: {
            line: "",
            city: "x".repeat(81),
            postalCode: "123",
            extra: 1,
          },
        }),
        "create",
      );
      expect(Object.keys(r.errors).sort()).toEqual(
        [
          "address.city",
          "address.extra",
          "address.line",
          "address.postalCode",
        ].sort(),
      );
      const bad = parseBookingBody(
        body({
          address: { line: "1 Main\u0000", city: "A", postalCode: "L5B1A1" },
        }),
        "create",
      );
      expect(bad.errors["address.line"]).toMatch(/control/i);
      expect(
        parseBookingBody(body({ address: "x" }), "create").errors.address,
      ).toBeTruthy();
    });
  });

  describe("intake (D-23: explicit answers)", () => {
    const intakeErrors = (
      intake: unknown,
      mode: "create" | "estimate" = "create",
    ) => parseBookingBody(body({ intake }), mode);

    it("refuses an empty or half-empty form when creating", () => {
      expect(Object.keys(intakeErrors({}).errors).sort()).toEqual(
        ["intake.allergies", "intake.dietaryNotes"].sort(),
      );
      expect(Object.keys(intakeErrors({ noAllergies: true }).errors)).toEqual([
        "intake.dietaryNotes",
      ]);
      expect(
        Object.keys(
          intakeErrors({ noDietaryNeeds: true, allergyNotes: "   " }).errors,
        ),
      ).toEqual(["intake.allergies"]);
      expect(
        intakeErrors({ noAllergies: false, noDietaryNeeds: false }).errors[
          "intake.allergies"
        ],
      ).toBeTruthy();
    });
    it("a missing intake is an error when creating and left to the domain when estimating", () => {
      expect(
        parseBookingBody(body({ intake: undefined }), "create").errors.intake,
      ).toBeTruthy();
      const e = parseBookingBody(body({ intake: undefined }), "estimate");
      expect(e.errors).toEqual({});
      expect(e.value?.intake).toBeUndefined();
    });
    it("an incomplete form while estimating is not an error; the domain says INTAKE_MISSING", () => {
      const e = intakeErrors({ noAllergies: true }, "estimate");
      expect(e.errors).toEqual({});
      expect(e.value?.intake).toBeUndefined();
    });
    it("builds the allergy text from picked allergens plus free text", () => {
      const r = intakeErrors({
        allergens: ["peanuts", "tree nuts"],
        allergyNotes: " carries an EpiPen ",
        noDietaryNeeds: false,
        dietaryNotes: "vegetarian",
      });
      expect(r.errors).toEqual({});
      expect(r.value?.intake).toEqual({
        allergies: "peanuts, tree nuts, carries an EpiPen",
        dietaryNotes: "vegetarian",
      });
      expect(
        intakeErrors({ allergyNotes: "shellfish", noDietaryNeeds: true }).value
          ?.intake?.allergies,
      ).toBe("shellfish");
    });
    it("noAllergies cannot be combined with allergens or notes; same for dietary", () => {
      expect(
        intakeErrors({
          noAllergies: true,
          allergens: ["soy"],
          noDietaryNeeds: true,
        }).errors["intake.noAllergies"],
      ).toBeTruthy();
      expect(
        intakeErrors({
          noAllergies: true,
          allergyNotes: "x",
          noDietaryNeeds: true,
        }).errors["intake.noAllergies"],
      ).toBeTruthy();
      expect(
        intakeErrors({
          noAllergies: true,
          noDietaryNeeds: true,
          dietaryNotes: "x",
        }).errors["intake.noDietaryNeeds"],
      ).toBeTruthy();
    });
    it("only picker allergens, distinct, lower case", () => {
      expect(
        intakeErrors({ allergens: ["lava"], noDietaryNeeds: true }).errors[
          "intake.allergens"
        ],
      ).toBeTruthy();
      expect(
        intakeErrors({ allergens: "soy", noDietaryNeeds: true }).errors[
          "intake.allergens"
        ],
      ).toBeTruthy();
      expect(
        intakeErrors({ allergens: [1], noDietaryNeeds: true }).errors[
          "intake.allergens"
        ],
      ).toBeTruthy();
      const dup = intakeErrors({
        allergens: ["soy", "Soy ", "soy"],
        noDietaryNeeds: true,
      });
      expect(dup.errors).toEqual({});
      expect(dup.value?.intake?.allergies).toBe("soy");
    });
    it("limits text length and refuses control characters, in both modes", () => {
      for (const mode of ["create", "estimate"] as const) {
        expect(
          intakeErrors(
            { allergyNotes: "x".repeat(301), noDietaryNeeds: true },
            mode,
          ).errors["intake.allergyNotes"],
        ).toBeTruthy();
        expect(
          intakeErrors(
            { noAllergies: true, dietaryNotes: "y".repeat(501) },
            mode,
          ).errors["intake.dietaryNotes"],
        ).toBeTruthy();
        expect(
          intakeErrors(
            { allergyNotes: "bad\u0007", noDietaryNeeds: true },
            mode,
          ).errors["intake.allergyNotes"],
        ).toMatch(/control/i);
        expect(
          intakeErrors({ noAllergies: true, dietaryNotes: "\ud800" }, mode)
            .errors["intake.dietaryNotes"],
        ).toMatch(/control/i);
      }
      // line breaks are fine in free text
      expect(
        intakeErrors({ allergyNotes: "a\nb", noDietaryNeeds: true }).errors,
      ).toEqual({});
    });
    it("refuses unknown keys and non-booleans", () => {
      expect(
        intakeErrors({ noAllergies: "yes", noDietaryNeeds: true }).errors[
          "intake.noAllergies"
        ],
      ).toBeTruthy();
      expect(
        intakeErrors({ noAllergies: true, noDietaryNeeds: true, hack: 1 })
          .errors["intake.hack"],
      ).toBeTruthy();
      expect(intakeErrors("none").errors.intake).toBeTruthy();
    });
  });
});

describe("requestExpiry (D-19, D-27)", () => {
  it("is 72 hours from now when day 1 is far away", () => {
    const now = new Date("2026-10-10T15:00:00Z");
    expect(requestExpiry(now, "2026-10-30").toISOString()).toBe(
      "2026-10-13T15:00:00.000Z",
    );
  });
  it("is 00:00 Toronto on day 1 when that is sooner (a request for tomorrow expires at midnight)", () => {
    const now = new Date("2026-10-10T15:00:00Z"); // 11:00 EDT
    // Midnight starting 2026-10-11 in Toronto (EDT, UTC-4) is 04:00Z.
    expect(requestExpiry(now, "2026-10-11").toISOString()).toBe(
      "2026-10-11T04:00:00.000Z",
    );
  });
  it("handles the winter offset (EST, UTC-5)", () => {
    const now = new Date("2026-12-01T15:00:00Z");
    expect(requestExpiry(now, "2026-12-02").toISOString()).toBe(
      "2026-12-02T05:00:00.000Z",
    );
  });
  it("handles the clock change (spring forward 2027-03-14 and fall back 2026-11-01)", () => {
    expect(
      requestExpiry(
        new Date("2027-03-13T15:00:00Z"),
        "2027-03-14",
      ).toISOString(),
    ).toBe("2027-03-14T05:00:00.000Z");
    expect(
      requestExpiry(
        new Date("2027-03-13T15:00:00Z"),
        "2027-03-15",
      ).toISOString(),
    ).toBe("2027-03-15T04:00:00.000Z");
    expect(
      requestExpiry(
        new Date("2026-10-31T15:00:00Z"),
        "2026-11-01",
      ).toISOString(),
    ).toBe("2026-11-01T04:00:00.000Z");
  });
  it("takes the earlier of the two at the boundary", () => {
    // 72 hours before 04:00Z on 2026-10-13 is 04:00Z on 2026-10-10: equal, either is right.
    const now = new Date("2026-10-10T04:00:00Z");
    expect(requestExpiry(now, "2026-10-13").toISOString()).toBe(
      "2026-10-13T04:00:00.000Z",
    );
  });
  it("accepts another hour count", () => {
    const now = new Date("2026-10-10T15:00:00Z");
    expect(requestExpiry(now, "2026-12-30", 24).toISOString()).toBe(
      "2026-10-11T15:00:00.000Z",
    );
  });
});

const issue = (
  code: BookingIssue["code"],
  dayIndex?: number,
): BookingIssue => ({
  code,
  message: `m-${code}`,
  dayIndex,
});

describe("classifyIssues", () => {
  it("no issues is ok", () => expect(classifyIssues([])).toBe("ok"));
  it("a hidden chef wins over everything", () => {
    expect(
      classifyIssues([issue("DOUBLE_BOOKED", 0), issue("CHEF_NOT_BOOKABLE")]),
    ).toBe("hidden");
  });
  it("only double bookings is a conflict", () => {
    expect(
      classifyIssues([issue("DOUBLE_BOOKED", 0), issue("DOUBLE_BOOKED", 1)]),
    ).toBe("double_booked");
  });
  it("double booking next to another problem is a validation error", () => {
    expect(
      classifyIssues([issue("DOUBLE_BOOKED", 0), issue("NO_DISHES", 1)]),
    ).toBe("validation");
    expect(classifyIssues([issue("VISIT_TOO_LONG", 0)])).toBe("validation");
  });
});

describe("issuesToFields", () => {
  it("keys day issues by day index and the rest by the request field", () => {
    const f = issuesToFields([
      issue("DATE_TOO_SOON", 0),
      issue("DOUBLE_BOOKED", 1),
      issue("NO_DISHES", 2),
      issue("OUTSIDE_SERVICE_AREA"),
      issue("POSTAL_NOT_GTA"),
      issue("LOCATION_NOT_OFFERED"),
      issue("DAYS_COUNT"),
      issue("INTAKE_MISSING"),
      issue("ALLERGY_NOT_ACKNOWLEDGED"),
      issue("VISIT_TOO_LONG", 1),
    ]);
    expect(f).toMatchObject({
      "days.0.date": "m-DATE_TOO_SOON",
      "days.1.date": "m-DOUBLE_BOOKED",
      "days.2.dishes": "m-NO_DISHES",
      "address.postalCode": expect.stringContaining("m-"),
      locationType: "m-LOCATION_NOT_OFFERED",
      days: "m-DAYS_COUNT",
      intake: "m-INTAKE_MISSING",
      allergyConflictAcknowledged: "m-ALLERGY_NOT_ACKNOWLEDGED",
    });
  });
  it("keeps the first message when two issues share a key", () => {
    const f = issuesToFields([
      issue("DISH_NOT_FOUND", 0),
      issue("DISH_INACTIVE", 0),
    ]);
    expect(f["days.0.dishes"]).toBe("m-DISH_NOT_FOUND");
  });
  it("every issue code has a field", () => {
    const codes: BookingIssue["code"][] = [
      "DAYS_COUNT",
      "DATE_INVALID",
      "DATE_DUPLICATE",
      "DATE_IN_PAST",
      "DATE_TOO_SOON",
      "DATE_BEYOND_WINDOW",
      "CHEF_NOT_BOOKABLE",
      "LOCATION_NOT_OFFERED",
      "CHEF_HOME_NOT_ENABLED",
      "CHEF_UNAVAILABLE",
      "DOUBLE_BOOKED",
      "POSTAL_NOT_GTA",
      "CHEF_NO_SERVICE_AREA",
      "OUTSIDE_SERVICE_AREA",
      "NO_DISHES",
      "DISH_NOT_FOUND",
      "DISH_INACTIVE",
      "DISH_DUPLICATE",
      "QUANTITY_INVALID",
      "VISIT_TOO_LONG",
      "INTAKE_MISSING",
      "ALLERGY_NOT_ACKNOWLEDGED",
    ];
    for (const c of codes)
      expect(Object.keys(issuesToFields([issue(c, 0)])).length, c).toBe(1);
  });
});
