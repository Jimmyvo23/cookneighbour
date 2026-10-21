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
  it("chef bio is trimmed before the check, so an edge BOM is trimmed like in other fields (F3)", () => {
    const r = parseUpdateBody({ bio: "\ufeffHello\ufeff" });
    expect(r.errors.bio).toBeUndefined();
    expect(r.value.bio).toBe("Hello");
  });
});

describe("T-060 tester: joiner effect on scripts and emoji (Jimmy 2026-10-21: joiners allowed)", () => {
  it("allows joined emoji (woman cook), single emoji and skin-tone emoji", () => {
    expect(hasUnsafeText("👩‍🍳")).toBe(false);
    expect(hasUnsafeText("👩🍳")).toBe(false);
    expect(hasUnsafeText("👩🏽")).toBe(false);
  });
  it("allows Persian text that needs ZWNJ (می‌خواهم) and Hindi with ZWJ", () => {
    expect(hasUnsafeText("می‌خواهم")).toBe(false);
    expect(hasUnsafeText("क्‍ष")).toBe(false);
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

describe("T-060 round 1: admin kitchen reviewedAddress is checked (F4)", () => {
  const review = (line: string, city: string) =>
    parseKitchenReview({
      decision: "approve",
      reviewedPhotoPaths: [],
      reviewedAddress: { line, city, postalCode: "L5B 1A1" },
    });
  it.each(CHARS)("U+%s in line or city is 422 on its own key", (_n, c) => {
    for (const [line, city, key] of [
      [mid(c), "Mississauga", "reviewedAddress.line"],
      ["1 Main St", mid(c), "reviewedAddress.city"],
    ]) {
      try {
        review(line, city);
        throw new Error("not refused");
      } catch (e) {
        expect(failFields(e)[key]).toBe(
          "Remove control or invalid characters.",
        );
      }
    }
  });
  it("clean text passes", () => {
    expect(review("1 Main St", "Mississauga").reviewedAddress?.line).toBe(
      "1 Main St",
    );
  });
});

describe("T-060 round 1: message wording (F2)", () => {
  const std = "Remove control or invalid characters.";
  it("bio and chef kitchen address give the standard message for invisible text", () => {
    expect(parseUpdateBody({ bio: "a​b" }).errors.bio).toBe(std);
    const e = parseUpdateBody({
      kitchenAddress: { line: "a​b", city: "x‮y", postalCode: "L5B1A1" },
    }).errors;
    expect(e["kitchenAddress.line"]).toBe(std);
    expect(e["kitchenAddress.city"]).toBe(std);
  });
  it("length errors keep their own message", () => {
    const e = parseUpdateBody({
      kitchenAddress: { line: "", city: "x".repeat(81), postalCode: "L5B1A1" },
    }).errors;
    expect(e["kitchenAddress.line"]).toBe("Enter 1 to 120 characters.");
    expect(e["kitchenAddress.city"]).toBe("Enter 1 to 80 characters.");
  });
});

describe("T-060 round 1: joiners allowed in every family (Jimmy 2026-10-21)", () => {
  for (const [family, run] of Object.entries(FIELD_FAMILIES))
    it.each([
      ["200C", "‌"],
      ["200D", "‍"],
    ])(`${family}: U+%s passes`, (_n, c) => {
      expect(run(mid(c))).toEqual([]);
    });
});

describe("T-060 round 1 re-check: wording by family (contract v1.20)", () => {
  const std = "Remove control or invalid characters.";
  const bad = "a​b";
  const dish = (o: Record<string, unknown>) =>
    parseDishBody(
      { name: "Pho", cuisine: "Thai", cookMinutes: 30, ...o },
      "create",
    ).errors;
  it("dish name and cuisine use the standard message; description keeps the older one", () => {
    expect(dish({ name: bad }).name).toBe(std);
    expect(dish({ cuisine: bad }).cuisine).toBe(std);
    expect(dish({ description: bad }).description).toBe(
      "Use plain text. Control characters are not allowed.",
    );
  });
  it("booking, report, decision, message and review fields use the standard message", () => {
    const b = parseBookingBody(
      {
        chefId: ID,
        locationType: "customer_home",
        address: { line: bad, city: bad, postalCode: "L5B1A1" },
      },
      "estimate",
    ).errors;
    expect(b["address.line"]).toBe(std);
    expect(b["address.city"]).toBe(std);
    const r = parseReportBody({ clientId: ID, description: bad });
    expect(!r.ok && r.fields.description).toBe(std);
    const d = parseDecisionBody({ note: bad }, "none");
    expect(!d.ok && d.fields.note).toBe(std);
  });
  it("joiners are stripped by the address key and contact filter, everywhere the fold applies", () => {
    for (const j of ["‌", "‍"]) {
      expect(addressKey(`10${j}0 Main St`, "L5B 1A1")).toBe(
        addressKey("100 Main St", "L5B 1A1"),
      );
      expect(normalizeAddressLine(`王${j}小明路`)).toBe(
        normalizeAddressLine("王小明路"),
      );
      expect(findContactDetails(`4${j}16 555 01${j}99`)).toBe("phone");
      expect(findContactDetails(`a${j}@b.com`)).toBe("email");
    }
  });
  it("U+FEFF mid-text stays refused; at the edge it is trimmed (bio included)", () => {
    expect(hasUnsafeText("a﻿b")).toBe(true);
    expect(parseUpdateBody({ bio: "a﻿b" }).errors.bio).toBe(std);
    expect(parseUpdateBody({ bio: "﻿ab" }).value.bio).toBe("ab");
  });
  it("F7 (changed by T-093): edge joiners kept in free text, and a joiner-only dish name is refused", () => {
    expect(parseCancelReason({ reason: "‍abc" })).toEqual({ value: "‍abc" });
    expect(
      parseDishBody({ name: "‍", cuisine: "Thai", cookMinutes: 30 }, "create")
        .errors.name,
    ).toBe("Enter at least one visible character.");
  });
});
