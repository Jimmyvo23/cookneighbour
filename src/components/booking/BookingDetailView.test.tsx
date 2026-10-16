// @vitest-environment jsdom
// T-043: the customer's booking page against a stubbed network. It must show exactly what the API
// sent: no address or phone before acceptance, the system-cancel wording, the decline reason, the
// expiry. All data is made up.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingDetail } from "@/lib/api/types";
import { addDays, torontoToday } from "@/lib/domain/dishes";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

import { BookingDetailView } from "@/components/booking/BookingDetailView";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "00000000-0000-4000-8000-0000000000b1";

function booking(over: Partial<BookingDetail> = {}): BookingDetail {
  return {
    id: ID,
    status: "requested",
    viewerRole: "customer",
    locationType: "chef_home",
    groceryOption: "customer_buys",
    isFreeTrial: true,
    createdAt: "2030-01-01T15:00:00Z",
    expiresAt: "2030-01-04T15:00:00Z",
    respondedAt: null,
    declineReason: null,
    cancelledBy: null,
    cancelledAt: null,
    cancellationTiming: null,
    cancelReason: null,
    completedAt: null,
    noShow: null,
    frozen: false,
    chef: { id: "c1", displayName: "Mai", photoPath: null },
    customer: { id: "u1", displayName: "Sam" },
    days: [
      {
        dayNumber: 1,
        date: "2030-01-20",
        cookMinutes: 180,
        cookedAt: null,
        pickedUpAt: null,
        pickupDeadlineDate: "2030-01-22",
        pickups: [],
        dishes: [
          {
            dishId: "d1",
            name: "Pho bo",
            quantity: 1,
            cookMinutes: 180,
            ingredientCostCents: 2200,
            servings: 4,
            allergens: ["soy"],
            eatByDate: "2030-01-22",
          },
        ],
      },
    ],
    estimate: {
      cookMinutes: 180,
      labourCents: 0,
      ingredientsCents: 2200,
      travelCents: 0,
      platformFeeCents: 0,
      platformFeePercent: 10,
      platformFeeCollected: false,
      totalCents: 2200,
      currency: "CAD",
      travelRateCentsPerKm: 60,
      distanceKm: null,
    },
    intake: {
      allergies: "None",
      dietaryNotes: "None",
      allergyConflictAcknowledged: false,
    },
    allergyConflicts: [],
    cookingPlace: null,
    contact: null,
    payment: { mock: true, collected: false },
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let mounts = 0; // a new key remounts the view, so it loads again

const reply = (status: number, body: unknown) => () =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

async function mount() {
  await act(async () => {
    root.render(<BookingDetailView key={++mounts} id={ID} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}
const text = () => host.textContent ?? "";
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`);

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("BookingDetailView", () => {
  it("asks for the booking by id with a GET and shows a waiting request with its expiry", async () => {
    fetchMock.mockImplementation(reply(200, booking()));
    await mount();
    // The booking is read once; the groceries section (T-045) reads its own list next to it.
    expect(
      fetchMock.mock.calls.filter((c) => c[0] === `/api/bookings/${ID}`),
    ).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/bookings/${ID}`);
    expect(init.method).toBe("GET");
    expect(q("status")?.textContent).toContain(
      "Waiting for the chef to answer",
    );
    expect(q("expires")?.textContent).toContain("The chef has until");
    expect(q("expires")?.textContent).toContain(
      "your free first booking is kept",
    );
    expect(q("trial-label")).not.toBeNull();
    expect(q("mock-payment")).not.toBeNull();
  });

  it("says the kitchen address and phone come after acceptance, and shows neither", async () => {
    fetchMock.mockImplementation(reply(200, booking()));
    await mount();
    expect(q("kitchen-later")?.textContent).toContain("once the chef accepts");
    expect(q("contact-later")).not.toBeNull();
    expect(q("cooking-place")).toBeNull();
    expect(q("contact")).toBeNull();
    expect(text()).not.toMatch(/\+1\d{10}/);
  });

  it.each(["declined", "expired", "cancelled"] as const)(
    "a %s booking never promises an address or phone 'once the chef accepts'",
    async (status) => {
      fetchMock.mockImplementation(reply(200, booking({ status })));
      await mount();
      expect(q("kitchen-later")?.textContent).toContain(
        "not shown for this booking",
      );
      expect(q("contact-later")?.textContent).toContain(
        "not shown for this booking",
      );
      expect(text()).not.toMatch(/once the chef accepts|only after the chef/);
    },
  );

  it("still says the phone is shared after the chef accepts while the request waits", async () => {
    fetchMock.mockImplementation(reply(200, booking()));
    await mount();
    expect(q("contact-later")?.textContent).toContain(
      "shared only after the chef accepts",
    );
  });

  it("does not talk about the chef's kitchen for a booking at the customer's home", async () => {
    fetchMock.mockImplementation(
      reply(
        200,
        booking({ locationType: "customer_home", cookingPlace: null }),
      ),
    );
    await mount();
    expect(q("kitchen-later")?.textContent).not.toContain("kitchen");
  });

  it("shows the kitchen and the chef's phone once the API sends them", async () => {
    fetchMock.mockImplementation(
      reply(
        200,
        booking({
          status: "accepted",
          cookingPlace: {
            line: "12 Kitchen Rd",
            city: "Toronto",
            postalCode: "M4K1A1",
          },
          contact: { displayName: "Mai", phone: "+14165550100" },
        }),
      ),
    );
    await mount();
    expect(q("cooking-place")?.textContent).toContain("12 Kitchen Rd");
    expect(q("contact")?.textContent).toContain("+14165550100");
    expect(q("kitchen-later")).toBeNull();
  });

  it("renders every API text as plain text, not markup", async () => {
    const evil = `<img src=x onerror="window.__pwned=1">`;
    fetchMock.mockImplementation(
      reply(
        200,
        booking({
          status: "declined",
          declineReason: evil,
          chef: { id: "c1", displayName: evil, photoPath: null },
        }),
      ),
    );
    await mount();
    expect(host.querySelector("img")).toBeNull();
    expect(q("declined")?.textContent).toContain(evil);
  });

  it("words a declined, an expired and a chef-removed (system) booking", async () => {
    fetchMock.mockImplementation(
      reply(200, booking({ status: "declined", declineReason: "I am away" })),
    );
    await mount();
    expect(q("declined")?.textContent).toContain("I am away");
    expect(q("declined")?.textContent).toContain("Nothing was charged");

    fetchMock.mockImplementation(reply(200, booking({ status: "expired" })));
    await mount();
    expect(q("expired")?.textContent).toContain("did not answer in time");

    fetchMock.mockImplementation(
      reply(
        200,
        booking({
          status: "cancelled",
          cancelledBy: "system",
          cancellationTiming: null,
        }),
      ),
    );
    await mount();
    expect(q("cancelled")?.textContent).toContain(
      "can no longer take bookings on CookNeighbour",
    );
    expect(q("cancelled")?.textContent).not.toContain("You cancelled");
    // The system cancel is not a late or on-time cancellation by the customer.
    expect(q("cancel-timing")).toBeNull();
    // No cancel button on a finished booking.
    expect(host.textContent).not.toContain("Yes, cancel this booking");
  });

  it("explains the free trial after a customer cancel: released before cooking, used after", async () => {
    const cancelled = booking({
      status: "cancelled",
      cancelledBy: "customer",
      cancellationTiming: "late",
    });
    fetchMock.mockImplementation(reply(200, cancelled));
    await mount();
    expect(q("cancel-timing")?.textContent).toContain("late cancellation");
    expect(q("trial-after-cancel")?.textContent).toContain("not used up");

    const cooked = booking({
      ...cancelled,
      days: cancelled.days.map((d) => ({
        ...d,
        cookedAt: "2030-01-20T18:00:00Z",
      })),
    });
    fetchMock.mockImplementation(reply(200, cooked));
    await mount();
    expect(q("trial-after-cancel")?.textContent).toContain("counts as used");
  });

  it("shows not found for a 404 and a retry for a server error", async () => {
    fetchMock.mockImplementation(
      reply(404, {
        error: { code: "NOT_FOUND", message: "Booking not found." },
      }),
    );
    await mount();
    expect(q("not-found")).not.toBeNull();

    fetchMock.mockImplementation(
      reply(500, { error: { code: "INTERNAL", message: "Oops" } }),
    );
    await mount();
    expect(q("load-error")).not.toBeNull();
  });

  describe("T-072: waiting for a check and chef no-show wording", () => {
    const accepted = (dayOffsets: number[], cooked: boolean[] = []) => {
      const base = booking({ status: "accepted" });
      return booking({
        status: "accepted",
        days: dayOffsets.map((o, i) => ({
          ...base.days[0],
          dayNumber: i + 1,
          date: addDays(torontoToday(), o),
          cookedAt: cooked[i] ? "2030-01-20T18:00:00Z" : null,
        })),
      });
    };

    it("shows a neutral 'waiting for a check' when every day is past and none is cooked", async () => {
      fetchMock.mockImplementation(reply(200, accepted([-3, -2])));
      await mount();
      const note = q("waiting-check")?.textContent ?? "";
      expect(note).toContain("waiting for a check");
      expect(note).not.toMatch(/refund|cancel|no-show|admin|free first/i);
    });

    it("does not show it for an upcoming, current or partly cooked booking", async () => {
      for (const b of [
        accepted([1, 2]),
        accepted([-1, 0]),
        accepted([-2, -1], [true, false]),
      ]) {
        fetchMock.mockImplementation(reply(200, b));
        await mount();
        expect(q("waiting-check")).toBeNull();
      }
    });

    it("a chef no-show after a cooked day says the free first booking counts as used", async () => {
      fetchMock.mockImplementation(
        reply(
          200,
          booking({
            ...accepted([-2, -1], [true, false]),
            status: "no_show_chef",
            noShow: {
              reportedAt: "2030-01-21T10:00:00Z",
              dayNumber: 2,
              pickupMissed: false,
            },
          }),
        ),
      );
      await mount();
      expect(q("trial-after-no-show")?.textContent).toContain("counts as used");
    });

    it("a chef no-show with no cooked day says the free first booking is not used up", async () => {
      fetchMock.mockImplementation(
        reply(
          200,
          booking({
            ...accepted([-1]),
            status: "no_show_chef",
            noShow: {
              reportedAt: "2030-01-21T10:00:00Z",
              dayNumber: 1,
              pickupMissed: false,
            },
          }),
        ),
      );
      await mount();
      expect(q("trial-after-no-show")?.textContent).toContain("not used up");
      expect(text()).not.toMatch(/always|given back/i);
    });

    it("says nothing about the free booking for a chef no-show on a paid booking", async () => {
      fetchMock.mockImplementation(
        reply(
          200,
          booking({
            ...accepted([-1]),
            isFreeTrial: false,
            status: "no_show_chef",
          }),
        ),
      );
      await mount();
      expect(q("trial-after-no-show")).toBeNull();
    });
  });
});
