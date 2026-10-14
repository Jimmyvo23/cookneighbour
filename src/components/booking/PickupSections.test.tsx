// @vitest-environment jsdom
// T-045: the customer's pickup proposals (D-29). A proposal is sent as Toronto time with its
// offset, can be repeated after a decline until the deadline, and a refused time shows the latest
// allowed moment. Errors move focus to the alert or the field.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BookingDetail } from "@/lib/api/types";
import { CustomerPickups } from "@/components/booking/PickupSections";
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

async function open(
  b: BookingDetail,
  onChange: (b: BookingDetail, message?: string) => void = () => {},
) {
  await h.mount(<CustomerPickups booking={b} onChange={onChange} />);
}
const timeField = () =>
  h.host.querySelector('input[type="datetime-local"]') as HTMLInputElement;

describe("customer pickups", () => {
  it("is not shown for a booking at the customer's home", async () => {
    await open(seededBooking(9104, "customer"));
    expect(h.q("pickups")).toBeNull();
  });

  it("says what happens when the meals are not picked up, including the free booking", async () => {
    await open(noPickups(seededBooking(9103, "customer")));
    const w = h.q("pickup-missed-warning")?.textContent ?? "";
    expect(w).toContain("no-show by you for the whole booking");
    const free = seededBooking(9103, "customer", (b) => ({
      ...noPickups(b),
      isFreeTrial: true,
    }));
    h.cleanup();
    h = harness();
    await open(free);
    expect(h.q("pickup-missed-warning")?.textContent).toContain(
      "free first booking counts as used",
    );
  });

  it("shows the history of proposals, and no form while one is waiting", async () => {
    await open(seededBooking(9103, "customer"));
    const hist = h.q("pickup-history")?.textContent ?? "";
    expect(hist).toContain("the chef declined");
    expect(hist).toContain("waiting for the chef to answer");
    expect(h.q("propose-form")).toBeNull();
    expect(h.text()).toContain("Waiting for the chef");
  });

  it("offers a form after a decline and sends Toronto time with its offset", async () => {
    const b = noPickups(seededBooking(9103, "customer"));
    const after = { ...b };
    let changed: BookingDetail | null = null;
    routes(h.fetchMock, {
      [`POST /api/bookings/${b.id}/days/1/pickup/propose`]: json(200, after),
    });
    await open(b, (n) => (changed = n));
    expect(h.q("propose-form")).not.toBeNull();
    // 2 days ahead in the afternoon, always before the deadline end (deadline is day + shelf life).
    const d = b.days[0].pickupDeadlineDate!;
    await h.type(timeField(), `${d}T15:30`);
    await h.click(h.button("Propose this time"));
    const [call] = callsTo(h.fetchMock, "/pickup/propose");
    const body = call[2] as { proposedAt: string };
    expect(body.proposedAt).toMatch(new RegExp(`^${d}T15:30:00-0[45]:00$`));
    expect(changed).toEqual(after);
  });

  it("an empty time is refused locally with the field marked and focused", async () => {
    await open(noPickups(seededBooking(9103, "customer")));
    await h.click(h.button("Propose this time"));
    expect(callsTo(h.fetchMock, "/pickup/propose")).toHaveLength(0);
    expect(timeField().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(timeField());
  });

  it("a refused time shows the server's reason and the latest allowed moment", async () => {
    const b = noPickups(seededBooking(9103, "customer"));
    routes(h.fetchMock, {
      [`POST /api/bookings/${b.id}/days/1/pickup/propose`]: apiError(
        422,
        "VALIDATION_FAILED",
        "Check",
        {
          fields: {
            proposedAt:
              "Pick a time no later than the earliest eat-by date of those meals.",
          },
          latest: "2030-01-23T05:00:00.000Z",
        },
      ),
    });
    await open(b);
    await h.type(timeField(), `${b.days[0].pickupDeadlineDate}T23:00`);
    await h.click(h.button("Propose this time"));
    const alert = h.host.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("no later than");
    expect(alert.textContent).toContain("Toronto time");
    expect(timeField().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(timeField());
  });

  it("409 reasons are shown in words", async () => {
    const b = noPickups(seededBooking(9103, "customer"));
    routes(h.fetchMock, {
      [`POST /api/bookings/${b.id}/days/1/pickup/propose`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        {
          reason: "deadline_passed",
        },
      ),
    });
    await open(b);
    await h.type(timeField(), `${b.days[0].pickupDeadlineDate}T10:00`);
    await h.click(h.button("Propose this time"));
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain(
      "eat-by date",
    );
  });

  it("after the deadline there is no form, only an explanation", async () => {
    await open(seededBooking(9105, "customer"));
    expect(h.q("propose-form")).toBeNull();
    expect(h.q("pickup-window-over")?.textContent).toContain(
      "no pickup was agreed",
    );
  });

  it("an agreed pickup is shown and no form is offered", async () => {
    const b = seededBooking(9103, "customer", (x) => ({
      ...x,
      days: x.days.map((d) => ({
        ...d,
        pickups: d.pickups.map((p) =>
          p.status === "proposed" ? { ...p, status: "accepted" as const } : p,
        ),
      })),
    }));
    await open(b);
    expect(h.q("pickup-agreed")?.textContent).toContain("Pickup agreed");
    expect(h.q("propose-form")).toBeNull();
  });

  it("an uncooked day waits for the chef", async () => {
    const b = seededBooking(9103, "customer", (x) => ({
      ...x,
      days: x.days.map((d) => ({ ...d, cookedAt: null, pickups: [] })),
    }));
    await open(b);
    expect(h.text()).toContain("has not marked this day as cooked yet");
    expect(h.q("propose-form")).toBeNull();
  });
});
