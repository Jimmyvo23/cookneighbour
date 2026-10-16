// @vitest-environment jsdom
// T-077 Tester additions: stale customer pages (cancel, propose) get the neutral words from a 409
// `frozen`; a frozen chef page still shows days that were already cooked, with no way to redo them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingDetail } from "@/lib/api/types";
import { CHANGE_REFUSALS } from "@/lib/domain/bookingChanges";
import {
  apiError,
  harness,
  json,
  routes,
  seededBooking,
  seededReceipts,
  type Harness,
} from "@/components/booking/testkit";
import { ChefBookingView } from "@/components/booking/ChefBookingView";
import { BookingDetailView } from "@/components/booking/BookingDetailView";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

const base = (b: BookingDetail) => ({
  [`GET /api/bookings/${b.id}`]: json(200, b),
  [`GET /api/bookings/${b.id}/shopping-list`]: json(200, {
    bookingId: b.id,
    groceryOption: b.groceryOption,
    locationType: b.locationType,
    currency: "CAD",
    plan: {
      buyer: "customer",
      deliverTo: b.locationType,
      customerDeliversToChef: false,
      receiptRequired: false,
      note: "x",
    },
    days: [],
    estimatedCostCents: 0,
  }),
  [`GET /api/bookings/${b.id}/receipts`]: json(200, {
    bookingId: b.id,
    groceryOption: b.groceryOption,
    estimatedIngredientsCents: b.estimate.ingredientsCents,
    currency: "CAD",
    items: seededReceipts()[b.id] ?? [],
  }),
});

describe("stale customer page", () => {
  it("cancel answered 409 frozen shows the neutral words, nothing about why", async () => {
    const b = seededBooking(9104, "customer", (x) => ({ ...x, frozen: false }));
    routes(h.fetchMock, {
      ...base(b),
      [`POST /api/bookings/${b.id}/cancel`]: apiError(
        409,
        "INVALID_STATE",
        CHANGE_REFUSALS.frozen,
        { reason: "frozen" },
      ),
    });
    await h.mount(<BookingDetailView id={b.id} />);
    await h.click(h.button("Cancel this booking"));
    await h.click(h.button("Yes, cancel this booking"));
    const alert = h.host.querySelector('[role="alert"]')?.textContent ?? "";
    expect(alert).toContain(CHANGE_REFUSALS.frozen);
    expect(alert).not.toMatch(/reject|flag|report/i);
  });

  it("propose answered 409 frozen shows the neutral words", async () => {
    const b = seededBooking(9103, "customer", (x) => ({
      ...x,
      frozen: false,
      days: x.days.map((d) => ({ ...d, pickups: [] })),
    }));
    routes(h.fetchMock, {
      ...base(b),
      [`POST /api/bookings/${b.id}/days/1/pickup/propose`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        { reason: "frozen" },
      ),
    });
    await h.mount(<BookingDetailView id={b.id} />);
    const field = h.host.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLInputElement;
    await h.type(field, `${b.days[0].pickupDeadlineDate}T15:30`);
    await h.click(h.button("Propose this time"));
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain(
      CHANGE_REFUSALS.frozen,
    );
  });
});

describe("frozen chef page keeps cooked days", () => {
  it("shows Cooked on for a cooked day and no Mark button for any day", async () => {
    const b = seededBooking(9104, "chef", (x) => ({
      ...x,
      frozen: true,
      days: x.days.map((d, i) => ({
        ...d,
        cookedAt: i === 0 ? "2026-10-14T18:00:00.000Z" : null,
      })),
    }));
    routes(h.fetchMock, base(b));
    await h.mount(<ChefBookingView id={b.id} />);
    expect(h.q("frozen-notice")).not.toBeNull();
    expect(h.host.textContent).toContain("Cooked on");
    expect(h.button(/Mark day/)).toBeNull();
    expect(h.button("Visit done")).toBeNull();
  });
});
