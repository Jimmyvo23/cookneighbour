// @vitest-environment jsdom
// T-070: the chef cancels an accepted booking or reports a customer no-show, from the request page.
// A confirm step says what will happen (timing D-20, free trial D-26 as built, hidden contact
// details), every refusal is worded, and focus goes to the alert or the invalid field.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BookingDetail } from "@/lib/api/types";
import { addDays, torontoToday } from "@/lib/domain/dishes";
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
afterEach(() => h.cleanup());

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
/** Accepted, customer's home; day 1 is `offset` days from today, not cooked. */
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
const cancelled = (b: BookingDetail): BookingDetail => ({
  ...b,
  status: "cancelled",
  cancelledBy: "chef",
  cancellationTiming: "late",
});

describe("cancel an accepted booking", () => {
  it("is offered only for an accepted booking (not a waiting request or a finished one)", async () => {
    await open(seededBooking(9101, "chef")); // requested
    expect(h.q("end-booking")).toBeNull();
    h.cleanup();
    h = harness();
    await open(
      seededBooking(9104, "chef", (b) => ({ ...b, status: "completed" })),
    );
    expect(h.q("end-booking")).toBeNull();
  });

  it("asks first and says late when the first day is within 48 hours", async () => {
    await open(accepted(0));
    expect(h.q("cancel-booking")).not.toBeNull();
    await h.click(h.button("Cancel this booking"));
    const note = h.q("cancel-timing-note")?.textContent ?? "";
    expect(note).toContain("late cancellation");
    expect(note).toContain("Nothing is charged either way");
    expect(callsTo(h.fetchMock, "/cancel")).toHaveLength(0);
    // The confirm heading owns focus.
    expect(document.activeElement?.textContent).toBe("Cancel this booking?");
  });

  it("says on time when the first day is more than 48 hours away", async () => {
    await open(accepted(5));
    await h.click(h.button("Cancel this booking"));
    expect(h.q("cancel-timing-note")?.textContent).toContain(
      "on-time cancellation",
    );
  });

  it("keeps the customer's free first booking when no day was cooked, and says so", async () => {
    await open(accepted(3));
    await h.click(h.button("Cancel this booking"));
    expect(h.q("cancel-trial-note")?.textContent).toContain(
      "keeps their free first booking",
    );
  });

  it("says the free first booking counts as used when a day was already cooked (D-26 as built)", async () => {
    await open(
      seededBooking(9104, "chef", (b) => ({
        ...b,
        isFreeTrial: true,
        days: b.days.map((d, i) =>
          i === 0
            ? {
                ...d,
                date: addDays(TODAY, -1),
                cookedAt: "2026-01-01T10:00:00Z",
              }
            : d,
        ),
      })),
    );
    await h.click(h.button("Cancel this booking"));
    expect(h.q("cancel-trial-note")?.textContent).toContain("counts as used");
  });

  it("says nothing about a trial when the booking is not a free first booking", async () => {
    await open(seededBooking(9104, "chef"));
    await h.click(h.button("Cancel this booking"));
    expect(h.q("cancel-trial-note")).toBeNull();
  });

  it("sends the reason, trimmed, and shows the result in the notice", async () => {
    const b = accepted(3);
    await open(b, {
      [`POST /api/bookings/${b.id}/cancel`]: json(200, cancelled(b)),
    });
    await h.click(h.button("Cancel this booking"));
    await h.type(h.host.querySelector("textarea"), "  I am ill  ");
    await h.click(h.button("Yes, cancel this booking"));
    expect(callsTo(h.fetchMock, "/cancel")).toEqual([
      [expect.any(String), "POST", { reason: "I am ill" }],
    ]);
    expect(h.q("notice")?.textContent).toContain("You cancelled this booking");
    expect(h.q("status")?.textContent).toContain("Cancelled");
    expect(h.q("end-booking")).toBeNull();
    expect(document.activeElement).toBe(h.q("notice"));
  });

  it("sends an empty body when no reason is given", async () => {
    const b = accepted(3);
    await open(b, {
      [`POST /api/bookings/${b.id}/cancel`]: json(200, cancelled(b)),
    });
    await h.click(h.button("Cancel this booking"));
    await h.click(h.button("Yes, cancel this booking"));
    expect(callsTo(h.fetchMock, "/cancel")[0][2]).toEqual({});
  });

  it("refuses a 1 or 2 character reason on the spot and focuses the field", async () => {
    await open(accepted(3));
    await h.click(h.button("Cancel this booking"));
    await h.type(h.host.querySelector("textarea"), "no");
    await h.click(h.button("Yes, cancel this booking"));
    expect(callsTo(h.fetchMock, "/cancel")).toHaveLength(0);
    const ta = h.host.querySelector("textarea")!;
    expect(ta.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(ta);
  });

  it("shows contact details in the reason as an error on the field (D-34)", async () => {
    const b = accepted(3);
    await open(b, {
      [`POST /api/bookings/${b.id}/cancel`]: apiError(
        422,
        "CONTACT_DETAILS_NOT_ALLOWED",
        "No contact details.",
        { fields: { reason: "Remove the contact details." } },
      ),
    });
    await h.click(h.button("Cancel this booking"));
    await h.type(h.host.querySelector("textarea"), "call me 416 555 0199");
    await h.click(h.button("Yes, cancel this booking"));
    expect(h.host.querySelector('[role="alert"]')?.textContent).toMatch(
      /phone numbers, emails and links out of the reason/,
    );
    const ta = h.host.querySelector("textarea")!;
    expect(ta.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(ta);
    // The booking is still accepted: nothing changed.
    expect(h.q("status")?.textContent).toContain("You accepted");
  });

  it.each([
    ["wrong_status", /not accepted any more/],
    ["nothing_left", /nothing left to cancel/],
    ["chef_use_decline", /Decline it with a reason/],
    ["expired", /expired/],
  ])("words the %s refusal and focuses the alert", async (reason, words) => {
    const b = accepted(3);
    await open(b, {
      [`POST /api/bookings/${b.id}/cancel`]: apiError(
        409,
        "INVALID_STATE",
        "server text",
        { reason },
      ),
    });
    await h.click(h.button("Cancel this booking"));
    await h.click(h.button("Yes, cancel this booking"));
    const alert = h.host.querySelector<HTMLElement>(
      '[role="alert"]:not(.sr-only)',
    )!;
    expect(alert.textContent).toMatch(words);
    expect(alert.textContent).not.toContain("server text");
    expect(document.activeElement).toBe(alert);
  });

  it("words a network failure", async () => {
    const b = accepted(3);
    await open(b, {});
    h.fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? Promise.reject(new TypeError("offline"))
        : Promise.resolve(
            new Response(JSON.stringify(b), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          ),
    );
    await h.click(h.button("Cancel this booking"));
    await h.click(h.button("Yes, cancel this booking"));
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain(
      "Check your connection",
    );
  });

  it("'Keep the booking' closes the step and returns focus to the opening button", async () => {
    await open(accepted(3));
    await h.click(h.button("Cancel this booking"));
    await h.click(h.button("Keep the booking"));
    expect(callsTo(h.fetchMock, "/cancel")).toHaveLength(0);
    expect(document.activeElement).toBe(h.button("Cancel this booking"));
  });

  it("explains instead of offering a button when nothing is left to cancel", async () => {
    await open(seededBooking(9103, "chef")); // its only visit is cooked
    expect(h.q("cancel-unavailable")?.textContent).toContain(
      "nothing left to cancel",
    );
    expect(h.button("Cancel this booking")).toBeNull();
  });

  it("a chef's-home booking says the customer loses the kitchen address; a customer's-home one says the chef loses the customer's", async () => {
    await open(accepted(3, (b) => ({ ...b, locationType: "chef_home" })));
    await h.click(h.button("Cancel this booking"));
    expect(h.q("end-booking")?.textContent).toContain("your kitchen address");
    h.cleanup();
    h = harness();
    await open(accepted(3));
    await h.click(h.button("Cancel this booking"));
    expect(h.q("end-booking")?.textContent).toContain(
      "their address and phone number",
    );
  });

  it("two copies of the form on one page would not share ids", async () => {
    await open(accepted(3));
    await h.click(h.button("Cancel this booking"));
    const ta = h.host.querySelector("textarea")!;
    const label = h.host.querySelector(`label[for="${ta.id}"]`);
    expect(label?.textContent).toContain("Reason (optional)");
    expect(ta.id).toMatch(/^cc.+-/);
  });
});

describe("report a customer no-show", () => {
  it("is offered when a visit is due today and not cooked", async () => {
    await open(accepted(0));
    expect(h.button("Report a customer no-show")).not.toBeNull();
    expect(h.q("report-no-show")?.textContent).toContain("Day 1");
  });

  it("is not offered before the visit date and says when the next visit is", async () => {
    await open(accepted(3));
    expect(h.button("Report a customer no-show")).toBeNull();
    const t = h.q("no-show-unavailable")?.textContent ?? "";
    expect(t).toContain("from the day of a visit");
    expect(t).toContain("The next visit is on");
  });

  it("is not offered for a visit that is cooked", async () => {
    await open(seededBooking(9103, "chef"));
    expect(h.button("Report a customer no-show")).toBeNull();
    expect(h.q("no-show-unavailable")).not.toBeNull();
  });

  it("asks first and says the trial is used up for a free first booking", async () => {
    await open(accepted(0));
    await h.click(h.button("Report a customer no-show"));
    expect(h.q("no-show-trial-note")?.textContent).toContain("counts as used");
    expect(h.q("report-no-show")?.textContent).toContain("You cannot undo it");
    expect(callsTo(h.fetchMock, "/no-show")).toHaveLength(0);
    expect(document.activeElement?.textContent).toContain(
      "did not show up for day 1",
    );
  });

  it("says nothing about a trial when it is not a free first booking", async () => {
    await open(seededBooking(9104, "chef"));
    await h.click(h.button("Report a customer no-show"));
    expect(h.q("no-show-trial-note")).toBeNull();
  });

  it("sends the report and shows the result", async () => {
    const b = accepted(0);
    const done: BookingDetail = {
      ...b,
      status: "no_show_customer",
      noShow: {
        reportedAt: new Date().toISOString(),
        dayNumber: 1,
        pickupMissed: false,
      },
    };
    await open(b, {
      [`POST /api/bookings/${b.id}/no-show`]: json(200, done),
    });
    await h.click(h.button("Report a customer no-show"));
    await h.click(h.button("Yes, report a no-show"));
    expect(callsTo(h.fetchMock, "/no-show")).toHaveLength(1);
    expect(h.q("notice")?.textContent).toContain("customer no-show");
    expect(h.q("status")?.textContent).toContain("customer no-show");
    expect(h.q("no-show")?.textContent).toContain("counts as used");
    expect(h.q("end-booking")).toBeNull();
  });

  it.each([
    ["no_visit_due", /from the visit date/],
    ["wrong_status", /not accepted any more/],
  ])("words the %s refusal and focuses the alert", async (reason, words) => {
    const b = accepted(0);
    await open(b, {
      [`POST /api/bookings/${b.id}/no-show`]: apiError(
        409,
        "INVALID_STATE",
        "server text",
        { reason },
      ),
    });
    await h.click(h.button("Report a customer no-show"));
    await h.click(h.button("Yes, report a no-show"));
    const alert = h.host.querySelector<HTMLElement>(
      '[role="alert"]:not(.sr-only)',
    )!;
    expect(alert.textContent).toMatch(words);
    expect(document.activeElement).toBe(alert);
  });

  it("'Keep the booking' returns focus to the opening button", async () => {
    await open(accepted(0));
    await h.click(h.button("Report a customer no-show"));
    await h.click(h.button("Keep the booking"));
    expect(document.activeElement).toBe(h.button("Report a customer no-show"));
  });

  it("points a chef's-home chef to 'Mark pickup missed' for cooked meals that were not collected", async () => {
    await open(accepted(0, (b) => ({ ...b, locationType: "chef_home" })));
    expect(h.q("report-no-show")?.textContent).toContain("Mark pickup missed");
  });
});

describe("after the booking ended", () => {
  it("a chef-cancelled free first booking tells the chef what happened to the trial", async () => {
    await open(cancelled(accepted(3)));
    expect(h.q("cancelled")?.textContent).toContain(
      "keeps their free first booking",
    );
    expect(h.q("end-booking")).toBeNull();
  });
});
