// T-093 and T-095 Tester checks: mixed invisible values, scope (free text unchanged), scripts.
import { describe, expect, it } from "vitest";
import { Fields } from "@/lib/api/validate";
import { displayNameProblem, validateAddress } from "@/lib/validation/auth";
import { parseDishBody } from "./dishes";
import { parseUpdateBody } from "./chef-application";
import { parseMessageBody } from "./messages";
import { parseReviewBody, parseReportBody } from "./reviews";
import { parseReviewForm, parseReportForm } from "@/lib/engagement/rules";
import { addressKey } from "./address";
import { hasNoVisibleText, NO_VISIBLE_TEXT } from "./text-fold";

const ZWJ = "‍";
const ZWNJ = "‌";
const UUID = "123e4567-e89b-42d3-a456-426614174000";

// Refused by the older T-060 check (bidi, ZWSP, word joiner, mid-text BOM) or by T-093.
const MIXED = [
  `${ZWJ}​${ZWNJ}`,
  `${ZWJ}⁠`,
  `${ZWNJ}﻿${ZWJ}`,
  `‮${ZWJ}`,
  `⁦${ZWNJ}⁩`,
  ` ${ZWJ}　${ZWNJ} `,
  "́",
  "́̂",
];

describe("mixed invisible-only values are refused with the same answer on server and browser", () => {
  it.each(MIXED)("%j", (t) => {
    const f = new Fields();
    f.visibleText({ k: t }, "k", 1, 80);
    expect(f.errors.k).toBeTruthy();
    expect(displayNameProblem(t)).toBeTruthy();
    const a = validateAddress({ line: t, city: t, postalCode: "L5B 1A1" });
    expect(Boolean(a.line)).toBe(true);
    expect(Boolean(a.city)).toBe(true);
    const d = parseDishBody(
      { name: t, cuisine: "x", cookMinutes: 30 },
      "create",
    );
    expect(d.errors.name).toBeTruthy();
    const k = parseUpdateBody({
      kitchenAddress: { line: t, city: t, postalCode: "L5B 1A1" },
    }).errors;
    expect(k["kitchenAddress.line"]).toBeTruthy();
    expect(k["kitchenAddress.city"]).toBeTruthy();
  });
});

describe("visible text in other scripts, with joiners inside, passes everywhere", () => {
  const OK = [
    "Nguyễn Thị Hương",
    "Phở bò Đà Lạt",
    "王小明",
    "東京都",
    "한국어",
    "ひらがな",
    "علي محمد",
    "می‌خواهم",
    "नमस्ते",
    "क्‍ष",
    "ไทย",
    "עברית",
    "Ελληνικά",
    "Привет",
    "👨‍👩‍👧",
    "👩🏽‍🍳",
    "🏳️‍🌈",
  ];
  it.each(OK)("%j", (t) => {
    expect(hasNoVisibleText(t)).toBe(false);
    const f = new Fields();
    f.visibleText({ k: t }, "k", 1, 80);
    expect(f.errors.k).toBeUndefined();
    expect(displayNameProblem(t)).toBeNull();
    expect(
      validateAddress({ line: t, city: t, postalCode: "L5B 1A1" }),
    ).toEqual({});
    expect(
      parseDishBody({ name: t, cuisine: "x", cookMinutes: 30 }, "create").errors
        .name,
    ).toBeUndefined();
    const k = parseUpdateBody({
      kitchenAddress: { line: t, city: t, postalCode: "L5B 1A1" },
    }).errors;
    expect(k["kitchenAddress.line"]).toBeUndefined();
    expect(k["kitchenAddress.city"]).toBeUndefined();
  });
});

describe("error texts", () => {
  it("joiner-only gets the new text; spaces-only keeps the length text", () => {
    const f = new Fields();
    f.visibleText({ a: ZWJ, b: "   " }, "a", 1, 80);
    f.visibleText({ a: ZWJ, b: "   " }, "b", 1, 80);
    expect(f.errors.a).toBe(NO_VISIBLE_TEXT);
    expect(f.errors.b).toBe("Enter 1 to 80 characters.");
    expect(NO_VISIBLE_TEXT).toBe("Enter at least one visible character.");
  });
  it("a too-long joiner-only value keeps the length message", () => {
    const f = new Fields();
    f.visibleText({ a: ZWJ.repeat(90) }, "a", 1, 80);
    expect(f.errors.a).toBe("Enter 1 to 80 characters.");
  });
});

describe("scope: bio, notes, chat and reviews are unchanged (joiner-only text still accepted)", () => {
  it("bio", () => {
    const { errors, value } = parseUpdateBody({ bio: `${ZWJ}${ZWNJ}` });
    expect(errors.bio).toBeUndefined();
    expect(value.bio).toBe(`${ZWJ}${ZWNJ}`);
  });
  it("chat message", () => {
    const r = parseMessageBody({ clientId: UUID, body: `${ZWJ}${ZWNJ}` });
    expect(r.ok).toBe(true);
  });
  it("review comment (server and browser)", () => {
    const r = parseReviewBody({ rating: 5, comment: ZWJ });
    expect(r.ok).toBe(true);
    expect(parseReviewForm({ rating: 5, comment: ZWJ }).ok).toBe(true);
  });
  it("report description (server and browser)", () => {
    expect(
      parseReportBody({ clientId: UUID, category: "other", description: ZWJ })
        .ok,
    ).toBe(true);
    expect(
      parseReportForm({ clientId: UUID, category: "other", description: ZWJ })
        .ok,
    ).toBe(true);
  });
});

describe("T-095 addressKey", () => {
  const pc = "L5B 1A1";
  it("look-alike letters give the same key", () => {
    expect(addressKey("ℌigh Street 5", pc)).toBe(
      addressKey("High Street 5", pc),
    );
    expect(addressKey("Ｈigh Street 5", pc)).toBe(
      addressKey("High Street 5", pc),
    );
    expect(addressKey("𝐇igh Street 5", pc)).toBe(
      addressKey("High Street 5", pc),
    );
    expect(addressKey("Hi‍gh Street 5", pc)).toBe(
      addressKey("High Street 5", pc),
    );
  });
  it("ASCII keys are unchanged", () => {
    expect(addressKey("123 Main Street, Unit #5", pc)).toBe(
      "123 main st unit 5|L5B1A1",
    );
    expect(addressKey("45 Queen Street West", pc)).toBe("45 queen st w|L5B1A1");
  });
  it("non-Latin lines never collapse to an empty key", () => {
    for (const l of ["王小明路 5", "شارع الملك 3", "नमस्ते मार्ग 2"])
      expect(addressKey(l, pc).split("|")[0]).not.toBe("");
  });
});
