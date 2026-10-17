// @vitest-environment jsdom
// T-043 round 4: "Waiting now" must come from the status=requested query (the same one as the
// D-40 form warning), not from counting the first page of bookings of every status.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addDays, torontoToday } from "@/lib/domain/dishes";
import { BookingList } from "@/components/booking/BookingList";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const item = (i: number, status: string) => ({
  id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
  status,
  locationType: "customer_home",
  isFreeTrial: false,
  firstDay: "2030-01-10",
  dates: ["2030-01-10"],
  groceryOption: "customer_buys",
  createdAt: "2030-01-01T00:00:00Z",
  expiresAt: null,
  totalCents: 1000,
  currency: "CAD",
  counterparty: { id: "c1", displayName: "Mai", photoPath: null },
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("BookingList waiting count", () => {
  it("counts requested bookings from the requested query, not the first page", async () => {
    // The first page holds 20 older bookings of other statuses; 3 requested ones are on page 2.
    const page = Array.from({ length: 20 }, (_, i) => item(i, "completed"));
    const requested = [1, 2, 3].map((i) => item(50 + i, "requested"));
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            items: url.includes("status=requested") ? requested : page,
            nextCursor: url.includes("status=requested") ? null : "next",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(<BookingList />);
    });
    await act(async () => {});
    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).includes("status=requested"),
      ),
    ).toBe(true);
    expect(host.textContent).toContain("Waiting now: 3");
  });
});

describe("BookingList accepted booking with every date past (T-072)", () => {
  it("does not call it upcoming; it points to the booking page", async () => {
    const past = {
      ...item(1, "accepted"),
      dates: [addDays(torontoToday(), -2)],
    };
    const future = {
      ...item(2, "accepted"),
      dates: [addDays(torontoToday(), 2)],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ items: [past, future], nextCursor: null }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      ),
    );
    await act(async () => {
      root.render(<BookingList />);
    });
    await act(async () => {});
    const rows = host.querySelectorAll('[data-testid="booking-item"]');
    expect(rows[0].textContent).toContain("All visit days have passed");
    expect(rows[1].textContent).not.toContain("All visit days have passed");
  });
});

describe("BookingList On hold marker (T-082)", () => {
  it("marks a frozen row and only that row", async () => {
    const t = torontoToday();
    const held = {
      ...item(1, "accepted"),
      dates: [addDays(t, 2)],
      frozen: true,
    };
    const free = {
      ...item(2, "accepted"),
      dates: [addDays(t, 3)],
      frozen: false,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ items: [held, free], nextCursor: null }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      ),
    );
    await act(async () => {
      root.render(<BookingList />);
    });
    await act(async () => {});
    const rows = host.querySelectorAll('[data-testid="booking-item"]');
    expect(rows).toHaveLength(2);
    const marker = rows[0].querySelector('[data-testid="on-hold"]');
    expect(marker?.textContent).toBe("On hold");
    expect(rows[1].querySelector('[data-testid="on-hold"]')).toBeNull();
    expect(rows[1].textContent).not.toContain("On hold");
  });
});
