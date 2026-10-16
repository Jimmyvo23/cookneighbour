// @vitest-environment jsdom
// T-071 (D-55): the customer confirms "I picked up my meals" per cooked day of a chef's-home
// booking; the chef then sees it and cannot mark the pickup missed. The server is the judge: these
// tests check the wording, the confirm step, focus and what is hidden. MOCK data comes from the seed.
import { CHANGE_REFUSALS } from "@/lib/domain/bookingChanges";
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

const noPickups = (b: BookingDetail): BookingDetail => ({
  ...b,
  days: b.days.map((d) => ({ ...d, pickups: [] })),
});
const picked = (b: BookingDetail): BookingDetail => ({
  ...b,
  days: b.days.map((d) => ({
    ...d,
    pickedUpAt: d.cookedAt ? "2026-10-20T20:00:00.000Z" : null,
  })),
});

function Page({
  start,
  chef = false,
  seen,
}: {
  start: BookingDetail;
  chef?: boolean;
  seen?: (b: BookingDetail) => void;
}) {
  const [b, setB] = useState(start);
  const onChange = (n: BookingDetail) => {
    seen?.(n);
    setB(n);
  };
  return chef ? (
    <ChefPickups booking={b} onChange={onChange} />
  ) : (
    <CustomerPickups booking={b} onChange={onChange} />
  );
}

const confirmUrl = (b: BookingDetail, n = 1) =>
  `/api/bookings/${b.id}/days/${n}/pickup/confirm`;
const BTN = "I picked up my meals";

describe("customer: confirm a pickup", () => {
  it("offers the button on a cooked day and asks first, saying it cannot be undone", async () => {
    const b = noPickups(seededBooking(9103, "customer"));
    await h.mount(<Page start={b} />);
    expect(h.button(BTN)).not.toBeNull();
    expect(h.text()).not.toContain("This can't be undone");
    await h.click(h.button(BTN));
    expect(h.text()).toContain("This can't be undone");
    expect(h.text()).toContain("no longer mark this pickup as missed");
    expect(document.activeElement?.tagName).toBe("H3");
    expect(callsTo(h.fetchMock, confirmUrl(b))).toHaveLength(0);
    await h.click(h.button("Not yet"));
    expect(h.button(BTN)).not.toBeNull();
    expect(document.activeElement).toBe(h.button(BTN));
  });

  it("sends one POST with no body, shows 'Picked up on' and moves focus to that line", async () => {
    const b = noPickups(seededBooking(9103, "customer"));
    const after = picked(b);
    routes(h.fetchMock, { [`POST ${confirmUrl(b)}`]: json(200, after) });
    let announced: string | undefined = "unset";
    await h.mount(<Page start={b} seen={(n) => (announced = n.status)} />);
    await h.click(h.button(BTN));
    await h.click(h.button("Yes, I picked them up"));
    const calls = callsTo(h.fetchMock, confirmUrl(b));
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe("POST");
    expect(calls[0][2]).toBeUndefined();
    expect(announced).toBe("accepted");
    const line = h.q("picked-up")!;
    expect(line.textContent).toMatch(/^Picked up on .*\(Toronto time\)/);
    expect(document.activeElement).toBe(line);
    expect(h.button(BTN)).toBeNull();
  });

  it("names the day when there are several days", async () => {
    const b = seededBooking(9103, "customer", (x) => ({
      ...noPickups(x),
      days: [
        ...noPickups(x).days,
        { ...noPickups(x).days[0], dayNumber: 2, cookedAt: null },
      ],
    }));
    await h.mount(<Page start={b} />);
    expect(h.button("I picked up day 1's meals")).not.toBeNull();
    expect(h.qa("pickup-confirm")).toHaveLength(1); // day 2 is not cooked
  });

  it("is not shown on a customer's-home booking, a frozen one, or before the day is cooked", async () => {
    await h.mount(<Page start={seededBooking(9104, "customer")} />);
    expect(h.button(/I picked up/)).toBeNull();
    h.cleanup();
    h = harness();
    await h.mount(
      <Page
        start={seededBooking(9103, "customer", (x) => ({ ...x, frozen: true }))}
      />,
    );
    expect(h.button(/I picked up/)).toBeNull();
    h.cleanup();
    h = harness();
    await h.mount(
      <Page
        start={seededBooking(9103, "customer", (x) => ({
          ...x,
          days: x.days.map((d) => ({ ...d, cookedAt: null })),
        }))}
      />,
    );
    expect(h.button(/I picked up/)).toBeNull();
  });

  it("is not shown once the pickup was marked missed, or the booking ended", async () => {
    for (const status of [
      "no_show_customer",
      "completed",
      "cancelled",
    ] as const) {
      h.cleanup();
      h = harness();
      await h.mount(
        <Page
          start={seededBooking(9105, "customer", (x) => ({ ...x, status }))}
        />,
      );
      expect(h.button(/I picked up/)).toBeNull();
    }
  });

  it("stays available after the deadline has passed", async () => {
    await h.mount(<Page start={seededBooking(9105, "customer")} />);
    expect(h.button(BTN)).not.toBeNull();
  });

  it("keeps showing the picked-up line without a button, and no propose form for that day", async () => {
    const b = picked(noPickups(seededBooking(9103, "customer")));
    await h.mount(<Page start={b} />);
    expect(h.q("picked-up")).not.toBeNull();
    expect(h.button(BTN)).toBeNull();
    expect(h.q("propose-form")).toBeNull();
    expect(h.q("pickup-missed-warning")).toBeNull();
    // On first render focus is left alone.
    expect(document.activeElement).not.toBe(h.q("picked-up"));
  });

  it("words a closed proposal as picked up, not as unanswered", async () => {
    const b = picked(
      seededBooking(9103, "customer", (x) => ({
        ...x,
        days: x.days.map((d) => ({
          ...d,
          pickups: d.pickups.map((p) => ({ ...p, status: "void" as const })),
        })),
      })),
    );
    await h.mount(<Page start={b} />);
    const hist = h.q("pickup-history")?.textContent ?? "";
    expect(hist).toContain("closed because you picked up the meals");
    expect(hist).not.toContain("no answer before the booking ended");
  });

  it("shows a 409 in an alert that takes focus, once, and the button stays", async () => {
    const b = noPickups(seededBooking(9103, "customer"));
    routes(h.fetchMock, {
      [`POST ${confirmUrl(b)}`]: apiError(409, "INVALID_STATE", "server", {
        reason: "frozen",
      }),
    });
    await h.mount(<Page start={b} />);
    await h.click(h.button(BTN));
    await h.click(h.button("Yes, I picked them up"));
    const alert = h
      .q("pickup-confirm")!
      .querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("on hold");
    expect(document.activeElement).toBe(alert);
    expect(h.qa("picked-up")).toHaveLength(0);
  });

  it("words day_not_cooked and wrong_status", async () => {
    const b = noPickups(seededBooking(9103, "customer"));
    for (const [reason, text] of [
      ["day_not_cooked", /not marked that visit as cooked/],
      ["wrong_status", /not in a state/],
    ] as const) {
      h.cleanup();
      h = harness();
      routes(h.fetchMock, {
        [`POST ${confirmUrl(b)}`]: apiError(409, "INVALID_STATE", "x", {
          reason,
        }),
      });
      await h.mount(<Page start={b} />);
      await h.click(h.button(BTN));
      await h.click(h.button("Yes, I picked them up"));
      expect(
        h.q("pickup-confirm")!.querySelector('[role="alert"]')?.textContent,
      ).toMatch(text);
    }
  });

  it("two copies on one page use their own ids", async () => {
    const b = noPickups(seededBooking(9103, "customer"));
    await h.mount(
      <>
        <Page start={b} />
        <Page start={b} />
      </>,
    );
    const ids = [...h.host.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("chef: a confirmed pickup", () => {
  it("shows when the customer confirmed, and hides 'pickup missed'", async () => {
    const b = picked(seededBooking(9105, "chef"));
    await h.mount(<Page start={b} chef />);
    expect(h.q("picked-up")?.textContent).toMatch(
      /^Picked up \(confirmed by the customer\) on .*\(Toronto time\)/,
    );
    expect(h.q("missed-pickup")).toBeNull();
  });

  it("still offers 'pickup missed' when the past-deadline day is not confirmed", async () => {
    await h.mount(<Page start={seededBooking(9105, "chef")} chef />);
    expect(h.q("picked-up")).toBeNull();
    expect(h.q("missed-pickup")).not.toBeNull();
  });

  it("offers it when only another, not yet past day is confirmed", async () => {
    const base = seededBooking(9105, "chef");
    const day2 = {
      ...base.days[0],
      dayNumber: 2,
      pickedUpAt: "2026-10-20T20:00:00.000Z",
      pickupDeadlineDate: "2099-01-01",
    };
    await h.mount(
      <Page start={{ ...base, days: [base.days[0], day2] }} chef />,
    );
    expect(h.q("missed-pickup")).not.toBeNull();
  });

  it("hides the answer buttons for a confirmed day", async () => {
    const b = picked(seededBooking(9103, "chef"));
    await h.mount(<Page start={b} chef />);
    expect(h.q("pickup-respond")).toBeNull();
    expect(h.q("picked-up")).not.toBeNull();
  });

  it("maps a stale 409 pickup_confirmed to clear text", async () => {
    const b = seededBooking(9105, "chef");
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
    const alert = h.host.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain(CHANGE_REFUSALS.pickup_confirmed);
    expect(document.activeElement).toBe(alert);
  });
});

describe("a finished booking keeps the picked-up line (round 2)", () => {
  const done = (role: "customer" | "chef") =>
    picked(
      noPickups(
        seededBooking(9103, role, (x) => ({ ...x, status: "completed" })),
      ),
    );
  it("customer: completed + confirmed with no proposals still shows it, with no button", async () => {
    await h.mount(<Page start={done("customer")} />);
    expect(h.q("pickups")).not.toBeNull();
    expect(h.q("picked-up")?.textContent).toContain("Picked up on");
    expect(h.button(/I picked up/)).toBeNull();
  });
  it("chef: completed + confirmed with no proposals still shows it", async () => {
    await h.mount(<Page start={done("chef")} chef />);
    expect(h.q("pickups")).not.toBeNull();
    expect(h.q("picked-up")?.textContent).toContain(
      "confirmed by the customer",
    );
  });
  it("a completed booking with nothing confirmed and no proposals still shows no section", async () => {
    const b = noPickups(
      seededBooking(9103, "customer", (x) => ({ ...x, status: "completed" })),
    );
    await h.mount(<Page start={b} />);
    expect(h.q("pickups")).toBeNull();
  });
  it("the intros mention the confirm action", async () => {
    await h.mount(<Page start={seededBooking(9103, "customer")} />);
    expect(h.q("pickups")?.textContent).toContain("tell the chef you picked");
    h.cleanup();
    h = harness();
    await h.mount(<Page start={seededBooking(9103, "chef")} chef />);
    expect(h.q("pickups")?.textContent).toContain("can also confirm");
  });
});
