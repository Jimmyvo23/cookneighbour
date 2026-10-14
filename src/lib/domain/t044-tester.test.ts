// T-044 Tester: A-15 receipt boundaries and rounding, no-markup reimbursement, shopping list vs the
// estimate, free-trial per-day labour wording, path rules, and contract/type agreement.
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RECEIPT_TOLERANCE_MIN_CENTS,
  RECEIPT_TOLERANCE_PERCENT,
} from "./config.ts";
import { divRoundHalfUp } from "./money.ts";
import { estimateBooking } from "./pricing.ts";
import { checkReceipt } from "./receipt.ts";
import {
  buildShoppingList,
  groceryPlan,
  parseReceiptAnswer,
  parseReceiptBody,
  receiptPathError,
  RECEIPT_MAX_CENTS,
} from "./groceries.ts";

const B = "11111111-1111-4111-8111-111111111111";
const tol = (est: number) =>
  Math.max(
    divRoundHalfUp(est * RECEIPT_TOLERANCE_PERCENT * 100, 10000),
    RECEIPT_TOLERANCE_MIN_CENTS,
  );

describe("A-15 boundaries: more than max(15%, $5.00), both directions", () => {
  it("config is the assumed 15% and $5.00", () => {
    expect(RECEIPT_TOLERANCE_PERCENT).toBe(15);
    expect(RECEIPT_TOLERANCE_MIN_CENTS).toBe(500);
  });
  // [estimate, expected tolerance]
  it.each([
    [0, 500],
    [1, 500],
    [2500, 500], // 15% = 375 < floor
    [3333, 500], // 499.95 -> 500
    [3334, 500],
    [3349, 502], // 502.35 -> 502
    [3350, 503], // 502.5 rounds half up -> 503
    [3351, 503], // 502.65 -> 503
    [8000, 1200],
    [10001, 1500], // 1500.15 -> 1500
    [10003, 1500], // 1500.45 -> 1500
    [10004, 1501], // 1500.6 -> 1501
    [200000, 30000],
  ])(
    "estimate %i has tolerance %i, exactly at it passes, one cent over flags (above and below)",
    (est, t) => {
      expect(tol(est)).toBe(t);
      expect(checkReceipt(est, est).toleranceCents).toBe(t);
      expect(checkReceipt(est, est + t).mismatch).toBe(false);
      expect(checkReceipt(est, est + t + 1).mismatch).toBe(true);
      if (est - t >= 0) {
        expect(checkReceipt(est, est - t).mismatch).toBe(false);
      }
      if (est - t - 1 >= 0) {
        const lo = checkReceipt(est, est - t - 1);
        expect(lo.mismatch).toBe(true);
        expect(lo.differenceCents).toBe(-t - 1);
      }
    },
  );
  it("exactly $5.00 away on a small estimate is fine, one cent more is flagged", () => {
    expect(checkReceipt(1000, 1500).mismatch).toBe(false);
    expect(checkReceipt(1000, 500).mismatch).toBe(false);
    expect(checkReceipt(1000, 1501).mismatch).toBe(true);
    expect(checkReceipt(1000, 499).mismatch).toBe(true);
  });
  it("a receipt far below a small estimate is clamped by cents, never negative", () => {
    const r = checkReceipt(400, 1);
    expect(r.differenceCents).toBe(-399);
    expect(r.mismatch).toBe(false);
  });
  it("the result is only integers", () => {
    for (const est of [1, 999, 3350, 12345, 99999]) {
      const r = checkReceipt(est, est + 777);
      expect(Number.isInteger(r.differenceCents)).toBe(true);
      expect(Number.isInteger(r.toleranceCents)).toBe(true);
    }
  });
  it("is computed against the estimate it is given (the immutable snapshot), not anything else", () => {
    // Same receipt, two different snapshots, two different answers: the snapshot is the only input.
    expect(checkReceipt(2500, 3200).mismatch).toBe(true);
    expect(checkReceipt(3500, 3200).mismatch).toBe(false);
  });
});

describe("no markup, MOCK", () => {
  it("option B note says at cost, no markup and MOCK; nothing for option A", () => {
    const b = groceryPlan("chef_shops", "chef_home");
    expect(b.note).toMatch(/no markup/i);
    expect(b.note).toMatch(/MOCK/);
    expect(b.customerDeliversToChef).toBe(false);
    const a = groceryPlan("customer_buys", "chef_home");
    expect(a.receiptRequired).toBe(false);
    expect(a.note).toMatch(/chef's home/);
  });
  it("estimate: option B adds no markup to ingredients (ingredients are the dish sum)", () => {
    const dishes = [
      { cookMinutes: 60, ingredientCostCents: 1234, quantity: 3 },
    ];
    const common = {
      hourlyRateCents: 3000,
      locationType: "chef_home" as const,
      days: [{ dishes }],
      isFreeTrial: false,
    };
    const e = estimateBooking(common);
    expect(e.ingredientsCents).toBe(1234 * 3);
  });
});

describe("shopping list matches the estimate", () => {
  it("multi-day, multi-quantity list equals estimate ingredients per day and in total", () => {
    const days = [
      [
        { cookMinutes: 45, ingredientCostCents: 1999, quantity: 2 },
        { cookMinutes: 30, ingredientCostCents: 1, quantity: 7 },
      ],
      [{ cookMinutes: 90, ingredientCostCents: 4321, quantity: 1 }],
      [],
    ];
    const est = estimateBooking({
      hourlyRateCents: 2500,
      locationType: "chef_home",
      days: days.map((dishes) => ({ dishes })),
      isFreeTrial: false,
    });
    const list = buildShoppingList(
      days.map((ds, i) => ({
        dayNumber: i + 1,
        date: `2026-10-2${i}`,
        dishes: ds.map((d, j) => ({
          name: `d${i}${j}`,
          quantity: d.quantity,
          servings: 4,
          ingredientCostCents: d.ingredientCostCents,
          allergens: [],
        })),
      })),
    );
    expect(list.estimatedCostCents).toBe(est.ingredientsCents);
    list.days.forEach((d, i) =>
      expect(d.estimatedCostCents).toBe(est.days[i].ingredientsCents),
    );
  });
});

describe("days[].labourCents is after the free-trial waiver (carry-in from T-043)", () => {
  const base = {
    hourlyRateCents: 3000,
    locationType: "chef_home" as const,
    days: [
      { dishes: [{ cookMinutes: 120, ingredientCostCents: 0, quantity: 1 }] },
      { dishes: [{ cookMinutes: 60, ingredientCostCents: 0, quantity: 1 }] },
    ],
  };
  it("is 0 per day under the trial; the waived amount is only in the totals", () => {
    const e = estimateBooking({ ...base, isFreeTrial: true });
    expect(e.days.map((d) => d.labourCents)).toEqual([0, 0]);
    expect(e.labourCents).toBe(0);
    expect(e.freeTrialWaivedCents).toBe(9000);
    expect(e.labourBeforeWaiverCents).toBe(9000);
  });
  it("is the real labour without the trial", () => {
    const e = estimateBooking({ ...base, isFreeTrial: false });
    expect(e.days.map((d) => d.labourCents)).toEqual([6000, 3000]);
    expect(e.freeTrialWaivedCents).toBe(0);
  });
});

describe("receipt path and body rules (extra cases)", () => {
  it.each([
    `${B}/a..png`.replace("a..png", "../a.png"),
    `${B}/./a.png`,
    `${B}//a.png`,
    `/${B}/a.png`,
    `${B}/a.png/`,
    `${B}/a%2e%2e.png`,
    `${B}/a\nb.png`,
    `${B}/a‮.png`,
    `${B}/é.png`,
    `${B}/${"a".repeat(101)}.png`,
    `${B}/a.png.exe`,
    `${B}/a.svg`,
    `${B}/a.html`,
    `${B}/.png`,
    `${B.toUpperCase()}/a.png`.replace(/^[^/]+/, "AAAA"),
    `${B}\\..\\a.png`,
  ])("refuses %j", (p) => {
    expect(receiptPathError(B, p)).not.toBeNull();
  });
  it.each([`${B}/r.JPG`, `${B}/r.jpeg`, `${B}/r_1-2.pdf`, `${B}/a.b.png`])(
    "accepts %j",
    (p) => expect(receiptPathError(B, p)).toBeNull(),
  );
  it("amount bounds are 1 and the maximum, whole cents only", () => {
    const ok = (a: number) =>
      "value" in
      parseReceiptBody(B, { filePath: `${B}/a.png`, amountCents: a });
    expect(ok(1)).toBe(true);
    expect(ok(RECEIPT_MAX_CENTS)).toBe(true);
    expect(ok(RECEIPT_MAX_CENTS + 1)).toBe(false);
    expect(ok(Infinity)).toBe(false);
    expect(ok(2 ** 53)).toBe(false);
    expect(ok(0.5)).toBe(false);
  });
  it("answer: dispute note is trimmed, 3 and 300 are accepted, 2 and 301 are not", () => {
    const d = (n: string) => parseReceiptAnswer({ action: "dispute", note: n });
    expect("value" in d("abc")).toBe(true);
    expect("value" in d("x".repeat(300))).toBe(true);
    expect("value" in d("ab ")).toBe(false);
    expect("value" in d("x".repeat(301))).toBe(false);
    expect("value" in d("   ")).toBe(false);
    expect(
      "fields" in parseReceiptAnswer({ action: "confirm", note: "x" }),
    ).toBe(true);
    expect("value" in parseReceiptAnswer({ action: "confirm", note: "" })).toBe(
      true,
    );
  });
});

describe("contract v1.6 and types agree with the code", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const contract = read("docs/api-contract.md");
  const types = read("src/lib/api/types.ts");
  it("routes exist with the documented methods", () => {
    const files: [string, string[]][] = [
      ["src/app/api/bookings/[id]/shopping-list/route.ts", ["GET"]],
      ["src/app/api/bookings/[id]/receipts/route.ts", ["GET", "POST"]],
      [
        "src/app/api/bookings/[id]/receipts/[receiptId]/respond/route.ts",
        ["POST"],
      ],
    ];
    for (const [f, methods] of files) {
      expect(existsSync(f), f).toBe(true);
      const src = read(f);
      for (const m of methods)
        expect(src, `${f} ${m}`).toMatch(
          new RegExp(`export (async )?(function|const) ${m}\\b`),
        );
      for (const m of ["PUT", "PATCH", "DELETE"].filter(
        (x) => !methods.includes(x),
      ))
        expect(src).not.toMatch(
          new RegExp(`export (async )?(function|const) ${m}\\b`),
        );
    }
    expect(contract).toContain("### GET /api/bookings/:id/shopping-list");
    expect(contract).toContain("### GET /api/bookings/:id/receipts");
    expect(contract).toContain("### POST /api/bookings/:id/receipts\n");
    expect(contract).toContain(
      "### POST /api/bookings/:id/receipts/:receiptId/respond",
    );
  });
  it("types named in the contract are exported", () => {
    for (const t of [
      "ShoppingListResponse",
      "ReceiptView",
      "ReceiptList",
      "SubmitReceiptRequest",
      "AnswerReceiptRequest",
    ])
      expect(types, t).toMatch(new RegExp(`export (interface|type) ${t}\\b`));
  });
  it("every ReceiptView field named in the contract is in the type", () => {
    const m = contract.match(/- `ReceiptView` `\{([^}]*)\}`/);
    expect(m).not.toBeNull();
    const fields = m![1].split(",").map((s) => s.trim().split(":")[0]);
    const block = types.match(/export interface ReceiptView \{([\s\S]*?)\n\}/);
    expect(block).not.toBeNull();
    for (const f of fields)
      expect(block![1], f).toMatch(new RegExp(`\\b${f}\\??:`));
  });
  it("reason codes in the contract are all in RECEIPT_REFUSALS", async () => {
    const { RECEIPT_REFUSALS } = await import("./groceries.ts");
    for (const r of [
      "not_chef_shops",
      "wrong_status",
      "receipt_waiting",
      "receipt_confirmed",
      "path_used",
      "already_answered",
      "receipt_superseded",
    ]) {
      expect(contract, r).toContain(r);
      expect(RECEIPT_REFUSALS[r], r).toBeTruthy();
    }
  });
  it("the contract documents days[].labourCents after the waiver", () => {
    expect(contract).toMatch(
      /days\[\]\.labourCents` is the labour \*\*after\*\* the free-trial waiver/,
    );
  });
  it("the migration file named in the contract exists", () => {
    expect(
      existsSync("supabase/migrations/20261014100000_grocery_receipts.sql"),
    ).toBe(true);
  });
});
