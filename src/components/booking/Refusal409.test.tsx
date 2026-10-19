// @vitest-environment jsdom
// T-080: after a 409 from any booking change the page refetches the booking, the dead button goes,
// and the explaining alert stays and is focused. One shared path (components/refusal.tsx), so the
// same checks run for the chef's page (pickup missed, respond, accept) and the customer's page
// (pickup confirm, cancel). Bookings come from the MOCK seed, never hand-made numbers.
import { StrictMode } from "react";
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

import { ChefBookingView } from "@/components/booking/ChefBookingView";
import { BookingDetailView } from "@/components/booking/BookingDetailView";

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

type Handler = (body: unknown) => Response | Promise<Response>;

/** GET /api/bookings/:id answers `first`, then `later` (the refetch after the refusal). */
function mountRoutes(
  first: BookingDetail,
  later: BookingDetail | "fail",
  extra: Record<string, Handler>,
) {
  // Before any POST the page gets `first` (StrictMode may load twice); after it, `later`.
  const detail: Handler = () => {
    const posted = h.fetchMock.mock.calls.some(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    if (posted && later === "fail")
      return new Response(
        JSON.stringify({ error: { code: "INTERNAL", message: "down" } }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    return new Response(JSON.stringify(posted ? later : first), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const shopping = {
    bookingId: first.id,
    groceryOption: first.groceryOption,
    locationType: first.locationType,
    currency: "CAD",
    plan: {
      buyer: first.groceryOption === "chef_shops" ? "chef" : "customer",
      deliverTo: first.locationType,
      customerDeliversToChef:
        first.groceryOption === "customer_buys" &&
        first.locationType === "chef_home",
      receiptRequired: first.groceryOption === "chef_shops",
      note: "x",
    },
    days: [],
    estimatedCostCents: 0,
  };
  routes(h.fetchMock, {
    [`GET /api/bookings/${first.id}`]: detail,
    [`GET /api/bookings/${first.id}/shopping-list`]: json(200, shopping),
    [`GET /api/bookings/${first.id}/receipts`]: json(200, {
      bookingId: first.id,
      groceryOption: first.groceryOption,
      estimatedIngredientsCents: first.estimate.ingredientsCents,
      currency: "CAD",
      items: seededReceipts()[first.id] ?? [],
    }),
    ...extra,
  });
}

const pageAlert = () => h.q("refusal");
const bookingGets = (b: BookingDetail) =>
  callsTo(h.fetchMock, `/api/bookings/${b.id}`).filter((c) => c[1] === "GET")
    .length;

const confirmedOn = (b: BookingDetail): BookingDetail => ({
  ...b,
  days: b.days.map((d) => ({
    ...d,
    pickedUpAt: d.cookedAt ? "2026-10-20T20:00:00.000Z" : null,
  })),
});

describe("chef: stale 'Mark pickup missed' answered pickup_confirmed", () => {
  async function stale() {
    const b = seededBooking(9105, "chef");
    mountRoutes(b, confirmedOn(b), {
      [`POST /api/bookings/${b.id}/pickup/missed`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        { reason: "pickup_confirmed" },
      ),
    });
    await h.mount(<ChefBookingView id={b.id} />);
    await h.click(h.button("Mark pickup missed"));
    await h.click(h.button("Yes, mark pickup missed"));
    return b;
  }

  it("refetches once, removes the dead button, keeps the alert and focuses it", async () => {
    const b = await stale();
    expect(bookingGets(b)).toBe(2);
    expect(h.q("missed-pickup")).toBeNull();
    expect(h.button(/mark pickup missed/i)).toBeNull();
    const alert = pageAlert()!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent!.length).toBeGreaterThan(10);
    expect(document.activeElement).toBe(alert);
    expect(h.qa("refusal")).toHaveLength(1);
    // The section did not also show its own alert.
    expect(
      h.host.querySelectorAll('[role="alert"]:not(.sr-only)'),
    ).toHaveLength(1);
  });

  it("a failed refetch keeps the old page and the message", async () => {
    const b = seededBooking(9105, "chef");
    mountRoutes(b, "fail", {
      [`POST /api/bookings/${b.id}/pickup/missed`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        { reason: "pickup_confirmed" },
      ),
    });
    await h.mount(<ChefBookingView id={b.id} />);
    await h.click(h.button("Mark pickup missed"));
    await h.click(h.button("Yes, mark pickup missed"));
    expect(bookingGets(b)).toBe(2);
    expect(pageAlert()).not.toBeNull();
    expect(document.activeElement).toBe(pageAlert());
    expect(h.q("load-error")).toBeNull();
    expect(h.q("missed-pickup")).not.toBeNull();
  });

  it("does not loop: a quiet extra wait makes no more fetches", async () => {
    const b = await stale();
    await h.flush();
    await h.flush();
    expect(bookingGets(b)).toBe(2);
  });

  it("a second refusal gives a new alert, focus again, and a second refetch", async () => {
    const b = seededBooking(9105, "chef");
    mountRoutes(b, b, {
      [`POST /api/bookings/${b.id}/pickup/missed`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        { reason: "pickup_window_open" },
      ),
    });
    await h.mount(<ChefBookingView id={b.id} />);
    for (let i = 0; i < 2; i++) {
      // The confirm step stays open after a refusal, so only the first round needs the opener.
      if (i === 0) await h.click(h.button("Mark pickup missed"));
      const before = pageAlert();
      await h.click(h.button("Yes, mark pickup missed"));
      expect(pageAlert()).not.toBe(before);
      expect(document.activeElement).toBe(pageAlert());
    }
    expect(bookingGets(b)).toBe(3);
    expect(pageAlert()!.textContent).toContain("can still pick up");
  });
});

describe("other 4xx and network errors keep the section's own alert and do not refetch", () => {
  it.each([
    [422, "VALIDATION_FAILED", "Check this."],
    [403, "FORBIDDEN", "Not yours."],
    [404, "NOT_FOUND", "Gone."],
  ])("%s", async (status, code, message) => {
    const b = seededBooking(9105, "chef");
    mountRoutes(b, b, {
      [`POST /api/bookings/${b.id}/pickup/missed`]: apiError(
        status,
        code,
        message,
      ),
    });
    await h.mount(<ChefBookingView id={b.id} />);
    await h.click(h.button("Mark pickup missed"));
    await h.click(h.button("Yes, mark pickup missed"));
    expect(bookingGets(b)).toBe(1);
    expect(pageAlert()).toBeNull();
    const alert = h.host.querySelector<HTMLElement>(
      '[role="alert"]:not(.sr-only)',
    )!;
    expect(alert).not.toBeNull();
    expect(document.activeElement).toBe(alert);
  });

  it("a network failure", async () => {
    const b = seededBooking(9105, "chef");
    mountRoutes(b, b, {});
    await h.mount(<ChefBookingView id={b.id} />);
    const base = h.fetchMock.getMockImplementation() as (
      u: string,
      i?: RequestInit,
    ) => Promise<Response>;
    h.fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      String(url).endsWith("/pickup/missed")
        ? Promise.reject(new TypeError("offline"))
        : base(url, init),
    );
    await h.click(h.button("Mark pickup missed"));
    await h.click(h.button("Yes, mark pickup missed"));
    expect(bookingGets(b)).toBe(1);
    expect(pageAlert()).toBeNull();
    expect(
      h.host.querySelector('[role="alert"]:not(.sr-only)')?.textContent,
    ).toBeTruthy();
  });
});

describe("chef: respond to a stale pickup proposal", () => {
  it("refetches and keeps the message", async () => {
    const b = seededBooking(9103, "chef");
    const later: BookingDetail = {
      ...b,
      days: b.days.map((d) => ({
        ...d,
        pickups: d.pickups.map((p) => ({ ...p, status: "void" as const })),
      })),
    };
    mountRoutes(b, later, {
      [`POST /api/bookings/${b.id}/days/1/pickup/respond`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        { reason: "proposal_past" },
      ),
    });
    await h.mount(<ChefBookingView id={b.id} />);
    await h.click(h.button("Accept this time"));
    expect(bookingGets(b)).toBe(2);
    expect(h.q("pickup-respond")).toBeNull();
    expect(pageAlert()?.textContent).toContain("already passed");
    expect(document.activeElement).toBe(pageAlert());
  });
});

describe("customer: stale 'I picked up my meals' answered wrong_status", () => {
  it("refetches, hides the button, keeps the alert focused", async () => {
    const b = seededBooking(9103, "customer", (x) => ({
      ...x,
      days: x.days.map((d) => ({ ...d, pickups: [] })),
    }));
    const missed: BookingDetail = {
      ...b,
      status: "no_show_customer",
      noShow: {
        reportedAt: "2026-10-20T20:00:00.000Z",
        dayNumber: 1,
        pickupMissed: true,
      },
    };
    mountRoutes(b, missed, {
      [`POST /api/bookings/${b.id}/days/1/pickup/confirm`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        { reason: "wrong_status" },
      ),
    });
    await h.mount(<BookingDetailView id={b.id} />);
    await h.click(h.button(/I picked up/));
    await h.click(h.button("Yes, I picked them up"));
    expect(bookingGets(b)).toBe(2);
    expect(h.button(/I picked up/)).toBeNull();
    expect(h.button("Yes, I picked them up")).toBeNull();
    expect(pageAlert()).not.toBeNull();
    expect(document.activeElement).toBe(pageAlert());
    expect(h.qa("refusal")).toHaveLength(1);
  });
});

describe("customer: stale cancel", () => {
  it("refetches and keeps the message", async () => {
    const b = seededBooking(9103, "customer", (x) => ({
      ...x,
      days: x.days.map((d) => ({
        ...d,
        cookedAt: null,
        pickups: [],
        date: "2099-01-20",
      })),
    }));
    mountRoutes(
      b,
      {
        ...b,
        status: "cancelled",
        cancelledBy: "chef",
        cancelledAt: "2026-10-19T15:00:00.000Z",
        cancellationTiming: "on_time",
      },
      {
        [`POST /api/bookings/${b.id}/cancel`]: apiError(
          409,
          "INVALID_STATE",
          "x",
          { reason: "wrong_status" },
        ),
      },
    );
    await h.mount(<BookingDetailView id={b.id} />);
    await h.click(h.button("Cancel this booking"));
    await h.click(h.button(/^Yes, cancel/));
    expect(bookingGets(b)).toBe(2);
    expect(h.button("Cancel this booking")).toBeNull();
    expect(pageAlert()?.textContent).toContain("can no longer be cancelled");
    expect(document.activeElement).toBe(pageAlert());
  });
});

describe("chef: stale accept", () => {
  it("refetches and keeps the message", async () => {
    const b = seededBooking(9101, "chef");
    mountRoutes(
      b,
      { ...b, status: "expired", respondedAt: null },
      {
        [`POST /api/bookings/${b.id}/accept`]: apiError(
          409,
          "INVALID_STATE",
          "x",
          { reason: "wrong_status" },
        ),
      },
    );
    await h.mount(<ChefBookingView id={b.id} />);
    await h.click(h.button("Accept this request"));
    expect(bookingGets(b)).toBe(2);
    expect(h.q("answer")).toBeNull();
    expect(pageAlert()).not.toBeNull();
    expect(document.activeElement).toBe(pageAlert());
  });
});

describe("a successful change clears an old refusal", () => {
  it("replaces the message", async () => {
    const b = seededBooking(9103, "chef");
    let n = 0;
    mountRoutes(b, b, {
      [`POST /api/bookings/${b.id}/days/1/pickup/respond`]: () => {
        n++;
        return n === 1
          ? (apiError(409, "INVALID_STATE", "x", {
              reason: "proposal_past",
            })({}) as Response)
          : (json(200, b)({}) as Response);
      },
    });
    await h.mount(<ChefBookingView id={b.id} />);
    await h.click(h.button("Accept this time"));
    expect(pageAlert()).not.toBeNull();
    await h.click(h.button("Accept this time"));
    expect(pageAlert()).toBeNull();
  });
});

describe("React StrictMode", () => {
  it("still refetches once and leaves focus on the one page alert", async () => {
    const b = seededBooking(9105, "chef");
    mountRoutes(b, confirmedOn(b), {
      [`POST /api/bookings/${b.id}/pickup/missed`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        { reason: "pickup_confirmed" },
      ),
    });
    await h.mount(
      <StrictMode>
        <ChefBookingView id={b.id} />
      </StrictMode>,
    );
    const initial = bookingGets(b); // StrictMode may load twice on mount
    await h.click(h.button("Mark pickup missed"));
    await h.click(h.button("Yes, mark pickup missed"));
    expect(bookingGets(b)).toBe(initial + 1);
    expect(h.qa("refusal")).toHaveLength(1);
    expect(document.activeElement).toBe(pageAlert());
    expect(h.q("missed-pickup")).toBeNull();
  });
});
