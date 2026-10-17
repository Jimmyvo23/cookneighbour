// @vitest-environment jsdom
// T-072: an accepted booking whose visit dates are all past is not shown as upcoming.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, torontoToday } from "@/lib/domain/dishes";
import { ChefBookingList } from "@/components/booking/ChefBookingList";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const item = (i: number, status: string, dates: string[]) => ({
  id: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, "0")}`,
  status,
  locationType: "customer_home",
  isFreeTrial: false,
  firstDay: dates[0],
  dates,
  groceryOption: "customer_buys",
  createdAt: "2030-01-01T00:00:00Z",
  expiresAt: null,
  totalCents: 1000,
  currency: "CAD",
  counterparty: { id: "u1", displayName: "Sam", photoPath: null },
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

describe("ChefBookingList accepted booking with every date past", () => {
  it("says the visit days have passed, and only for that booking", async () => {
    const t = torontoToday();
    const items = [
      item(1, "accepted", [addDays(t, -2)]),
      item(2, "accepted", [addDays(t, 2)]),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ items, nextCursor: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );
    await act(async () => {
      root.render(<ChefBookingList />);
    });
    await act(async () => {});
    const rows = host.querySelectorAll('[data-testid="booking-item"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("All visit days have passed");
    expect(rows[1].textContent).not.toContain("All visit days have passed");
  });
});

describe("ChefBookingList On hold marker (T-082)", () => {
  it("marks a frozen row and only that row", async () => {
    const t = torontoToday();
    const items = [
      { ...item(1, "accepted", [addDays(t, 2)]), frozen: true },
      { ...item(2, "accepted", [addDays(t, 3)]), frozen: false },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ items, nextCursor: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );
    await act(async () => {
      root.render(<ChefBookingList />);
    });
    await act(async () => {});
    const rows = host.querySelectorAll('[data-testid="booking-item"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('[data-testid="on-hold"]')?.textContent).toBe(
      "On hold",
    );
    expect(rows[1].querySelector('[data-testid="on-hold"]')).toBeNull();
    // Link text (what a screen reader hears when browsing links) carries it too.
    expect(rows[0].querySelector("a")?.textContent).toContain(
      ", booking, on hold",
    );
    expect(rows[1].querySelector("a")?.textContent).not.toContain("on hold");
  });
});
