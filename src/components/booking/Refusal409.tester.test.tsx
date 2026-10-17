// @vitest-environment jsdom
// T-080 Tester gap tests: (1) the declared gap, a 409 on a receipt answer that leaves the booking
// status unchanged; (2) a slow older refetch must not overwrite a newer one. Bookings come from the
// MOCK seed (lessons-learned section 3).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingDetail } from "@/lib/api/types";
import {
  apiError,
  callsTo,
  harness,
  json,
  routes,
  seededBooking,
  seededReceipts,
  type Harness,
} from "@/components/booking/testkit";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

import { BookingDetailView } from "@/components/booking/BookingDetailView";
import { ChefBookingView } from "@/components/booking/ChefBookingView";

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

const listFor = (b: BookingDetail) => ({
  bookingId: b.id,
  groceryOption: b.groceryOption,
  locationType: b.locationType,
  currency: "CAD",
  plan: {
    buyer: b.groceryOption === "chef_shops" ? "chef" : "customer",
    deliverTo: b.locationType,
    customerDeliversToChef: false,
    receiptRequired: b.groceryOption === "chef_shops",
    note: "x",
  },
  days: [],
  estimatedCostCents: 0,
});
const gets = (b: BookingDetail, tail = "") =>
  callsTo(h.fetchMock, `/api/bookings/${b.id}${tail}`).filter(
    (c) => c[1] === "GET",
  ).length;

describe("T-080 declared gap: receipt 409 with an unchanged booking status", () => {
  it("shows the one page alert with focus; the receipts list is NOT refetched (known gap, see handoff)", async () => {
    const b = seededBooking(9106, "customer");
    const { filePath: _f, ...receipt } = seededReceipts()[b.id][0];
    void _f;
    routes(h.fetchMock, {
      [`GET /api/bookings/${b.id}`]: json(200, b),
      [`GET /api/bookings/${b.id}/shopping-list`]: json(200, listFor(b)),
      [`GET /api/bookings/${b.id}/receipts`]: json(200, {
        bookingId: b.id,
        groceryOption: b.groceryOption,
        estimatedIngredientsCents: b.estimate.ingredientsCents,
        currency: "CAD",
        items: [receipt],
      }),
      [`POST /api/bookings/${b.id}/receipts/${receipt.id}/respond`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        { reason: "receipt_confirmed" },
      ),
    });
    await h.mount(<BookingDetailView id={b.id} />);
    const receiptGetsBefore = gets(b, "/receipts");
    await h.click(h.button("Confirm this amount"));
    const alert = h.q("refusal");
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent).toMatch(/already confirmed/i);
    expect(document.activeElement).toBe(alert);
    expect(h.qa("refusal")).toHaveLength(1);
    expect(gets(b)).toBe(2); // the booking itself was refetched once
    // Gap: status unchanged => GroceriesSection does not reload, the answer buttons stay.
    expect(gets(b, "/receipts")).toBe(receiptGetsBefore);
    expect(h.button("Confirm this amount")).not.toBeNull();
  });
});

describe("T-080 race: an older slow refetch never overwrites a newer one", () => {
  it("the page ends on the newest booking state", async () => {
    const b = seededBooking(9105, "chef");
    const confirmed: BookingDetail = {
      ...b,
      days: b.days.map((d) => ({
        ...d,
        pickedUpAt: d.cookedAt ? "2026-10-20T20:00:00.000Z" : null,
      })),
    };
    let release: (r: Response) => void = () => {};
    let getCount = 0;
    const ok = (x: unknown) =>
      new Response(JSON.stringify(x), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    routes(h.fetchMock, {
      [`GET /api/bookings/${b.id}`]: () => {
        getCount++;
        if (getCount === 1) return ok(b); // first load
        if (getCount === 2)
          // older refetch: slow, and answers the OLD state
          return new Promise<Response>((res) => (release = res));
        return ok(confirmed); // newer refetch
      },
      [`GET /api/bookings/${b.id}/shopping-list`]: json(200, listFor(b)),
      [`GET /api/bookings/${b.id}/receipts`]: json(200, {
        bookingId: b.id,
        groceryOption: b.groceryOption,
        estimatedIngredientsCents: 0,
        currency: "CAD",
        items: [],
      }),
      [`POST /api/bookings/${b.id}/pickup/missed`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        { reason: "pickup_confirmed" },
      ),
    });
    await h.mount(<ChefBookingView id={b.id} />);
    await h.click(h.button("Mark pickup missed"));
    await h.click(h.button("Yes, mark pickup missed")); // refusal 1, refetch pending
    expect(getCount).toBe(2);
    await h.click(h.button("Yes, mark pickup missed")); // refusal 2, refetch answers newest
    expect(getCount).toBe(3);
    expect(h.q("missed-pickup")).toBeNull();
    release(ok(b)); // the old reply arrives last
    await h.flush();
    expect(h.q("missed-pickup")).toBeNull(); // still the newer state
    expect(h.qa("refusal")).toHaveLength(1);
  });
});
