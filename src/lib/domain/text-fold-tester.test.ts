// T-060 Tester: every public-text parser refuses each invisible character and names its field;
// the fold keeps non-Latin scripts, keeps ASCII address keys identical to main, and the T-088
// phone rule does not regress. Characterisation tests (marked) record builder choices, not bugs.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { parseDishBody } from "./dishes";
import { parseUpdateBody } from "./chef-application";
import { parseBookingBody } from "./bookingRequest";
import { parseIntake } from "./bookingRequest";
import { parseCancelReason } from "./bookingChanges";
import { parseReceiptAnswer } from "./groceries";
import { parseReportBody, parseDecisionBody } from "./reviews";
import { parseKitchenReview, parseReason } from "./admin-chefs";
import { parseSearchQuery } from "./search";
import { parseDeclineBody } from "@/lib/server/bookings";
import { addressKey, normalizeAddressLine } from "./address";
import { findContactDetails } from "./contactDetails";
import { foldText, hasInvisibleText } from "./text-fold";
import { hasUnsafeText } from "./text-safety";

const CHARS: [string, string][] = [
  ["202A", "‪"],
  ["202B", "‫"],
  ["202C", "‬"],
  ["202D", "‭"],
  ["202E", "‮"],
  ["2066", "⁦"],
  ["2067", "⁧"],
  ["2068", "⁨"],
  ["2069", "⁩"],
  ["200B", "​"],
  ["200C", "‌"],
  ["200D", "‍"],
  ["2060", "⁠"],
  ["FEFF", "﻿"],
];
/** The field names of a thrown 422 (ApiFailure.extra.fields); [] if it is anything else. */
const failFields = (e: unknown): Record<string, string> =>
  (e as { extra?: { fields?: Record<string, string> } }).extra?.fields ?? {};
const mid = (c: string) => `Ann${c}Lee`;
const ID = "11111111-1111-4111-8111-111111111111";

/** Each entry returns the names of the fields the parser refused for a text with the character. */
const FIELD_FAMILIES: Record<string, (t: string) => string[]> = {
  "dish name": (t) =>
    Object.keys(
      parseDishBody({ name: t, cuisine: "Thai", cookMinutes: 30 }, "create")
        .errors,
    ),
  "dish cuisine": (t) =>
    Object.keys(
      parseDishBody({ name: "Pho", cuisine: t, cookMinutes: 30 }, "create")
        .errors,
    ),
  "dish description": (t) =>
    Object.keys(
      parseDishBody(
        { name: "Pho", cuisine: "Thai", cookMinutes: 30, description: t },
        "create",
      ).errors,
    ),
  "dish allergens": (t) =>
    Object.keys(
      parseDishBody(
        { name: "Pho", cuisine: "Thai", cookMinutes: 30, allergens: [t] },
        "create",
      ).errors,
    ),
  "chef bio": (t) => Object.keys(parseUpdateBody({ bio: t }).errors),
  "chef cuisines": (t) =>
    Object.keys(parseUpdateBody({ cuisines: [t] }).errors),
  "chef languages": (t) =>
    Object.keys(parseUpdateBody({ languages: [t] }).errors),
  "intake allergyNotes": (t) =>
    Object.keys(parseIntake({ allergyNotes: t, noDietaryNeeds: true }).invalid),
  "cancel reason": (t) => {
    const r = parseCancelReason({ reason: t });
    return "error" in r && r.error ? ["reason"] : [];
  },
  "receipt dispute note": (t) => {
    const r = parseReceiptAnswer({ action: "dispute", note: t });
    return "fields" in r ? Object.keys(r.fields) : [];
  },
  "report description": (t) => {
    const r = parseReportBody({ clientId: ID, description: t });
    return r.ok ? [] : Object.keys(r.fields);
  },
  "admin decision note": (t) => {
    const r = parseDecisionBody({ note: t }, "none");
    return r.ok ? [] : Object.keys(r.fields);
  },
  "admin reason": (t) => {
    try {
      parseReason({ reason: t }, "reason");
      return [];
    } catch (e) {
      return Object.keys(failFields(e));
    }
  },
  "kitchen review note": (t) => {
    try {
      parseKitchenReview({
        decision: "reject",
        note: t,
        reviewedPhotoPaths: [],
        reviewedAddress: null,
      });
      return [];
    } catch (e) {
      return Object.keys(failFields(e)).filter((k) => k === "note");
    }
  },
  "search cuisine": (t) =>
    Object.keys(
      parseSearchQuery(new URLSearchParams({ cuisine: t }), {
        prefixes: [],
      } as never).errors,
    ).filter((k) => k === "cuisine"),
  "decline reason": (t) => {
    try {
      parseDeclineBody({ reason: t });
      return [];
    } catch (e) {
      return Object.keys(failFields(e));
    }
  },
};

describe("T-060 tester: every family refuses every invisible character mid-text", () => {
  for (const [family, run] of Object.entries(FIELD_FAMILIES))
    it.each(CHARS)(`${family}: U+%s`, (_n, c) => {
      const names = run(mid(c));
      expect(names.length).toBeGreaterThan(0);
    });
  it.each(Object.keys(FIELD_FAMILIES))("%s: clean text passes", (family) => {
    // Control case: guards against a harness that refuses everything.
    const names = FIELD_FAMILIES[family]("Ann Lee");
    expect(names).toEqual([]);
  });
});

describe("T-060 tester: booking address line/city name their field", () => {
  const base = (line: string, city: string) => ({
    chefId: ID,
    locationType: "customer_home",
    address: { line, city, postalCode: "L5B 1A1" },
  });
  it.each(CHARS)("U+%s in address.line / address.city", (_n, c) => {
    const a = parseBookingBody(base(mid(c), "Mississauga"), "estimate").errors;
    expect(a["address.line"]).toBeTruthy();
    const b = parseBookingBody(base("1 Main St", mid(c)), "estimate").errors;
    expect(b["address.city"]).toBeTruthy();
  });
});

describe("T-060 tester: edge versus middle (characterisation)", () => {
  it("a leading or trailing U+FEFF is stripped by trim, not refused (builder note)", () => {
    expect(parseCancelReason({ reason: "﻿Not well﻿" })).toEqual({
      value: "Not well",
    });
    expect(
      parseDishBody(
        { name: "﻿Pho﻿", cuisine: "Thai", cookMinutes: 30 },
        "create",
      ).value.name,
    ).toBe("Pho");
  });
  it("leading/trailing zero-width space is refused, not stripped", () => {
    expect(parseCancelReason({ reason: "​Not well" })).toHaveProperty("error");
    expect(hasUnsafeText("Not well​")).toBe(true);
  });
  it("chef bio is checked before trim, so a leading BOM is refused there (inconsistent with other fields, low)", () => {
    expect(parseUpdateBody({ bio: "﻿Hello" }).errors.bio).toBeTruthy();
  });
});

describe("T-060 tester: joiner effect on scripts and emoji (characterisation, pending Jimmy)", () => {
  it("refuses joined emoji (woman cook), keeps single emoji and skin-tone emoji", () => {
    expect(hasUnsafeText("👩‍🍳")).toBe(true);
    expect(hasUnsafeText("👩🍳")).toBe(false);
    expect(hasUnsafeText("👩🏽")).toBe(false);
  });
  it("refuses Persian text that needs ZWNJ (می‌خواهم) and Hindi with ZWJ", () => {
    expect(hasUnsafeText("می‌خواهم")).toBe(true);
    expect(hasUnsafeText("क्‍ष")).toBe(true);
    // Without the joiner the same words are accepted.
    expect(hasUnsafeText("میخواهم")).toBe(false);
  });
  it("the variation selector U+FE0F is NOT refused", () => {
    expect(hasUnsafeText("❤️")).toBe(false);
  });
});

describe("T-060 tester: not-listed invisible characters (characterisation)", () => {
  it.each([
    ["200E LRM", "‎"],
    ["200F RLM", "‏"],
    ["00AD soft hyphen", "­"],
    ["180E", "᠎"],
    ["2061 function application", "⁡"],
    ["3164 hangul filler", "ㅤ"],
  ])("U+%s passes hasUnsafeText (not in Jimmy's list)", (_n, c) => {
    expect(hasUnsafeText(mid(c))).toBe(false);
  });
});

describe("T-060 tester: address key fold", () => {
  // Reference copy of main's normalizer (ASCII only), to prove ASCII keys are unchanged.
  const ABBR: Record<string, string> = {
    street: "st",
    avenue: "ave",
    road: "rd",
    drive: "dr",
    boulevard: "blvd",
    court: "ct",
    crescent: "cres",
    lane: "ln",
    place: "pl",
    circle: "cir",
    terrace: "terr",
    trail: "trl",
    highway: "hwy",
    parkway: "pkwy",
    square: "sq",
    north: "n",
    south: "s",
    east: "e",
    west: "w",
    apt: "unit",
    apartment: "unit",
    suite: "unit",
    ste: "unit",
  };
  const mainNormalize = (line: string) =>
    line
      .toLowerCase()
      .replace(/#/g, " unit ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .map((w) => ABBR[w] ?? w)
      .filter((w, i, all) => !(w === "unit" && all[i - 1] === "unit"))
      .join(" ");
  const ASCII = [
    "100 Fictional Street Unit 5",
    "100 Fictional St., Apt #5",
    "5th Ave. N",
    "12-34 O'Brien Rd",
    "#7 - 200 Main Street West",
    "Suite 12, 1 King's Crescent",
    "  PO Box 99  ",
    "1/2 Lane",
    "a_b~c|d",
    "Unit 5 Unit 5",
    "",
    "###",
    "42 Hwy 10 (rear)",
    "9 Park-way",
    "7\tTab\nNew",
  ];
  it.each(ASCII)("ASCII %j unchanged vs main", (s) => {
    expect(normalizeAddressLine(s)).toBe(mainNormalize(s));
  });
  it("accent, full-width and BOM variants equal the plain key", () => {
    const plain = addressKey("100 Edouard Street", "L5B 1A1");
    expect(addressKey("100 Édouard Street", "L5B 1A1")).toBe(plain);
    expect(addressKey("１００ Édouard Street", "L5B 1A1")).toBe(plain);
    expect(addressKey("100 Edou​ard Street", "L5B 1A1")).toBe(plain);
    expect(addressKey("100 Édouard Street", "L5B 1A1")).toBe(plain);
  });
  it("non-Latin keys are non-empty and distinct", () => {
    const lines = [
      "王小明路 5号",
      "李小龍路 5号",
      "شارع الملك 7",
      "شارع النيل 7",
      "शिवाजी मार्ग 3",
      "ถนนสุขุมวิท 10",
      "서울로 12",
      "ひらがな通り 4",
      "Улица Ленина 9",
    ];
    const keys = lines.map((l) => normalizeAddressLine(l));
    for (const k of keys) expect(k.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(lines.length);
  });
  it("Hindi, Thai and Arabic marks are kept; Vietnamese tones are dropped", () => {
    expect(foldText("शिवाजी")).toBe("शिवाजी");
    expect(foldText("ถนนสุขุม")).toBe("ถนนสุขุม");
    expect(foldText("كِتاب")).toBe("كِتاب");
    expect(foldText("Nguyễn")).toBe("Nguyen");
    expect(foldText("ひらがなが")).toBe("ひらがなが");
    expect(foldText("한글")).toBe("한글");
  });
  it("a hidden zero-width char in a non-Latin line cannot make a second trial key", () => {
    expect(normalizeAddressLine("王小​明路 5号")).toBe(
      normalizeAddressLine("王小明路 5号"),
    );
  });
  it("characterisation: tone-only differences collide (Vietnamese ma / má / mả are one key)", () => {
    expect(normalizeAddressLine("Phố Mã")).toBe(normalizeAddressLine("Pho Ma"));
  });
  it("characterisation: Cyrillic look-alikes are not folded (known limit)", () => {
    expect(normalizeAddressLine("100 Аbc st")).not.toBe(
      normalizeAddressLine("100 Abc st"),
    );
  });
  it("different Latin streets stay different", () => {
    expect(addressKey("100 Main St", "L5B 1A1")).not.toBe(
      addressKey("101 Main St", "L5B 1A1"),
    );
  });
});

describe("T-060 tester: contact filter fold and T-088 no regression", () => {
  it.each([
    "call ４１６ ５５５ ０１９９",
    "416–555–0199",
    "416—555—0199",
    "416−555−0199",
    "4​1​6 555 0199",
    "(４１６) ５５５-０１９９",
    "+１ 416 555 0199",
    "x＠y.com",
    "ｗｗｗ.example.com",
    "réseau416.555.0199",
  ])("catches %j", (t) => {
    expect(findContactDetails(t)).not.toBeNull();
  });
  it.each([
    "order 20261031",
    "order １２３４５",
    "2026-10-20",
    "on 2026–10–20 please",
    "2026​-10-20",
    "ref 12345 and 6789",
    "I paid $120 and 45 more",
    "123456789012",
    "555 0199",
    "day 1 of 3, 2 hours",
    "王小明 5号",
    "Nguyễn Văn Đạt cooks pho",
  ])("passes %j", (t) => {
    expect(findContactDetails(t)).toBeNull();
  });
  it("non-Latin text with a phone is still caught", () => {
    expect(findContactDetails("电话 416 555 0199")).toBe("phone");
  });
  it("hasInvisibleText ignores ordinary whitespace", () => {
    expect(hasInvisibleText(" \t\n 　")).toBe(false);
  });
});

describe("T-060 tester: admin kitchen reviewedAddress (gap, low)", () => {
  it("characterisation: reviewedAddress.line is NOT checked for invisible text (admin-only, compared to the stored address)", () => {
    const r = parseKitchenReview({
      decision: "approve",
      reviewedPhotoPaths: [],
      reviewedAddress: {
        line: "1 Ma​in St",
        city: "Mississauga",
        postalCode: "L5B 1A1",
      },
    });
    expect(r.reviewedAddress?.line).toBe("1 Ma​in St");
  });
});

describe("T-060 tester: message wording differs by field (contract says 'same message', low)", () => {
  it("characterisation: bio and kitchen address keep their older wording, still 422 on the field", () => {
    expect(parseUpdateBody({ bio: "a​b" }).errors.bio).toBe(
      "Use plain text. Control characters are not allowed.",
    );
    expect(
      parseUpdateBody({
        kitchenAddress: { line: "a​b", city: "x", postalCode: "L5B1A1" },
      }).errors["kitchenAddress.line"],
    ).toBe("Enter 1 to 120 characters.");
  });
});
