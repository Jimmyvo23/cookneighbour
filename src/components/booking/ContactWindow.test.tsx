// @vitest-environment jsdom
// T-073: the D-52 contact window on both booking pages. The server hides phone and address 7 days
// after the last visit day (cancelled bookings lock at once, D-56); the pages must say so, show
// `contactVisibleUntil` in Toronto time, and say "hidden now" after the cut-off. Dates are relative
// to the Toronto calendar day. All data is made up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingDetail } from "@/lib/api/types";
import { addDays, torontoToday } from "@/lib/domain/dishes";
import { torontoStartOfDay } from "@/lib/domain/cancellation";
import {
  harness,
  json,
  routes,
  seededBooking,
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

const emptyShopping = (b: BookingDetail) => ({
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
});

async function open(b: BookingDetail, role: "chef" | "customer") {
  routes(h.fetchMock, {
    [`GET /api/bookings/${b.id}`]: json(200, b),
    [`GET /api/bookings/${b.id}/shopping-list`]: json(200, emptyShopping(b)),
    [`GET /api/bookings/${b.id}/receipts`]: json(200, {
      bookingId: b.id,
      groceryOption: b.groceryOption,
      estimatedIngredientsCents: 0,
      currency: "CAD",
      items: [],
    }),
  });
  await h.mount(
    role === "chef" ? (
      <ChefBookingView id={b.id} />
    ) : (
      <BookingDetailView id={b.id} />
    ),
  );
}

/** A chef's-home booking whose only visit day is `offset` days from today (Toronto). */
function chefHome(
  n: 9103 | 9104,
  role: "chef" | "customer",
  status: BookingDetail["status"],
  offset: number,
  hidden: boolean,
): BookingDetail {
  return seededBooking(n, role, (b) => {
    const date = addDays(torontoToday(), offset);
    const until = torontoStartOfDay(addDays(date, 8)).toISOString();
    return {
      ...b,
      status,
      days: [{ ...b.days[0], date }],
      contactVisibleUntil: hidden ? null : until,
      contact: hidden ? null : b.contact,
      cookingPlace:
        hidden && (role === "chef" || b.locationType === "chef_home")
          ? null
          : b.cookingPlace,
    };
  });
}

const RULE = "hidden 7 days after the last visit day";

describe.each(["customer", "chef"] as const)("%s page", (role) => {
  it("explains the 7-day window and shows the cut-off in Toronto time while contact is visible", async () => {
    const b = chefHome(9103, role, "completed", -1, false);
    await open(b, role);
    const note = h.q("contact-window")?.textContent ?? "";
    expect(note).toContain("Visible until");
    expect(note).toContain("Toronto time");
    expect(note).toContain(RULE);
    expect(note).toContain("Chat stays open.");
    expect(note).toContain("Visible until the end of");
    expect(h.q("contact")).not.toBeNull();
    expect(h.q("contact-later")).toBeNull();
  });

  it("says 'Contact details are hidden now' after the cut-off, for each finished status", async () => {
    for (const status of [
      "accepted",
      "completed",
      "no_show_customer",
      "no_show_chef",
    ] as const) {
      h.cleanup();
      h = harness();
      await open(chefHome(9103, role, status, -9, true), role);
      const later = h.q("contact-later")?.textContent ?? "";
      expect(later).toContain("Contact details are hidden now");
      expect(later).toContain(RULE);
      expect(h.q("contact-window")).toBeNull();
      expect(h.q("contact")).toBeNull();
      expect(h.text()).not.toMatch(
        /not shared yet|once (you|the chef) accepts?/,
      );
    }
  });

  it("a cancelled booking locks at once and promises no window", async () => {
    const b = chefHome(9103, role, "cancelled", 3, true);
    await open(b, role);
    const later = h.q("contact-later")?.textContent ?? "";
    expect(later).toContain("locked when a booking is cancelled");
    expect(later).not.toMatch(/Visible until|7 days|hidden now/);
    expect(h.q("contact-window")).toBeNull();
  });

  it("a waiting request promises no window either", async () => {
    await open(
      seededBooking(9101, role, (b) => ({
        ...b,
        contact: null,
        cookingPlace: role === "chef" ? null : b.cookingPlace,
      })),
      role,
    );
    expect(h.q("contact-window")).toBeNull();
    expect(h.q("contact-later")?.textContent ?? "").not.toMatch(
      /7 days|hidden now|Visible until/,
    );
  });
});

describe("chef kitchen note (chef's home)", () => {
  it("accepted: the customer sees the address only until 7 days after the last day", async () => {
    await open(chefHome(9103, "chef", "accepted", 1, false), "chef");
    const n = h.q("kitchen-note")?.textContent ?? "";
    expect(n).toContain("can now see your kitchen address");
    expect(n).toContain("7 days after the last visit day");
    expect(n).toContain("locked");
  });
  it("accepted after the cut-off: says the customer can no longer see it, still locked", async () => {
    await open(chefHome(9103, "chef", "accepted", -9, true), "chef");
    const n = h.q("kitchen-note")?.textContent ?? "";
    expect(n).toContain("can no longer see your kitchen address");
    expect(n).toContain("locked");
    expect(n).not.toContain("can now see");
  });
  it("completed after the cut-off: no promise that the customer can still see it", async () => {
    await open(chefHome(9103, "chef", "completed", -9, true), "chef");
    const n = h.q("kitchen-note")?.textContent ?? "";
    expect(n).toContain("can no longer see your kitchen address");
    expect(n).not.toContain("can still see");
  });
});

describe("customer page after the cut-off", () => {
  it("says the chef's kitchen address is hidden now, but still shows the customer's own address", async () => {
    await open(chefHome(9103, "customer", "completed", -9, true), "customer");
    expect(h.q("kitchen-later")?.textContent).toContain("hidden now");
    await h.cleanup();
    h = harness();
    await open(chefHome(9104, "customer", "completed", -9, true), "customer");
    expect(h.q("cooking-place")?.textContent).toContain("Maple Ave");
  });
});

describe("customer Cancel button (T-072 L-B)", () => {
  it("is shown while a visit is left (today or later)", async () => {
    for (const offset of [0, 2]) {
      h.cleanup();
      h = harness();
      await open(
        chefHome(9103, "customer", "accepted", offset, false),
        "customer",
      );
      expect(h.button("Cancel this booking")).not.toBeNull();
    }
  });
  it("is hidden when every visit day is past", async () => {
    await open(chefHome(9103, "customer", "accepted", -1, false), "customer");
    expect(h.button("Cancel this booking")).toBeNull();
  });
  it("is still shown for a waiting request", async () => {
    await open(seededBooking(9101, "customer"), "customer");
    expect(h.button("Cancel this booking")).not.toBeNull();
  });
});

describe("chef mark-cooked prompt wording (T-072 NIT)", () => {
  it("says 'Mark them' for several days and 'Mark it' for one", async () => {
    await open(
      seededBooking(9104, "chef", (b) => ({
        ...b,
        status: "accepted",
        days: b.days.map((d, i) => ({
          ...d,
          date: addDays(torontoToday(), -3 + i),
          cookedAt: null,
        })),
      })),
      "chef",
    );
    const many = h.q("mark-cooked-prompt")?.textContent ?? "";
    expect(many).toContain("Mark them as cooked");
    h.cleanup();
    h = harness();
    await open(
      seededBooking(9104, "chef", (b) => ({
        ...b,
        status: "accepted",
        days: [
          { ...b.days[0], date: addDays(torontoToday(), -2), cookedAt: null },
          {
            ...b.days[1],
            date: addDays(torontoToday(), 3),
            cookedAt: null,
          },
        ],
      })),
      "chef",
    );
    expect(h.q("mark-cooked-prompt")?.textContent).toContain(
      "Mark it as cooked",
    );
  });
});
