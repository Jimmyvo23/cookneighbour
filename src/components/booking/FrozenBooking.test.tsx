// @vitest-environment jsdom
// T-077 (D-53, D-65, D-66): a frozen booking shows a neutral notice to both parties and offers no
// action except the customer's receipt answers. The notice never says why. A stale page that acts
// anyway gets the same words from a 409 `frozen`. Bookings come from the MOCK seed (testkit).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingDetail } from "@/lib/api/types";
import { addDays, torontoToday } from "@/lib/domain/dishes";
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

const shopping = (b: BookingDetail) => ({
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

async function open(
  b: BookingDetail,
  role: "chef" | "customer",
  extra: Record<string, Parameters<typeof routes>[1][string]> = {},
) {
  routes(h.fetchMock, {
    [`GET /api/bookings/${b.id}`]: json(200, b),
    [`GET /api/bookings/${b.id}/shopping-list`]: json(200, shopping(b)),
    [`GET /api/bookings/${b.id}/receipts`]: json(200, {
      bookingId: b.id,
      groceryOption: b.groceryOption,
      estimatedIngredientsCents: b.estimate.ingredientsCents,
      currency: "CAD",
      items: seededReceipts()[b.id] ?? [],
    }),
    ...extra,
  });
  await h.mount(
    role === "chef" ? (
      <ChefBookingView id={b.id} />
    ) : (
      <BookingDetailView id={b.id} />
    ),
  );
}

/** A chef's-home booking with no proposals, so the customer could propose a time. */
const noPickups = (frozen: boolean) => (b: BookingDetail) => ({
  ...b,
  frozen,
  days: b.days.map((d) => ({ ...d, pickups: [] })),
});

/** Every day yesterday and uncooked: the mark-cooked prompt and button would show. */
const pastUncooked = (frozen: boolean) => (b: BookingDetail) => ({
  ...b,
  frozen,
  days: b.days.map((d, i) => ({
    ...d,
    date: addDays(torontoToday(), -2 + i),
    cookedAt: null,
  })),
});

describe("chef side", () => {
  it("not frozen: prompt, mark-cooked button and end sections show (control)", async () => {
    await open(seededBooking(9104, "chef", pastUncooked(false)), "chef");
    expect(h.q("frozen-notice")).toBeNull();
    expect(h.q("mark-cooked-prompt")).not.toBeNull();
    expect(h.button(/Mark day 1 as cooked/)).not.toBeNull();
    expect(h.q("end-booking")).not.toBeNull();
  });

  it("frozen: neutral notice, and no cooked prompt, cooked button, visit done, cancel or no-show", async () => {
    await open(seededBooking(9104, "chef", pastUncooked(true)), "chef");
    const notice = h.q("frozen-notice")?.textContent ?? "";
    expect(notice).toContain(CHANGE_REFUSALS.frozen);
    expect(notice).not.toMatch(/reject|flag|chef_rejected|application/i);
    expect(h.q("mark-cooked-prompt")).toBeNull();
    expect(h.q("waiting-check")).toBeNull();
    expect(h.button(/Mark day/)).toBeNull();
    expect(h.q("finish")).toBeNull();
    expect(h.button("Visit done")).toBeNull();
    expect(h.q("end-booking")).toBeNull();
    expect(h.q("receipt-form")).toBeNull();
    expect(h.q("no-receipt")?.textContent).toContain("on hold");
  });

  it("frozen chef's-home booking: no pickup answer or missed-pickup buttons", async () => {
    const b = seededBooking(9103, "chef", (x) => ({ ...x, frozen: true }));
    await open(b, "chef");
    expect(h.q("pickup-respond")).toBeNull();
    expect(h.q("missed-pickup")).toBeNull();
    expect(h.button(/Accept this time|Decline this time/)).toBeNull();
  });

  it("missed pickup: shows after the window when not frozen, absent when frozen", async () => {
    await open(
      seededBooking(9105, "chef", (x) => ({ ...x, frozen: false })),
      "chef",
    );
    expect(h.q("missed-pickup")).not.toBeNull();
    h.cleanup();
    h = harness();
    await open(
      seededBooking(9105, "chef", (x) => ({ ...x, frozen: true })),
      "chef",
    );
    expect(h.q("frozen-notice")).not.toBeNull();
    expect(h.q("missed-pickup")).toBeNull();
  });

  it("frozen chef's-home: the pickup intro does not invite a proposal", async () => {
    await open(
      seededBooking(9103, "chef", (x) => ({ ...x, frozen: true })),
      "chef",
    );
    expect(h.q("pickups")?.textContent).toContain("Pickups are paused");
    expect(h.q("pickups")?.textContent).not.toMatch(/proposes a pickup time/);
    h.cleanup();
    h = harness();
    await open(seededBooking(9103, "chef", pastUncooked(true)), "chef");
    expect(h.q("frozen-notice")).not.toBeNull();
  });

  it("frozen chef's-home: an uncooked day says pickups are paused, not 'mark it cooked first'", async () => {
    await open(seededBooking(9103, "chef", pastUncooked(true)), "chef");
    const t = h.q("pickups")?.textContent ?? "";
    expect(t).toContain("Pickups are paused while this booking is on hold.");
    expect(t).not.toContain("Mark this day as cooked first");
    h.cleanup();
    h = harness();
    await open(seededBooking(9103, "chef", pastUncooked(false)), "chef");
    expect(h.q("pickups")?.textContent).toContain(
      "Mark this day as cooked first",
    );
  });

  it("frozen chef with a disputed receipt is told one cannot be added", async () => {
    const b = seededBooking(9106, "chef", (x) => ({ ...x, frozen: true }));
    const items = (seededReceipts()[b.id] ?? []).map((r) => ({
      ...r,
      status: "disputed" as const,
    }));
    await open(b, "chef", {
      [`GET /api/bookings/${b.id}/receipts`]: json(200, {
        bookingId: b.id,
        groceryOption: b.groceryOption,
        estimatedIngredientsCents: b.estimate.ingredientsCents,
        currency: "CAD",
        items,
      }),
    });
    expect(h.q("receipt-form")).toBeNull();
    expect(h.q("no-receipt-frozen")?.textContent).toContain("on hold");
  });

  it("a stale page that marks a day cooked shows the neutral words from a 409 frozen", async () => {
    const b = seededBooking(9104, "chef", pastUncooked(false));
    await open(b, "chef", {
      [`POST /api/bookings/${b.id}/days/1/cooked`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        { reason: "frozen" },
      ),
    });
    await h.click(h.button(/Mark day 1 as cooked/));
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain(
      CHANGE_REFUSALS.frozen,
    );
  });

  it("a no_day_cooked booking is not frozen and keeps its prompt", async () => {
    await open(seededBooking(9104, "chef", pastUncooked(false)), "chef");
    expect(h.q("frozen-notice")).toBeNull();
    expect(h.q("mark-cooked-prompt")?.textContent).toContain("not marked");
  });
});

describe("customer side", () => {
  it("not frozen: Cancel is offered (control)", async () => {
    await open(
      seededBooking(9104, "customer", (b) => ({ ...b, frozen: false })),
      "customer",
    );
    expect(h.q("frozen-notice")).toBeNull();
    expect(h.host.textContent).toContain("Cancel this booking");
  });

  it("not frozen: a pickup can be proposed (control)", async () => {
    await open(seededBooking(9103, "customer", noPickups(false)), "customer");
    expect(h.q("propose-form")).not.toBeNull();
  });

  it("frozen: neutral notice, no cancel, no propose form", async () => {
    await open(
      seededBooking(9104, "customer", (b) => ({ ...b, frozen: true })),
      "customer",
    );
    expect(h.q("frozen-notice")?.textContent).toContain(CHANGE_REFUSALS.frozen);
    expect(h.host.textContent).not.toContain("Cancel this booking");
    h.cleanup();
    h = harness();
    await open(seededBooking(9103, "customer", noPickups(true)), "customer");
    expect(h.q("frozen-notice")).not.toBeNull();
    expect(h.q("propose-form")).toBeNull();
    expect(h.button(/Propose/)).toBeNull();
    const t = h.q("pickups")?.textContent ?? "";
    expect(t).toContain("Pickups are paused while this booking is on hold.");
    expect(t).not.toMatch(/you propose a time|You can propose/);
  });

  it("frozen: receipt confirm and dispute stay available (D-66)", async () => {
    const b = seededBooking(9106, "customer", (x) => ({ ...x, frozen: true }));
    await open(b, "customer");
    expect(h.q("frozen-notice")).not.toBeNull();
    expect(h.button("Confirm this amount")).not.toBeNull();
    expect(h.button("Dispute this receipt")).not.toBeNull();
  });
});
