// @vitest-environment jsdom
// T-047 round 3 (D-105): when an open chat turns out to be closed, both booking pages reload the
// booking (a quiet refetch) and the closed notice keeps focus.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callsTo,
  harness,
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

const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });
const HIDDEN = () =>
  res(409, {
    error: { code: "INVALID_STATE", message: "closed", reason: "chat_hidden" },
  });

describe.each(["customer", "chef"] as const)("%s page", (role) => {
  it("reloads the booking and keeps the closed notice focused", async () => {
    const b = seededBooking(9104, role);
    let hidden = false;
    let current = b;
    routes(h.fetchMock, {
      [`GET /api/bookings/${b.id}`]: () => res(200, current),
      [`GET /api/bookings/${b.id}/messages?limit=50`]: () =>
        hidden ? HIDDEN() : res(200, { items: [], nextCursor: null }),
      [`POST /api/bookings/${b.id}/messages`]: () => {
        hidden = true;
        current = { ...b, status: "cancelled" };
        return HIDDEN();
      },
    });
    await h.mount(
      role === "chef" ? (
        <ChefBookingView id={b.id} />
      ) : (
        <BookingDetailView id={b.id} />
      ),
    );
    await h.flush();
    const box = h.host.querySelector<HTMLTextAreaElement>(
      'textarea[data-testid="chat-box"]',
    )!;
    await h.type(box, "hello");
    await h.click(h.button("Send"));
    await h.flush();
    expect(
      callsTo(h.fetchMock, `/api/bookings/${b.id}`).filter(
        (c) => c[1] === "GET",
      ),
    ).toHaveLength(2); // the first load and the reload
    expect(h.text()).toContain("Cancelled"); // the new status is on the page
    expect(h.q("chat-closed")).not.toBeNull();
    expect(h.q("chat")).toBeNull();
    expect(document.activeElement).toBe(h.q("chat-closed"));
    expect(document.activeElement).not.toBe(document.body);
  });
});
