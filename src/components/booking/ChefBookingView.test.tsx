// @vitest-environment jsdom
// T-045: the chef's request page against a stubbed network. It shows the customer's intake and the
// allergy conflicts before any answer, needs a reason to decline (D-34), never shows an address or
// phone before acceptance, and moves focus to the alert after a failure.
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
  SEED_ID,
  type Harness,
} from "@/components/booking/testkit";
import { ChefBookingView } from "@/components/booking/ChefBookingView";

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
    customerDeliversToChef:
      b.groceryOption === "customer_buys" && b.locationType === "chef_home",
    receiptRequired: b.groceryOption === "chef_shops",
    note: "x",
  },
  days: [],
  estimatedCostCents: 0,
});

/** Mounts the page for `b`; extra routes override the defaults. */
async function open(
  b: BookingDetail,
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
  await h.mount(<ChefBookingView id={b.id} />);
}

describe("a waiting request", () => {
  it("shows the intake and the allergy conflict before the answer, and no address or phone", async () => {
    const b = seededBooking(9101, "chef");
    await open(b);
    expect(h.q("status")?.textContent).toContain("Waiting for your answer");
    expect(h.q("intake")?.textContent).toContain("peanuts, carries an EpiPen");
    expect(h.q("intake")?.textContent).toContain("No beef for the children");
    expect(h.q("conflicts")?.textContent).toContain("Chicken satay");
    // The intake comes before the answer buttons in reading order.
    const intake = h.q("intake")!;
    const answer = h.q("answer")!;
    expect(
      intake.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(h.q("address-later")?.textContent).toContain("once you accept");
    expect(h.q("contact-later")).not.toBeNull();
    expect(h.q("cooking-place")).toBeNull();
    expect(h.q("contact")).toBeNull();
    expect(h.text()).not.toMatch(/\+1\d{10}/);
    expect(h.text()).not.toContain("Maple Ave");
  });

  it("labels a free first booking for the chef with the MOCK note", async () => {
    await open(seededBooking(9101, "chef"));
    const l = h.q("trial-label")!;
    expect(l.textContent).toContain("Free first booking");
    expect(l.textContent).toContain(
      "Labour is free for the customer on this booking (prototype, MOCK).",
    );
    expect(l.querySelector('[data-testid="mock-badge"]')).not.toBeNull();
    h.cleanup();
    h = harness();
    await open(seededBooking(9102, "chef"));
    expect(h.q("trial-label")).toBeNull();
  });

  it("shows eat-by dates for every dish", async () => {
    const b = seededBooking(9101, "chef");
    await open(b);
    const eatBy = h.qa("eat-by");
    expect(eatBy).toHaveLength(2);
    for (const e of eatBy) expect(e.textContent).toMatch(/^Eat by /);
  });

  it("tells the chef the kitchen address is shared once a chef's-home booking is accepted, and locked", async () => {
    await open(seededBooking(9102, "chef"));
    const note = h.q("kitchen-note")?.textContent ?? "";
    expect(note).toContain("shared with the customer once you accept");
    expect(note).toContain("locked");
    expect(h.q("address-later")).toBeNull(); // nothing about a customer address for a chef's-home booking
  });

  it("says no dish matches when there is no conflict", async () => {
    await open(seededBooking(9102, "chef"));
    expect(h.q("no-conflicts")).not.toBeNull();
    expect(h.q("conflicts")).toBeNull();
  });

  it("accept posts and shows the contact the API now sends", async () => {
    const b = seededBooking(9101, "chef");
    const accepted: BookingDetail = {
      ...b,
      status: "accepted",
      cookingPlace: {
        line: "9101 Maple Ave",
        city: "Mississauga",
        postalCode: "L5B1M2",
      },
      contact: { displayName: "Priya Patel", phone: "+14165550123" },
    };
    await open(b, {
      [`POST /api/bookings/${b.id}/accept`]: json(200, accepted),
    });
    await h.click(h.button("Accept this request"));
    expect(callsTo(h.fetchMock, "/accept")).toHaveLength(1);
    expect(h.q("status")?.textContent).toContain("You accepted");
    expect(h.q("cooking-place")?.textContent).toContain("9101 Maple Ave");
    expect(h.q("contact")?.textContent).toContain("+14165550123");
    // The page announces the result and takes focus (the accept button is gone).
    expect(document.activeElement).toBe(h.q("notice"));
    expect(h.q("notice")?.textContent).toContain("You accepted this booking");
  });

  it("a failed accept shows words for the reason and moves focus to the alert", async () => {
    const b = seededBooking(9102, "chef");
    await open(b, {
      [`POST /api/bookings/${b.id}/accept`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        { reason: "chef_home_not_enabled" },
      ),
    });
    await h.click(h.button("Accept this request"));
    const alert = h.host.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("switched off");
    expect(document.activeElement).toBe(alert);
    expect(h.q("status")?.textContent).toContain("Waiting for your answer");
  });

  it("decline needs a reason: nothing is sent, the field is marked and focused", async () => {
    const b = seededBooking(9101, "chef");
    await open(b);
    await h.click(h.button("Decline this request"));
    const area = h.host.querySelector("textarea") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(area);
    await h.click(h.button("Send decline"));
    expect(callsTo(h.fetchMock, "/decline")).toHaveLength(0);
    expect(area.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(area);
    expect(h.text()).toContain("Tell the customer why");
  });

  it("decline sends the trimmed reason and closes the form", async () => {
    const b = seededBooking(9101, "chef");
    const declined: BookingDetail = {
      ...b,
      status: "declined",
      declineReason: "I am away that week",
    };
    await open(b, {
      [`POST /api/bookings/${b.id}/decline`]: json(200, declined),
    });
    await h.click(h.button("Decline this request"));
    await h.type(h.host.querySelector("textarea"), "  I am away that week  ");
    await h.click(h.button("Send decline"));
    expect(callsTo(h.fetchMock, "/decline")[0][2]).toEqual({
      reason: "I am away that week",
    });
    expect(h.q("status")?.textContent).toContain("declined");
    expect(h.q("answer")).toBeNull();
    expect(document.activeElement).toBe(h.q("notice"));
  });

  it("a reason with contact details is refused by the server and the words explain", async () => {
    const b = seededBooking(9101, "chef");
    await open(b, {
      [`POST /api/bookings/${b.id}/decline`]: apiError(
        422,
        "CONTACT_DETAILS_NOT_ALLOWED",
        "no",
        { fields: { reason: "Remove the contact details." } },
      ),
    });
    await h.click(h.button("Decline this request"));
    await h.type(h.host.querySelector("textarea"), "call me 416 555 0100");
    await h.click(h.button("Send decline"));
    const alert = h.host.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("phone numbers");
    expect(document.activeElement).toBe(h.host.querySelector("textarea"));
  });

  it("an expired request tells the chef it can no longer be answered", async () => {
    const b = seededBooking(9101, "chef");
    await open(b, {
      [`POST /api/bookings/${b.id}/accept`]: apiError(
        409,
        "REQUEST_EXPIRED",
        "x",
      ),
    });
    await h.click(h.button("Accept this request"));
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain(
      "expired",
    );
  });
});

describe("an accepted booking", () => {
  it("shows the customer's address and phone from the API for a customer's-home booking", async () => {
    await open(seededBooking(9104, "chef"));
    expect(h.q("cooking-place")?.textContent).toContain("Maple Ave");
    expect(h.q("contact")?.textContent).toMatch(/\+1416555\d{4}/);
    expect(h.q("answer")).toBeNull();
  });

  it("a chef's-home booking says the customer can see the kitchen address and that it is locked", async () => {
    await open(seededBooking(9103, "chef"));
    const note = h.q("kitchen-note")?.textContent ?? "";
    expect(note).toContain("can now see your kitchen address");
    expect(note).toContain("locked");
    expect(h.q("cooking-place")).toBeNull();
  });

  it("offers 'mark as cooked' only for a day whose date has come", async () => {
    const b = seededBooking(9104, "chef"); // day 1 today, day 2 tomorrow
    await open(b);
    expect(h.button("Mark day 1 as cooked")).not.toBeNull();
    expect(h.button("Mark day 2 as cooked")).toBeNull();
    expect(h.q("cooked-later")?.textContent).toContain(
      "You can mark this day as cooked on",
    );
  });

  it("marks a day as cooked and keeps focus on the announcement", async () => {
    const b = seededBooking(9104, "chef");
    const next: BookingDetail = {
      ...b,
      days: b.days.map((d, i) =>
        i === 0 ? { ...d, cookedAt: new Date().toISOString() } : d,
      ),
    };
    await open(b, {
      [`POST /api/bookings/${b.id}/days/1/cooked`]: json(200, next),
    });
    await h.click(h.button("Mark day 1 as cooked"));
    expect(h.qa("cooked")).toHaveLength(1);
    expect(h.button("Mark day 1 as cooked")).toBeNull();
    expect(document.activeElement).toBe(h.q("notice"));
  });

  it("a refused 'cooked' (too early) shows words and focuses the alert", async () => {
    const b = seededBooking(9104, "chef");
    await open(b, {
      [`POST /api/bookings/${b.id}/days/1/cooked`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        {
          reason: "too_early",
        },
      ),
    });
    await h.click(h.button("Mark day 1 as cooked"));
    const alert = h.host.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("has not arrived");
    expect(document.activeElement).toBe(alert);
  });

  it("'Visit done' appears only when every day is cooked, then completes", async () => {
    const open4 = seededBooking(9104, "chef");
    await open(open4);
    expect(h.button("Visit done")).toBeNull();
    expect(h.q("finish")?.textContent).toContain(
      "Mark every day as cooked first",
    );
    h.cleanup();
    h = harness();
    const b = seededBooking(9106, "chef"); // its only day is cooked
    const done: BookingDetail = {
      ...b,
      status: "completed",
      completedAt: new Date().toISOString(),
    };
    await open(b, { [`POST /api/bookings/${b.id}/complete`]: json(200, done) });
    await h.click(h.button("Visit done"));
    expect(callsTo(h.fetchMock, "/complete")).toHaveLength(1);
    expect(h.q("status")?.textContent).toContain("Completed");
  });

  it("warns a chef's-home chef that completing ends the missed-pickup option", async () => {
    const b = seededBooking(9103, "chef");
    await open(b);
    expect(h.q("finish")?.textContent).toContain(
      "no longer mark a missed pickup",
    );
  });
});

describe("pickups and a missed pickup", () => {
  it("shows an open proposal and answers it", async () => {
    const b = seededBooking(9103, "chef");
    const acceptedPickup: BookingDetail = {
      ...b,
      days: b.days.map((d) => ({
        ...d,
        pickups: d.pickups.map((p) =>
          p.status === "proposed" ? { ...p, status: "accepted" as const } : p,
        ),
      })),
    };
    await open(b, {
      [`POST /api/bookings/${b.id}/days/1/pickup/respond`]: json(
        200,
        acceptedPickup,
      ),
    });
    expect(h.q("pickup-respond")?.textContent).toContain("proposes");
    await h.click(h.button("Accept this time"));
    expect(callsTo(h.fetchMock, "/pickup/respond")[0][2]).toEqual({
      accept: true,
    });
    expect(h.q("pickup-agreed")).not.toBeNull();
    expect(h.q("pickup-respond")).toBeNull();
  });

  it("declining a pickup time sends accept:false", async () => {
    const b = seededBooking(9103, "chef");
    await open(b, {
      [`POST /api/bookings/${b.id}/days/1/pickup/respond`]: json(200, b),
    });
    await h.click(h.button("Decline this time"));
    expect(callsTo(h.fetchMock, "/pickup/respond")[0][2]).toEqual({
      accept: false,
    });
  });

  it("a stale proposal shows the reason in words", async () => {
    const b = seededBooking(9103, "chef");
    await open(b, {
      [`POST /api/bookings/${b.id}/days/1/pickup/respond`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        {
          reason: "proposal_past",
        },
      ),
    });
    await h.click(h.button("Accept this time"));
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain(
      "already passed",
    );
  });

  it("'Mark pickup missed' appears only after the pickup window, and asks first", async () => {
    await open(seededBooking(9103, "chef"));
    expect(h.q("missed-pickup")).toBeNull();
    h.cleanup();
    h = harness();
    const b = seededBooking(9105, "chef"); // window over
    const missed: BookingDetail = {
      ...b,
      status: "no_show_customer",
      noShow: {
        reportedAt: new Date().toISOString(),
        dayNumber: 1,
        pickupMissed: true,
      },
    };
    await open(b, {
      [`POST /api/bookings/${b.id}/pickup/missed`]: json(200, missed),
    });
    expect(h.q("missed-pickup")).not.toBeNull();
    await h.click(h.button("Mark pickup missed"));
    expect(callsTo(h.fetchMock, "/pickup/missed")).toHaveLength(0);
    expect(h.text()).toContain("You cannot undo it");
    expect(document.activeElement?.textContent).toContain(
      "Mark the pickup as missed?",
    );
    await h.click(h.button("Yes, mark pickup missed"));
    expect(callsTo(h.fetchMock, "/pickup/missed")).toHaveLength(1);
    expect(h.q("status")?.textContent).toContain("customer no-show");
    expect(h.q("no-show")?.textContent).toContain("pickup as missed");
  });

  it("explains a refusal because the window is still open", async () => {
    const b = seededBooking(9105, "chef");
    await open(b, {
      [`POST /api/bookings/${b.id}/pickup/missed`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        {
          reason: "pickup_window_open",
        },
      ),
    });
    await h.click(h.button("Mark pickup missed"));
    await h.click(h.button("Yes, mark pickup missed"));
    const alert = h.host.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("can still pick up");
    expect(document.activeElement).toBe(alert);
  });
});

describe("states", () => {
  it("a 404 is the same not-found page", async () => {
    routes(h.fetchMock, {
      [`GET /api/bookings/${SEED_ID(1)}`]: apiError(
        404,
        "NOT_FOUND",
        "Booking not found.",
      ),
    });
    await h.mount(<ChefBookingView id={SEED_ID(1)} />);
    expect(h.q("not-found")).not.toBeNull();
  });
  it("a server error offers Try again", async () => {
    routes(h.fetchMock, {
      [`GET /api/bookings/${SEED_ID(2)}`]: apiError(
        500,
        "INTERNAL",
        "Something went wrong.",
      ),
    });
    await h.mount(<ChefBookingView id={SEED_ID(2)} />);
    expect(h.q("load-error")).not.toBeNull();
    expect(h.button("Try again")).not.toBeNull();
  });
  it("a declined request shows the reason and no controls", async () => {
    const b = seededBooking(9101, "chef", (x) => ({
      ...x,
      status: "declined",
      declineReason: "Away that week",
    }));
    await open(b);
    expect(h.q("declined")?.textContent).toContain("Away that week");
    expect(h.q("answer")).toBeNull();
    expect(h.q("groceries")).toBeNull(); // nothing to shop for a declined request
  });
  it("uses dates relative to today (guards the seed)", () => {
    const b = seededBooking(9104, "chef");
    expect(b.days[0].date).toBe(torontoToday());
    expect(b.days[1].date).toBe(addDays(torontoToday(), 1));
  });
});
