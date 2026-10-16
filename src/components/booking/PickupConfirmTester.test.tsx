// @vitest-environment jsdom
// T-071 tester gaps: several days with one confirmed, the "Not yet" focus, a double press, the
// deadline passing with one day confirmed, and a stale chef page after a customer confirm.
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BookingDetail } from "@/lib/api/types";
import {
  ChefPickups,
  CustomerPickups,
} from "@/components/booking/PickupSections";
import {
  apiError,
  callsTo,
  harness,
  json,
  routes,
  seededBooking,
  type Harness,
} from "@/components/booking/testkit";

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

function Page({
  start,
  chef = false,
}: {
  start: BookingDetail;
  chef?: boolean;
}) {
  const [b, setB] = useState(start);
  return chef ? (
    <ChefPickups booking={b} onChange={setB} />
  ) : (
    <CustomerPickups booking={b} onChange={setB} />
  );
}
const url = (b: BookingDetail, n: number) =>
  `/api/bookings/${b.id}/days/${n}/pickup/confirm`;

/** Two cooked days, both past their deadline (booking 9105), day 1 confirmed. */
function twoDays(role: "chef" | "customer", confirmed: number[]) {
  return seededBooking(9105, role, (x) => {
    const d1 = { ...x.days[0], pickups: [] };
    const d2 = { ...d1, dayNumber: 2 };
    return {
      ...x,
      days: [d1, d2].map((d) => ({
        ...d,
        pickedUpAt: confirmed.includes(d.dayNumber)
          ? "2026-10-20T20:00:00.000Z"
          : null,
      })),
    };
  });
}

describe("customer, two days, one confirmed", () => {
  it("shows the line for day 1 and a day-labelled button only for day 2, even past the deadline", async () => {
    await h.mount(<Page start={twoDays("customer", [1])} />);
    expect(h.qa("picked-up")).toHaveLength(1);
    expect(h.button("I picked up day 1's meals")).toBeNull();
    expect(h.button("I picked up day 2's meals")).not.toBeNull();
    // Not everything is confirmed, so the warning stays.
    expect(h.q("pickup-missed-warning")).not.toBeNull();
  });

  it("confirming day 2 posts to day 2 only and asks about day 2", async () => {
    const b = twoDays("customer", [1]);
    const after: BookingDetail = {
      ...b,
      days: b.days.map((d) => ({
        ...d,
        pickedUpAt: "2026-10-20T20:00:00.000Z",
      })),
    };
    routes(h.fetchMock, { [`POST ${url(b, 2)}`]: json(200, after) });
    await h.mount(<Page start={b} />);
    await h.click(h.button("I picked up day 2's meals"));
    expect(h.text()).toContain("Confirm that you picked up day 2's meals?");
    await h.click(h.button("Yes, I picked them up"));
    expect(callsTo(h.fetchMock, url(b, 2))).toHaveLength(1);
    expect(callsTo(h.fetchMock, url(b, 1))).toHaveLength(0);
    expect(h.qa("picked-up")).toHaveLength(2);
    expect(h.q("pickup-missed-warning")).toBeNull();
  });

  it("'Not yet' closes the step, sends nothing and returns focus to the opener", async () => {
    const b = twoDays("customer", []);
    await h.mount(<Page start={b} />);
    const opener = h.button("I picked up day 1's meals")!;
    await h.click(opener);
    await h.click(h.button("Not yet"));
    expect(h.text()).not.toContain("This can't be undone");
    expect(callsTo(h.fetchMock, url(b, 1))).toHaveLength(0);
    expect(document.activeElement).toBe(h.button("I picked up day 1's meals"));
  });

  it("a 409 in the confirm step keeps the step open for a retry", async () => {
    const b = twoDays("customer", []);
    routes(h.fetchMock, {
      [`POST ${url(b, 1)}`]: apiError(409, "INVALID_STATE", "x", {
        reason: "frozen",
      }),
    });
    await h.mount(<Page start={b} />);
    await h.click(h.button("I picked up day 1's meals"));
    await h.click(h.button("Yes, I picked them up"));
    expect(h.button("Yes, I picked them up")).not.toBeNull();
    expect(h.qa("picked-up")).toHaveLength(0);
  });
});

describe("chef, two days", () => {
  it("one confirmed and one unconfirmed past-deadline day still offers 'pickup missed'", async () => {
    await h.mount(<Page start={twoDays("chef", [1])} chef />);
    expect(h.qa("picked-up")).toHaveLength(1);
    expect(h.q("missed-pickup")).not.toBeNull();
  });

  it("both confirmed hides it", async () => {
    await h.mount(<Page start={twoDays("chef", [1, 2])} chef />);
    expect(h.qa("picked-up")).toHaveLength(2);
    expect(h.q("missed-pickup")).toBeNull();
  });

  it("the history of a confirmed day reads 'closed because the customer picked up the meals'", async () => {
    const b = seededBooking(9103, "chef", (x) => ({
      ...x,
      days: x.days.map((d) => ({
        ...d,
        pickedUpAt: "2026-10-20T20:00:00.000Z",
        pickups: d.pickups.map((p) => ({ ...p, status: "void" as const })),
      })),
    }));
    await h.mount(<Page start={b} chef />);
    const t = h.q("pickup-history")?.textContent ?? "";
    expect(t).toContain("closed because the customer picked up the meals");
    expect(t).not.toContain("no answer before");
  });

  it("stale page: after the 409 the alert has the pickup_confirmed text and focus", async () => {
    const b = twoDays("chef", []);
    routes(h.fetchMock, {
      [`POST /api/bookings/${b.id}/pickup/missed`]: apiError(
        409,
        "INVALID_STATE",
        "server",
        { reason: "pickup_confirmed" },
      ),
    });
    await h.mount(<Page start={b} chef />);
    await h.click(h.button("Mark pickup missed"));
    await h.click(h.button("Yes, mark pickup missed"));
    const alert = h
      .q("missed-pickup")!
      .querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toMatch(/confirmed they picked up/);
    expect(document.activeElement).toBe(alert);
    expect(
      callsTo(h.fetchMock, `/api/bookings/${b.id}/pickup/missed`),
    ).toHaveLength(1);
  });
});

// ---- Re-check (round 2 and 3) ----
const done = (b: BookingDetail): BookingDetail => ({
  ...b,
  status: "completed",
  days: b.days.map((d) => ({ ...d, pickups: [] })),
});
const stamp = (b: BookingDetail): BookingDetail => ({
  ...b,
  days: b.days.map((d) => ({
    ...d,
    pickedUpAt: d.cookedAt ? "2026-10-20T20:00:00.000Z" : null,
  })),
});

describe("completed bookings", () => {
  for (const role of ["customer", "chef"] as const) {
    it(`${role}: completed + confirmed + no proposals still shows the picked-up record, no actions`, async () => {
      const b = stamp(done(seededBooking(9105, role)));
      await h.mount(<Page start={b} chef={role === "chef"} />);
      expect(h.q("pickups")).not.toBeNull();
      expect(h.qa("picked-up").length).toBeGreaterThan(0);
      expect(h.button(/I picked up/)).toBeNull();
      expect(h.button("Mark pickup missed")).toBeNull();
      expect(h.q("propose-form")).toBeNull();
      expect(h.q("pickup-missed-warning")).toBeNull();
    });

    it(`${role}: completed + nothing confirmed + no proposals shows no pickup section (control)`, async () => {
      const b = done(seededBooking(9105, role));
      await h.mount(<Page start={b} chef={role === "chef"} />);
      expect(h.q("pickups")).toBeNull();
    });
  }

  it("intro texts mention the confirm", async () => {
    await h.mount(<Page start={seededBooking(9103, "customer")} />);
    expect(h.text()).toContain("press the button for that day");
    h.cleanup();
    h = harness();
    await h.mount(<Page start={seededBooking(9103, "chef")} chef />);
    expect(h.text()).toContain("cannot mark that pickup as missed");
  });
});

describe("stale pickup_confirmed with another day still inside its window", () => {
  it("alert text is shown with focus; the chef is told the day is confirmed", async () => {
    // day 1 past deadline + confirmed; day 2 not yet past its deadline
    const base = seededBooking(9105, "chef");
    const d1 = {
      ...base.days[0],
      pickups: [],
      pickedUpAt: "2026-10-20T20:00:00.000Z",
    };
    const d2 = {
      ...base.days[0],
      dayNumber: 2,
      pickups: [],
      pickedUpAt: null,
      pickupDeadlineDate: "2099-01-01",
    };
    const b = { ...base, days: [d1, d2] };
    // Page is stale: the chef still sees an unconfirmed past-deadline day 1.
    const stale = { ...b, days: [{ ...d1, pickedUpAt: null }, d2] };
    routes(h.fetchMock, {
      [`POST /api/bookings/${b.id}/pickup/missed`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        { reason: "pickup_confirmed" },
      ),
    });
    await h.mount(<Page start={stale} chef />);
    await h.click(h.button("Mark pickup missed"));
    await h.click(h.button("Yes, mark pickup missed"));
    const alert = h
      .q("missed-pickup")!
      .querySelector('[role="alert"]') as HTMLElement;
    expect(document.activeElement).toBe(alert);
    // Honesty: the text must not claim the whole booking can never be marked missed.
    expect(alert.textContent).not.toMatch(/never|ever again|booking is safe/i);
    expect(alert.textContent).toContain("confirmed they picked up");
  });
});
