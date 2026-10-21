// T-093 and T-095: values with no visible character, and the T-060 follow-ups.
import { describe, expect, it } from "vitest";
import { Fields } from "@/lib/api/validate";
import { displayNameProblem, validateAddress } from "@/lib/validation/auth";
import { localProblems, emptyDraft } from "@/lib/booking/form";
import { parseDishBody } from "./dishes";
import { parseUpdateBody } from "./chef-application";
import { parseKitchenReview } from "./admin-chefs";
import { parseBookingBody } from "./bookingRequest";
import { addressKey } from "./address";
import { hasNoVisibleText, NO_VISIBLE_TEXT } from "./text-fold";
import { hasUnsafeText } from "./text-safety";

const ZWJ = "‍";
const ZWNJ = "‌";
const EMPTY_LIKE = [ZWJ, ZWNJ, `${ZWJ}${ZWNJ}${ZWJ}`, " ‍ ", "　", "  "];
const VISIBLE = [
  "Nguyễn Văn Đạt",
  "王小明",
  "علي",
  "می‌خواهم",
  "👩‍🍳",
  "Mom's pho",
];

describe("hasNoVisibleText", () => {
  it.each(EMPTY_LIKE)("true for %j", (t) =>
    expect(hasNoVisibleText(t)).toBe(true),
  );
  it("true for the empty string", () =>
    expect(hasNoVisibleText("")).toBe(true));
  it.each(VISIBLE)("false for %j", (t) =>
    expect(hasNoVisibleText(t)).toBe(false),
  );
});

describe("names and address lines refuse invisible-only values", () => {
  it.each(EMPTY_LIKE)("%j: server and browser agree", (t) => {
    const f = new Fields();
    f.visibleText({ k: t }, "k", 1, 80);
    expect(f.errors.k).toBeTruthy();
    if (t.trim() !== "") expect(f.errors.k).toBe(NO_VISIBLE_TEXT);
    expect(displayNameProblem(t)).not.toBeNull();
    const a = validateAddress({ line: t, city: t, postalCode: "L5B 1A1" });
    expect(a.line).toBeTruthy();
    expect(a.city).toBeTruthy();
    // joiner-only is unsafe-free text, so the new rule is what refuses it
    if (t.trim() !== "") expect(hasUnsafeText(t)).toBe(false);
  });
  it.each(VISIBLE)("%j still accepted everywhere", (t) => {
    const f = new Fields();
    f.visibleText({ k: t }, "k", 1, 80);
    expect(f.errors.k).toBeUndefined();
    expect(displayNameProblem(t)).toBeNull();
    expect(
      validateAddress({ line: t, city: t, postalCode: "L5B 1A1" }),
    ).toEqual({});
  });
  it("dish name", () => {
    expect(
      parseDishBody({ name: ZWJ, cuisine: "x", cookMinutes: 30 }, "create")
        .errors.name,
    ).toBe(NO_VISIBLE_TEXT);
    expect(
      parseDishBody({ name: "Phở", cuisine: "x", cookMinutes: 30 }, "create")
        .errors.name,
    ).toBeUndefined();
  });
  it("kitchen address line and city (chef application)", () => {
    const { errors } = parseUpdateBody({
      kitchenAddress: { line: ZWJ, city: ZWNJ, postalCode: "L5B 1A1" },
    });
    expect(errors["kitchenAddress.line"]).toBe(NO_VISIBLE_TEXT);
    expect(errors["kitchenAddress.city"]).toBe(NO_VISIBLE_TEXT);
  });
  it("admin reviewed kitchen address", () => {
    let fields: Record<string, string> = {};
    try {
      parseKitchenReview({
        decision: "approve",
        reviewedPhotoPaths: [],
        reviewedAddress: { line: ZWJ, city: ZWNJ, postalCode: "L5B 1A1" },
      });
    } catch (e) {
      fields = (e as { extra: { fields: Record<string, string> } }).extra
        .fields;
    }
    expect(fields["reviewedAddress.line"]).toBe(NO_VISIBLE_TEXT);
    expect(fields["reviewedAddress.city"]).toBe(NO_VISIBLE_TEXT);
  });
  it("booking address (server and browser)", () => {
    const { errors } = parseBookingBody(
      {
        locationType: "customer_home",
        address: { line: ZWJ, city: ZWNJ, postalCode: "L5B 1A1" },
      },
      "estimate",
    );
    expect(errors["address.line"]).toBe(NO_VISIBLE_TEXT);
    expect(errors["address.city"]).toBe(NO_VISIBLE_TEXT);
    const d = emptyDraft();
    d.locationType = "customer_home";
    d.address = { line: ZWJ, city: ZWNJ, postalCode: "L5B 1A1" };
    const e = localProblems(d, [], ["customer_home"]);
    expect(e["address.line"]).toBe(NO_VISIBLE_TEXT);
    expect(e["address.city"]).toBe(NO_VISIBLE_TEXT);
  });
  it("free text is not changed by the rule", () => {
    const { errors, value } = parseUpdateBody({ bio: ZWJ });
    expect(errors.bio).toBeUndefined();
    expect(value.bio).toBe(ZWJ);
  });
});

describe("T-095", () => {
  it("addressKey folds look-alike letters before lowercasing", () => {
    expect(addressKey("ℌigh Street 5", "L5B 1A1")).toBe(
      addressKey("High Street 5", "L5B 1A1"),
    );
    expect(addressKey("High Street 5", "L5B 1A1")).toBe("high st 5|L5B1A1");
  });
  it("browser validateAddress refuses unsafe characters like the server", () => {
    const a = validateAddress({
      line: "1 Main\u0000St",
      city: "Mississauga‮",
      postalCode: "L5B 1A1",
    });
    expect(a.line).toBeTruthy();
    expect(a.city).toBeTruthy();
  });
});
