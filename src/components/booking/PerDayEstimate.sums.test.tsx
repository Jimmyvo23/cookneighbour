// @vitest-environment jsdom
// T-043 round 2 (Tester), D-39: the per-day rows come from the real pricing output and add up to the totals.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { PerDayEstimate } from "@/components/booking/BookingFlow";
import { estimateBooking } from "@/lib/domain/pricing";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const dish = (
  cookMinutes: number,
  ingredientCostCents: number,
  quantity = 1,
) => ({
  cookMinutes,
  ingredientCostCents,
  quantity,
});

function est(nDays: number, isFreeTrial: boolean) {
  const all = [
    [dish(90, 1234), dish(45, 801, 2)],
    [dish(200, 2500)],
    [dish(31, 333, 3)],
  ].slice(0, nDays);
  return estimateBooking({
    hourlyRateCents: 2850,
    locationType: "customer_home",
    distanceMetres: 12345,
    isFreeTrial,
    days: all.map((dishes) => ({ dishes })),
  } as never);
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe.each([1, 2, 3])("per-day numbers, %i day booking", (n) => {
  it.each([false, true])("add up to the totals (free trial %s)", (trial) => {
    const e = est(n, trial);
    const sum = (k: "cookMinutes" | "labourCents" | "ingredientsCents") =>
      e.days.reduce((s, d) => s + d[k], 0);
    expect(e.days).toHaveLength(n);
    expect(sum("cookMinutes")).toBe(e.cookMinutes);
    expect(sum("labourCents")).toBe(e.labourCents);
    expect(sum("ingredientsCents")).toBe(e.ingredientsCents);

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <PerDayEstimate
          days={e.days.map((d, i) => ({ ...d, date: `2030-01-1${i}` }))}
          freeTrial={trial}
          location="customer_home"
        />,
      ),
    );
    expect(host.querySelectorAll('[data-testid="per-day-row"]')).toHaveLength(
      n,
    );
  });
});

// Documents what the API sends today: with the free trial the per-day labour is already 0.
// PerDayEstimate's caption says it is "before the free first booking" (bug reported in the handoff).
it("API days[].labourCents is 0 under the free trial (waived amount only in the totals)", () => {
  const e = est(2, true);
  expect(e.days.every((d) => d.labourCents === 0)).toBe(true);
  expect(e.freeTrialWaivedCents).toBeGreaterThan(0);
});
