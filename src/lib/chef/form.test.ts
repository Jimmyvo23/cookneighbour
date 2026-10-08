import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/client";
import {
  buildKitchenPatch,
  buildProfilePatch,
  checkStatusText,
  describeError,
  describeMissing,
  dollarsToCents,
  parseList,
  statusView,
} from "@/lib/chef/form";

describe("parseList", () => {
  it("splits on commas and new lines, trims, drops blanks", () => {
    expect(parseList(" Vietnamese, Thai ,, \nPho  ")).toEqual([
      "Vietnamese",
      "Thai",
      "Pho",
    ]);
    expect(parseList("")).toEqual([]);
  });
});

describe("dollarsToCents", () => {
  it.each([
    ["25", 2500],
    ["25.5", 2550],
    ["$25.50", 2550],
    [" 18.05 ", 1805],
  ])("%s -> %s", (t, c) => expect(dollarsToCents(t)).toBe(c));
  it.each(["", "abc", "1.234", "-5", "1e3"])("%s -> null", (t) =>
    expect(dollarsToCents(t)).toBeNull(),
  );
});

const good = {
  bio: "I cook pho.",
  cuisines: "Vietnamese",
  languages: "English, Vietnamese",
  rate: "28",
  prefix: "l5b",
  radius: "15",
  locationOptions: ["customer_home" as const],
};

describe("buildProfilePatch", () => {
  it("builds the PATCH body for valid input", () => {
    const r = buildProfilePatch(good);
    expect(r.errors).toEqual({});
    expect(r.body).toEqual({
      bio: "I cook pho.",
      cuisines: ["Vietnamese"],
      languages: ["English", "Vietnamese"],
      hourlyRateCents: 2800,
      servicePostalPrefix: "L5B",
      serviceRadiusKm: 15,
      locationOptions: ["customer_home"],
    });
  });
  it("reports every problem with the server's field names", () => {
    const r = buildProfilePatch({
      bio: "",
      cuisines: "",
      languages: "",
      rate: "1",
      prefix: "zz",
      radius: "0",
      locationOptions: [],
    });
    expect(r.body).toBeUndefined();
    expect(Object.keys(r.errors).sort()).toEqual([
      "cuisines",
      "hourlyRateCents",
      "languages",
      "locationOptions",
      "servicePostalPrefix",
      "serviceRadiusKm",
    ]);
  });
  it("does not accept a rate that is not a number", () => {
    expect(
      buildProfilePatch({ ...good, rate: "abc" }).errors.hourlyRateCents,
    ).toMatch(/\$5/);
  });
  it("refuses control characters in the bio", () => {
    expect(
      buildProfilePatch({ ...good, bio: "a\u0000b" }).errors.bio,
    ).toBeTruthy();
  });
  it("more than 10 cuisines is an error", () => {
    const many = Array.from({ length: 11 }, (_, i) => `c${i}`).join(",");
    expect(
      buildProfilePatch({ ...good, cuisines: many }).errors.cuisines,
    ).toBeTruthy();
  });
});

describe("buildKitchenPatch", () => {
  it("normalizes the postal code", () => {
    const r = buildKitchenPatch({
      line: "1 Main St",
      city: "Mississauga",
      postalCode: "l5b 1a1",
    });
    expect(r.body).toEqual({
      kitchenAddress: {
        line: "1 Main St",
        city: "Mississauga",
        postalCode: "L5B1A1",
      },
    });
  });
  it("uses nested error keys", () => {
    const r = buildKitchenPatch({ line: "", city: "", postalCode: "zzz" });
    expect(Object.keys(r.errors).sort()).toEqual([
      "kitchenAddress.city",
      "kitchenAddress.line",
      "kitchenAddress.postalCode",
    ]);
  });
});

describe("describeMissing", () => {
  it("has a plain label for every item", () => {
    const all = [
      "displayName",
      "bio",
      "photo",
      "cuisines",
      "languages",
      "hourlyRate",
      "servicePostalPrefix",
      "locationOptions",
      "idDocument",
      "foodHandler",
      "allergenAcknowledgement",
      "phoneVerified",
      "sampleDish",
      "kitchenAddress",
      "kitchenPhotos",
      "kitchenHygieneAcknowledgement",
    ] as const;
    for (const k of all) expect(describeMissing(k).length).toBeGreaterThan(5);
  });
  it("points at a real dish with a photo", () => {
    expect(describeMissing("sampleDish")).toMatch(/active dish with a photo/i);
    expect(describeMissing("sampleDish")).not.toMatch(/not available yet/i);
  });
});

describe("checkStatusText", () => {
  it.each([
    ["not_started", "Not started"],
    ["pending", "Pending review"],
    ["verified", "Verified"],
    ["failed", "Failed"],
  ] as const)("%s", (s, t) => expect(checkStatusText(s)).toBe(t));
});

describe("statusView", () => {
  const base = {
    id: "not_started",
    foodHandler: "not_started",
    kitchen: "not_started",
    police: "not_started",
  } as const;
  it("draft pending", () => {
    expect(
      statusView({ status: "pending", rejectReason: null, checks: base }).kind,
    ).toBe("draft");
  });
  it("submitted pending", () => {
    expect(
      statusView({
        status: "pending",
        rejectReason: null,
        checks: { ...base, id: "pending" },
      }).kind,
    ).toBe("submitted");
  });
  it("rejected carries the reason", () => {
    const v = statusView({
      status: "rejected",
      rejectReason: "Blurry ID",
      checks: base,
    });
    expect(v.kind).toBe("rejected");
    expect(v.text).toMatch(/Blurry ID/);
  });
  it("approved", () => {
    expect(
      statusView({ status: "approved", rejectReason: null, checks: base }).kind,
    ).toBe("approved");
  });
});

describe("describeError", () => {
  it("lists missing items for APPLICATION_INCOMPLETE", () => {
    const e = new ApiClientError(409, "APPLICATION_INCOMPLETE", "x", {
      missing: ["bio", "photo"],
    });
    const m = describeError(e);
    expect(m).toMatch(/not complete/i);
    expect(m).toMatch(/bio/i);
  });
  it("explains INVALID_STATE", () => {
    expect(
      describeError(
        new ApiClientError(409, "INVALID_STATE", "Already approved."),
      ),
    ).toMatch(/Already approved/);
  });
  it("maps 404, 403, 401 and 422", () => {
    expect(describeError(new ApiClientError(404, "NOT_FOUND", "x"))).toMatch(
      /upload it again/i,
    );
    expect(describeError(new ApiClientError(403, "FORBIDDEN", "x"))).toMatch(
      /not allowed/i,
    );
    expect(
      describeError(new ApiClientError(401, "UNAUTHENTICATED", "x")),
    ).toMatch(/log in/i);
    expect(
      describeError(
        new ApiClientError(
          422,
          "VALIDATION_FAILED",
          "Check the highlighted fields.",
          { fields: { path: "bad" } },
        ),
      ),
    ).toMatch(/Check/);
  });
  it("falls back for unknown errors", () => {
    expect(describeError(new Error("boom"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
