// @vitest-environment jsdom
// T-072 Tester: the customer's Cancel on a booking that is waiting for a check. The server answers
// 409 nothing_left; the page must show a worded message and stay on the booking. All data is made up.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, torontoToday } from "@/lib/domain/dishes";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));
import { BookingDetailView } from "@/components/booking/BookingDetailView";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const day = (n: number, offset: number) => ({
  dayNumber: n,
  date: addDays(torontoToday(), offset),
  cookMinutes: 60,
  cookedAt: null,
  pickupDeadlineDate: null,
  pickups: [],
  dishes: [],
});
const waiting = {
  id: "00000000-0000-4000-8000-0000000000b2",
  status: "accepted",
  viewerRole: "customer",
  locationType: "customer_home",
  groceryOption: "customer_buys",
  isFreeTrial: true,
  createdAt: "2030-01-01T15:00:00Z",
  expiresAt: null,
  respondedAt: "2030-01-01T16:00:00Z",
  declineReason: null,
  cancelledBy: null,
  cancelledAt: null,
  cancellationTiming: null,
  cancelReason: null,
  completedAt: null,
  noShow: null,
  chef: { id: "c1", displayName: "Mai", photoPath: null },
  customer: { id: "u1", displayName: "Sam" },
  days: [day(1, -3), day(2, -2)],
  estimate: {
    cookMinutes: 120,
    labourCents: 0,
    ingredientsCents: 0,
    travelCents: 0,
    platformFeeCents: 0,
    platformFeePercent: 10,
    platformFeeCollected: false,
    totalCents: 0,
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
};

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const click = async (el: Element | undefined | null) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
};

describe("T-072 tester: customer Cancel on a waiting booking", () => {
  it("hides the Cancel button when every visit day is past (T-073)", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, waiting)));
    await act(async () => {
      root.render(<BookingDetailView id={waiting.id} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="waiting-check"]')).not.toBeNull();
    const open = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Cancel this booking",
    );
    expect(open).toBeUndefined();
  });

  // The page can stay open past midnight, so the server may still refuse: the refusal stays worded.
  it("shows a worded refusal for nothing_left (stale page)", async () => {
    const stale = { ...waiting, days: [day(1, 1)] };
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "POST" && /cancel/.test(url)
          ? json(409, {
              error: {
                code: "INVALID_STATE",
                message: "raw server text",
                reason: "nothing_left",
              },
            })
          : /receipts|groceries/.test(url)
            ? json(200, { items: [] })
            : json(200, stale),
      ),
    );
    await act(async () => {
      root.render(<BookingDetailView id={waiting.id} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const open = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Cancel this booking",
    );
    await click(open);
    const yes = [...host.querySelectorAll("button")].find((b) =>
      /Yes, cancel/.test(b.textContent ?? ""),
    );
    await click(yes);
    const alerts = [...host.querySelectorAll('[role="alert"]')].map(
      (a) => a.textContent,
    );
    // The page appends one sentence about its own state after the refetch (T-083 round 2).
    expect(alerts).toContain(
      "There is no visit left to cancel. This page shows its current status.",
    );
    expect(host.textContent).not.toContain("raw server text");
  });
});
