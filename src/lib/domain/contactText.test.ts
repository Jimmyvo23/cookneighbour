import { describe, expect, it } from "vitest";
import {
  CONTACT_FIELD_MESSAGE,
  contactProblem,
  failureForFields,
} from "./contactText";
import { parseDishBody } from "./dishes";
import { parseUpdateBody } from "./chef-application";
import { parseIntake } from "./bookingRequest";
import { displayNameProblem } from "@/lib/validation/auth";
import { intakeProblems } from "@/lib/booking/form";

describe("contactProblem", () => {
  it("flags phone, email, url", () => {
    expect(contactProblem("Anna 416 555 0199")).toBe(CONTACT_FIELD_MESSAGE);
    expect(contactProblem("me@x.com")).toBe(CONTACT_FIELD_MESSAGE);
    expect(contactProblem("see example.com")).toBe(CONTACT_FIELD_MESSAGE);
    expect(contactProblem("Anna Nguyen")).toBeNull();
  });
});

describe("failureForFields", () => {
  it("is a contact failure only when every error is the contact message", () => {
    expect(failureForFields({ a: CONTACT_FIELD_MESSAGE }).code).toBe(
      "CONTACT_DETAILS_NOT_ALLOWED",
    );
    expect(
      failureForFields({ a: CONTACT_FIELD_MESSAGE, b: "Required." }).code,
    ).toBe("VALIDATION_FAILED");
    expect(failureForFields({}).code).toBe("VALIDATION_FAILED");
  });
});

describe("self text checks", () => {
  it("display name", () => {
    expect(displayNameProblem("Anna 4165550199")).toBe(CONTACT_FIELD_MESSAGE);
    expect(displayNameProblem("Anna")).toBeNull();
  });
  it("chef bio", () => {
    expect(parseUpdateBody({ bio: "mail me a@b.co" }).errors.bio).toBe(
      CONTACT_FIELD_MESSAGE,
    );
    expect(parseUpdateBody({ bio: "I cook pho." }).errors.bio).toBeUndefined();
  });
  it("dish name and description", () => {
    const r = parseDishBody(
      {
        name: "Pho 416-555-0199",
        description: "call www.x.com",
        cuisine: "vietnamese",
        cookMinutes: 60,
      },
      "create",
    );
    expect(r.errors.name).toBe(CONTACT_FIELD_MESSAGE);
    expect(r.errors.description).toBe(CONTACT_FIELD_MESSAGE);
  });
  it("intake notes", () => {
    const r = parseIntake({
      noAllergies: false,
      allergens: [],
      allergyNotes: "call 416 555 0199",
      noDietaryNeeds: false,
      dietaryNotes: "email a@b.co",
    });
    expect(r.invalid["intake.allergyNotes"]).toBe(CONTACT_FIELD_MESSAGE);
    expect(r.invalid["intake.dietaryNotes"]).toBe(CONTACT_FIELD_MESSAGE);
    const e = intakeProblems({
      noAllergies: false,
      allergens: [],
      allergyNotes: "call 416 555 0199",
      noDietaryNeeds: false,
      dietaryNotes: "a@b.co",
    });
    expect(e["intake.allergies"]).toBe(CONTACT_FIELD_MESSAGE);
    expect(e["intake.dietaryNotes"]).toBe(CONTACT_FIELD_MESSAGE);
  });
});

describe("seed data (D-147)", () => {
  it("every seeded name, bio, dish name and dish description passes the filter", async () => {
    const { chefs, customers, ADMIN_NAME } =
      await import("../../../scripts/seed-data");
    const texts: string[] = [ADMIN_NAME];
    for (const c of customers) texts.push(c.displayName);
    for (const c of chefs) {
      texts.push(c.displayName, c.bio);
      for (const d of c.dishes) texts.push(d.name, d.description);
    }
    const bad = texts.filter((t) => t && contactProblem(t));
    expect(bad).toEqual([]);
    expect(texts.length).toBeGreaterThan(20);
  });
});
