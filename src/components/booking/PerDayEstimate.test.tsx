// @vitest-environment jsdom
// T-043 round 2, D-39: the per-day estimate breakdown shows exactly the days the estimate API sent.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { PerDayEstimate } from "@/components/booking/BookingFlow";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const days = [
  {
    date: "2030-01-12",
    cookMinutes: 60,
    labourCents: 2000,
    ingredientsCents: 1500,
    travelCents: 100,
    platformFeeCents: 200,
  },
  {
    date: "2030-01-10",
    cookMinutes: 180,
    labourCents: 6000,
    ingredientsCents: 3300,
    travelCents: 100,
    platformFeeCents: 600,
  },
];

let root: Root | null = null;
let host: HTMLElement | null = null;
function render(props: Parameters<typeof PerDayEstimate>[0]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<PerDayEstimate {...props} />));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("PerDayEstimate (D-39)", () => {
  it("lists each day by date with cooking time, labour and ingredients", () => {
    const el = render({ days, freeTrial: false, location: "customer_home" });
    const rows = el.querySelectorAll('[data-testid="per-day-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Day 1");
    expect(rows[0].textContent).toContain("3 h");
    expect(rows[0].textContent).toContain("$60.00");
    expect(rows[0].textContent).toContain("$33.00");
    expect(rows[1].textContent).toContain("Day 2");
    expect(rows[1].textContent).toContain("$20.00");
    expect(el.textContent).toContain("Travel is charged for each visit");
  });

  it("under the free trial each day shows $0.00 labour and the caption says why", () => {
    // Realistic API data: with the free trial days[].labourCents is already 0 (pricing.ts).
    const freeDays = days.map((d) => ({ ...d, labourCents: 0 }));
    const el = render({
      days: freeDays,
      freeTrial: true,
      location: "chef_home",
    });
    const rows = el.querySelectorAll('[data-testid="per-day-row"]');
    expect(rows[0].textContent).toContain("Labour$0.00");
    expect(rows[1].textContent).toContain("Labour$0.00");
    expect(el.textContent).toContain("Labour is free on this first booking");
    expect(el.textContent).toContain("waived labour is in the totals above");
    expect(el.textContent).not.toContain("before the free first booking");
    expect(el.textContent).toContain("No travel fee");
  });

  it("renders nothing without days", () => {
    const el = render({ days: [], freeTrial: false, location: "chef_home" });
    expect(el.textContent).toBe("");
  });
});
