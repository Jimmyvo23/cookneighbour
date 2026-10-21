// T-060: invisible-character refusal and the fold used before address keys and the contact filter.
import { describe, expect, it } from "vitest";
import { Fields } from "@/lib/api/validate";
import { displayNameProblem } from "@/lib/validation/auth";
import { intakeProblems } from "@/lib/booking/form";
import { parseMessageBody } from "./messages";
import { parseReviewBody } from "./reviews";
import { hasUnsafeText } from "./text-safety";
import { addressKey, normalizeAddressLine } from "./address";
import { findContactDetails } from "./contactDetails";
import { foldText, hasInvisibleText } from "./text-fold";

const BIDI = ["‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩"];
const ZERO_WIDTH = ["​", "‌", "‍", "⁠", "﻿"];
const INVISIBLE = [...BIDI, ...ZERO_WIDTH];

describe("hasInvisibleText / hasUnsafeText", () => {
  it.each(INVISIBLE)("refuses U+%s anywhere in the text", (ch) => {
    expect(hasInvisibleText(`ab${ch}cd`)).toBe(true);
    expect(hasUnsafeText(`ab${ch}cd`)).toBe(true);
    expect(hasUnsafeText(`ab${ch}cd`, true)).toBe(true);
  });
  it("refuses joined emoji (they contain U+200D, Jimmy's D-125 list)", () => {
    expect(hasUnsafeText("Zoë 👩\u200d🍳")).toBe(true);
  });
  it("accepts normal text, emoji, accents and non-Latin scripts", () => {
    for (const ok of [
      "Édouard",
      "Nguyễn Văn Đạt",
      "王小明",
      "علي",
      "Mom's pho 🍜",
    ])
      expect(hasUnsafeText(ok)).toBe(false);
  });
});

describe("client and server agree on invisible characters (T-060)", () => {
  const cases = [...INVISIBLE.map((c) => `Ann${c}Lee`), "Ann Lee", "Édouard"];
  it.each(cases)("%j", (text) => {
    const refused = hasInvisibleText(text);
    // server: shared text validator (display name, address, reasons)
    const f = new Fields();
    f.text({ k: text }, "k", 1, 80);
    expect(!!f.errors.k).toBe(refused);
    // client: display name form check
    expect(displayNameProblem(text) !== null).toBe(refused);
    // client: intake notes (multi-line text)
    const e = intakeProblems({
      noAllergies: false,
      allergens: [],
      allergyNotes: text,
      noDietaryNeeds: false,
      dietaryNotes: text,
    });
    expect(!!e["intake.allergies"]).toBe(refused);
    expect(!!e["intake.dietaryNotes"]).toBe(refused);
    // server: chat and reviews name their field
    const m = parseMessageBody({
      clientId: "11111111-1111-4111-8111-111111111111",
      body: text,
    });
    expect(!m.ok).toBe(refused);
    if (!m.ok) expect(Object.keys(m.fields)).toEqual(["body"]);
    const r = parseReviewBody({ rating: 5, comment: text });
    expect(!r.ok).toBe(refused);
    if (!r.ok) expect(Object.keys(r.fields)).toEqual(["comment"]);
  });
});

describe("foldText", () => {
  it("folds full-width forms, accents and invisible characters", () => {
    expect(foldText("１００ Édouard​ St")).toBe("100 Edouard St");
  });
  it("keeps non-Latin scripts", () => {
    expect(foldText("王小明路")).toBe("王小明路");
    expect(foldText("शिवाजी मार्ग")).toBe("शिवाजी मार्ग");
  });
  it("strips Vietnamese tones and maps đ/Đ to d/D", () => {
    expect(foldText("Nguyễn Đạt đường")).toBe("Nguyen Dat duong");
  });
});

describe("address key fold (T51-B1, Q-T51-2)", () => {
  it("full-width digits equal ASCII digits", () => {
    expect(addressKey("１００ Fictional Street", "L5B 1A1")).toBe(
      addressKey("100 Fictional Street", "L5B 1A1"),
    );
  });
  it("accents and zero-width spaces do not change the key", () => {
    expect(addressKey("5 Rue Édouard", "L5B 1A1")).toBe(
      addressKey("5 Rue Edouard", "L5B 1A1"),
    );
    expect(addressKey("5 Rue​ Edouard", "L5B 1A1")).toBe(
      addressKey("5 Rue Edouard", "L5B 1A1"),
    );
    expect(addressKey("1​00 Main St", "L5B 1A1")).toBe(
      addressKey("100 Main St", "L5B 1A1"),
    );
  });
  it("ASCII keys are unchanged (pinned)", () => {
    expect(addressKey("100 Fictional Street, Unit #5", "l5b 1a1")).toBe(
      "100 fictional st unit 5|L5B1A1",
    );
  });
  it("non-Latin street lines stay non-empty and distinct", () => {
    const a = normalizeAddressLine("王小明路 12");
    const b = normalizeAddressLine("李大華街 12");
    expect(a).toBe("王小明路 12");
    expect(a).not.toBe(b);
    expect(normalizeAddressLine("شارع النيل 5")).not.toBe(
      normalizeAddressLine("شارع الورد 5"),
    );
    expect(normalizeAddressLine("Đường Lê Lợi 3")).toBe("duong le loi 3");
    expect(normalizeAddressLine("Đường Lê Lợi 3")).not.toBe(
      normalizeAddressLine("Đường Hai Bà Trưng 3"),
    );
  });
});

describe("contact filter fold (Q-T51-1)", () => {
  it("catches a full-width digit phone number", () => {
    expect(findContactDetails("call ４１６ ５５５ ０１９９")).toBe("phone");
  });
  it("catches a phone number split by zero-width characters", () => {
    expect(findContactDetails("416​555​0199")).toBe("phone");
  });
  it("catches an en-dash or minus-sign separated phone number", () => {
    expect(findContactDetails("416–555–0199")).toBe("phone");
    expect(findContactDetails("416−555−0199")).toBe("phone");
  });
  it("catches a full-width at sign email", () => {
    expect(findContactDetails("me＠example.com")).toBe("email");
  });
  it("still lets plain text and dates through", () => {
    expect(findContactDetails("order 20261031 is fine")).toBeNull();
    expect(findContactDetails("Édouard likes pho")).toBeNull();
  });
});
