// @vitest-environment jsdom
// T-070 Tester additions: every status, reason length limits, double click, D-20 boundary,
// no-show date rules, the stale-error-after-reopen known issue, and kitchen wording per status.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingDetail } from "@/lib/api/types";
import { addDays, torontoToday } from "@/lib/domain/dishes";
import { torontoStartOfDay } from "@/lib/domain/cancellation";
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
import { ChefBookingView } from "@/components/booking/ChefBookingView";

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => {
  vi.useRealTimers();
  h.cleanup();
});

async function open(
  b: BookingDetail,
  extra: Record<string, Parameters<typeof routes>[1][string]> = {},
) {
  routes(h.fetchMock, {
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
    ...extra,
  });
  await h.mount(<ChefBookingView id={b.id} />);
}

const TODAY = torontoToday();
const accepted = (
  offset: number,
  over: (b: BookingDetail) => BookingDetail = (b) => b,
) =>
  seededBooking(9101, "chef", (b) =>
    over({
      ...b,
      status: "accepted",
      days: b.days.map((d, i) => ({
        ...d,
        date: addDays(TODAY, offset + i),
        cookedAt: null,
      })),
    }),
  );

describe("tester: the end section exists only while accepted", () => {
  it.each([
    "requested",
    "declined",
    "expired",
    "cancelled",
    "completed",
    "no_show_customer",
    "no_show_chef",
  ] as const)(
    "no cancel or no-show button for a %s booking",
    async (status) => {
      await open({ ...accepted(0), status });
      expect(h.q("end-booking")).toBeNull();
      expect(h.button(/Cancel this booking/)).toBeNull();
      expect(h.button(/Report a customer no-show/)).toBeNull();
    },
  );
});

describe("tester: reason limits", () => {
  const note = "x".repeat(500);
  it("sends a 500 character reason", async () => {
    const b = accepted(3);
    await open(b, {
      [`POST /api/bookings/${b.id}/cancel`]: json(200, {
        ...b,
        status: "cancelled",
        cancelledBy: "chef",
        cancellationTiming: "on_time",
      }),
    });
    await h.click(h.button("Cancel this booking"));
    await h.type(h.host.querySelector("textarea"), note);
    await h.click(h.button("Yes, cancel this booking"));
    expect(callsTo(h.fetchMock, "/cancel")).toHaveLength(1);
  });
  it("refuses 501 characters in the form without calling the server", async () => {
    const b = accepted(3);
    await open(b);
    await h.click(h.button("Cancel this booking"));
    await h.type(h.host.querySelector("textarea"), note + "y");
    await h.click(h.button("Yes, cancel this booking"));
    expect(callsTo(h.fetchMock, "/cancel")).toHaveLength(0);
    expect(h.host.querySelector("textarea")!.getAttribute("aria-invalid")).toBe(
      "true",
    );
  });
  it("a whitespace-only reason is sent as no reason", async () => {
    const b = accepted(3);
    await open(b, {
      [`POST /api/bookings/${b.id}/cancel`]: json(200, {
        ...b,
        status: "cancelled",
        cancelledBy: "chef",
        cancellationTiming: "on_time",
      }),
    });
    await h.click(h.button("Cancel this booking"));
    await h.type(h.host.querySelector("textarea"), "    ");
    await h.click(h.button("Yes, cancel this booking"));
    expect(callsTo(h.fetchMock, "/cancel")[0][2]).toEqual({});
  });
  it("a double click on 'Yes, cancel' sends one request", async () => {
    const b = accepted(3);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    await open(b);
    h.fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        await gate;
        return new Response(
          JSON.stringify({
            ...b,
            status: "cancelled",
            cancelledBy: "chef",
            cancellationTiming: "on_time",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify(b), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    await h.click(h.button("Cancel this booking"));
    const yes = h.button("Yes, cancel this booking")!;
    await h.click(yes);
    await h.click(h.button(/Cancelling/));
    release();
    await h.flush();
    expect(callsTo(h.fetchMock, "/cancel")).toHaveLength(1);
  });
});

describe("tester: D-20 boundary in the confirm text", () => {
  // Day 1 = 2026-11-10 (EST). Free until 48 h before Toronto midnight of that date.
  const DAY1 = "2026-11-10";
  const freeUntil = torontoStartOfDay(DAY1).getTime() - 48 * 3_600_000;
  async function at(ms: number) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ms);
    const today = torontoToday();
    const b = accepted(0, (x) => ({
      ...x,
      days: x.days.map((d, i) => ({ ...d, date: addDays(DAY1, i) })),
    }));
    expect(today < DAY1).toBe(true);
    await open(b);
    await h.click(h.button("Cancel this booking"));
    return h.q("cancel-timing-note")?.textContent ?? "";
  }
  it("one second before the cut-off is on time", async () => {
    expect(await at(freeUntil - 1000)).toContain("on-time");
  });
  it("exactly at the cut-off is on time (server: now <= free-until)", async () => {
    expect(await at(freeUntil)).toContain("on-time");
  });
  it("one second after the cut-off is late", async () => {
    expect(await at(freeUntil + 1000)).toContain("late cancellation");
  });
});

/** Accepted booking with day 1 at `d1` offset and day 2 at `d2` offset (days cloned from day 1). */
const twoDays = (d1: number, d2: number, cooked1: boolean): BookingDetail =>
  accepted(0, (b) => ({
    ...b,
    days: [
      {
        ...b.days[0],
        dayNumber: 1,
        date: addDays(TODAY, d1),
        cookedAt: cooked1 ? "2026-01-01T10:00:00Z" : null,
      },
      {
        ...b.days[0],
        dayNumber: 2,
        date: addDays(TODAY, d2),
        cookedAt: null,
      },
    ],
  }));

describe("tester: no-show date rules", () => {
  it("is offered for a visit that was due yesterday and never cooked", async () => {
    await open(accepted(-1, (b) => ({ ...b })));
    expect(h.q("report-no-show")?.textContent).toContain("Day 1");
    expect(h.button("Report a customer no-show")).not.toBeNull();
  });
  it("names day 2 when day 1 is cooked and day 2 is today", async () => {
    await open(twoDays(-1, 0, true));
    expect(h.q("report-no-show")?.textContent).toContain("Day 2");
  });
  it("not offered when day 1 is cooked and day 2 is tomorrow", async () => {
    await open(twoDays(-1, 1, true));
    expect(h.button("Report a customer no-show")).toBeNull();
    expect(h.q("no-show-unavailable")?.textContent).toContain(
      "The next visit is on",
    );
  });
  it("offers the earlier uncooked day first when both are due", async () => {
    await open(twoDays(-2, 0, false));
    expect(h.q("report-no-show")?.textContent).toContain("Day 1");
  });
  it("words every cancel 422 reason that is not contact details", async () => {
    const b = accepted(3);
    await open(b, {
      [`POST /api/bookings/${b.id}/cancel`]: apiError(
        422,
        "VALIDATION_ERROR",
        "bad",
        { fields: { reason: "Use 3 to 500 characters." } },
      ),
    });
    await h.click(h.button("Cancel this booking"));
    await h.type(h.host.querySelector("textarea"), "abc");
    await h.click(h.button("Yes, cancel this booking"));
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain(
      "3 to 500",
    );
  });
});

describe("tester: known issue, an old error shows again after reopening", () => {
  it("after a failure, 'Keep the booking' and reopen shows no old alert", async () => {
    const b = accepted(3);
    await open(b, {
      [`POST /api/bookings/${b.id}/cancel`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        { reason: "wrong_status" },
      ),
    });
    await h.click(h.button("Cancel this booking"));
    await h.click(h.button("Yes, cancel this booking"));
    await h.click(h.button("Keep the booking"));
    await h.click(h.button("Cancel this booking"));
    // Fixed in T-070 round 2: reopening starts clean. T-080: a 409 is shown by the page, outside
    // the section, so the section itself must have no visible alert.
    const alert = h.host.querySelector(
      '[role="alert"]:not(.sr-only):not([data-testid="refusal"])',
    );
    expect(alert).toBeNull();
  });
});

describe("tester: kitchen wording per chef's-home status", () => {
  it.each([
    ["accepted", /While you have an accepted booking at your home/],
    ["completed", /no longer locks your kitchen address/],
    ["no_show_customer", /no longer locks your kitchen address/],
    ["cancelled", /no longer locks your kitchen address/],
  ] as const)("%s", async (status, words) => {
    const b = accepted(0, (x) => ({
      ...x,
      status,
      locationType: "chef_home",
    }));
    await open(b);
    expect(h.q("kitchen-note")?.textContent).toMatch(words);
    // The cancelled text must not claim the customer can still see the address.
    if (status === "cancelled")
      expect(h.q("kitchen-note")?.textContent).toContain("cannot see");
  });
  it.each(["declined", "expired"] as const)(
    "%s never says the booking locks the kitchen",
    async (status) => {
      await open(
        accepted(3, (x) => ({ ...x, status, locationType: "chef_home" })),
      );
      expect(h.q("kitchen-note")?.textContent ?? "").not.toMatch(
        /accepted booking at your home, your kitchen address is locked/,
      );
    },
  );
});

describe("tester: nothing-left hint when a past visit was never cooked", () => {
  it("the hint tells the chef to mark cooked days first and points to the no-show report", async () => {
    await open(accepted(-2));
    const t = h.q("cancel-unavailable")?.textContent ?? "";
    expect(t).toContain("Mark the days you cooked, then press Visit done");
    expect(t).toContain("If the customer did not show up, report it below");
    expect(t).not.toContain("either cooked or in the past");
    expect(h.button("Report a customer no-show")).not.toBeNull();
  });
});
