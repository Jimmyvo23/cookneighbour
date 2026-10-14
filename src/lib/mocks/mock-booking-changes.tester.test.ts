// Tester additions for T-045 (WO-4b). Runs the real mock routes, which call the real domain
// functions (estimateBooking, checkReceipt, groceryPlan), against contract 7A/7B and D-29.
import { describe, expect, it } from "vitest";
import type {
  ApiError,
  BookingDetail,
  ReceiptView,
  ShoppingListResponse,
} from "@/lib/api/types";
import { addDays, torontoToday } from "@/lib/domain/dishes";
import { checkReceipt } from "@/lib/domain/receipt";
import {
  bookingRoutes,
  type BookingMockState,
  type BookingRouteResult,
} from "@/lib/mocks/mock-bookings";

const NOW = new Date();
const TODAY = torontoToday(NOW);
const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SEEDS = [9101, 9102, 9103, 9104, 9105, 9106].map(ID);
const [, , A03, A04, A05] = SEEDS;

const base = (role: "chef" | "customer"): BookingMockState => ({
  profile: {
    id: "mock-user-1",
    role,
    displayName: "Demo",
    country: "CA",
    currency: "CAD",
    language: "en",
  },
  phone: null,
  phoneVerified: true,
  address: null,
  bookings: [],
  hooks: {},
});

async function call(
  s: BookingMockState,
  method: string,
  path: string,
  body: unknown = {},
  now = NOW,
) {
  const r = bookingRoutes(method, path, body, s, now) as BookingRouteResult;
  expect(r, `${method} ${path} not routed`).toBeTruthy();
  const next = r.next ? ({ ...s, ...r.next } as BookingMockState) : s;
  const json = await r.res.json();
  return {
    s: next,
    status: r.res.status,
    json,
    error: (json as ApiError).error,
  };
}

describe("mock data matches the real domain functions (lessons 3, last row)", () => {
  it("every seeded shopping list totals the booking's estimated ingredients", async () => {
    let s = base("chef");
    for (const id of SEEDS) {
      const d = await call(s, "GET", `/api/bookings/${id}`);
      s = d.s;
      const detail = d.json as BookingDetail;
      const l = await call(s, "GET", `/api/bookings/${id}/shopping-list`);
      const list = l.json as ShoppingListResponse;
      expect(list.estimatedCostCents, id).toBe(
        detail.estimate.ingredientsCents,
      );
      expect(
        list.days.reduce((n, x) => n + x.estimatedCostCents, 0),
        id,
      ).toBe(list.estimatedCostCents);
      for (const day of list.days)
        for (const dish of day.dishes)
          expect(dish.lineCostCents).toBe(
            dish.ingredientCostCents * dish.quantity,
          );
      // 7B: no address or phone in the shopping list
      expect(JSON.stringify(list)).not.toMatch(/phone|address|\+1|@/i);
    }
  });

  it("the seeded receipts agree with checkReceipt", async () => {
    let s = base("chef");
    for (const id of SEEDS) {
      const r = await call(s, "GET", `/api/bookings/${id}/receipts`);
      s = r.s;
      for (const item of (r.json as { items: ReceiptView[] }).items) {
        const c = checkReceipt(
          item.estimatedIngredientsCents,
          item.amountCents,
        );
        expect(item.mismatchFlagged).toBe(c.mismatch);
        expect(item.differenceCents).toBe(c.differenceCents);
        expect(item.toleranceCents).toBe(c.toleranceCents);
      }
    }
  });
});

describe("receipt tolerance edge (contract 7B: exactly at the limit is not flagged)", () => {
  it("flags only an amount more than max(15%, $5) away, in either direction", async () => {
    let s = base("chef");
    const d = await call(s, "GET", `/api/bookings/${A04}`);
    s = d.s;
    const est = (d.json as BookingDetail).estimate.ingredientsCents;
    const tol = checkReceipt(est, est).toleranceCents;
    const cases: [number, boolean][] = [
      [est + tol, false],
      [est + tol + 1, true],
      [est - tol, false],
      [est - tol - 1, true],
    ];
    let n = 0;
    for (const [amount, flagged] of cases) {
      // A fresh state each time: one current receipt per booking.
      const fresh = (await call(base("chef"), "GET", `/api/bookings/${A04}`)).s;
      const name = `${String(++n).repeat(8)}-1111-4111-8111-111111111111.png`;
      const r = await call(fresh, "POST", `/api/bookings/${A04}/receipts`, {
        filePath: `${A04}/${name}`,
        amountCents: amount,
      });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect((r.json as ReceiptView).mismatchFlagged, String(amount)).toBe(
        flagged,
      );
    }
  });
});

describe("D-29 missed pickup, end to end with real routes", () => {
  it("propose, decline, re-propose until the deadline, then the chef marks it missed", async () => {
    // Chef-side rows, then move the same row between the two views.
    const first = await call(base("chef"), "GET", "/api/bookings");
    let chefS = first.s;
    const rowOf = (s: BookingMockState, key: "bookings" | "chefBookings") =>
      (s[key] ?? []).find((r) => r.detail.id === A05)!;
    const row = rowOf(chefS, "chefBookings");
    const deadline = addDays(TODAY, 2);
    const clean = {
      ...row,
      detail: {
        ...row.detail,
        days: [
          { ...row.detail.days[0], pickupDeadlineDate: deadline, pickups: [] },
        ],
      },
    };
    let custS: BookingMockState = { ...base("customer"), bookings: [clean] };
    chefS = { ...chefS, chefBookings: [clean] };

    const soon = (h: number) =>
      new Date(NOW.getTime() + h * 3600000).toISOString();
    for (let round = 1; round <= 3; round++) {
      const p = await call(
        custS,
        "POST",
        `/api/bookings/${A05}/days/1/pickup/propose`,
        { proposedAt: soon(round) },
      );
      expect(p.status, JSON.stringify(p.json)).toBe(200);
      custS = p.s;
      // The chef sees the same row, then declines.
      chefS = { ...chefS, chefBookings: [rowOf(custS, "bookings")] };
      const dec = await call(
        chefS,
        "POST",
        `/api/bookings/${A05}/days/1/pickup/respond`,
        { accept: false },
      );
      expect(dec.status).toBe(200);
      chefS = dec.s;
      custS = { ...custS, bookings: [rowOf(chefS, "chefBookings")] };
    }
    const history = rowOf(custS, "bookings").detail.days[0].pickups;
    expect(history.map((h) => h.status)).toEqual([
      "declined",
      "declined",
      "declined",
    ]);

    // While the window is open the chef cannot mark it missed.
    const early = await call(
      chefS,
      "POST",
      `/api/bookings/${A05}/pickup/missed`,
      {},
      NOW,
    );
    expect(early.error.reason).toBe("pickup_window_open");

    // Past the deadline: no more proposals, and the chef can mark it missed.
    const later = new Date(NOW.getTime() + 4 * 86400000);
    const late = await call(
      custS,
      "POST",
      `/api/bookings/${A05}/days/1/pickup/propose`,
      { proposedAt: new Date(later.getTime() + 3600000).toISOString() },
      later,
    );
    expect(late.status).toBe(409);
    expect(late.error.reason).toBe("deadline_passed");
    const missed = await call(
      chefS,
      "POST",
      `/api/bookings/${A05}/pickup/missed`,
      {},
      later,
    );
    expect(missed.status, JSON.stringify(missed.json)).toBe(200);
    expect((missed.json as BookingDetail).status).toBe("no_show_customer");
  });

  it("a proposal after the end of the window is a 422 that carries error.latest", async () => {
    const chefS = (await call(base("chef"), "GET", "/api/bookings")).s;
    const row = chefS.chefBookings!.find((r) => r.detail.id === A03)!;
    const clean = {
      ...row,
      detail: {
        ...row.detail,
        days: [
          {
            ...row.detail.days[0],
            pickupDeadlineDate: addDays(TODAY, 1),
            pickups: [],
          },
        ],
      },
    };
    const custS: BookingMockState = { ...base("customer"), bookings: [clean] };
    const r = await call(
      custS,
      "POST",
      `/api/bookings/${A03}/days/1/pickup/propose`,
      { proposedAt: new Date(NOW.getTime() + 9 * 86400000).toISOString() },
    );
    expect(r.status).toBe(422);
    expect(r.error.latest).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
