// @vitest-environment jsdom
// T-047 round 3 Tester (D-105): an open chat that turns hidden, on both booking pages. Send and
// retry paths: the closed notice takes and keeps focus, the booking is refetched exactly once and
// shows its new status, the notice survives the reload, and nothing more is fetched or sent after.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingDetail } from "@/lib/api/types";
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

const view = (role: "chef" | "customer", id: string) =>
  role === "chef" ? <ChefBookingView id={id} /> : <BookingDetailView id={id} />;

/** Everything the page asked for that is not the first load, in order. */
const msgCalls = () =>
  h.fetchMock.mock.calls
    .filter((c) => /\/messages/.test(String(c[0])))
    .map(
      (c) => `${c[1]?.method ?? "GET"} ${String(c[0]).split("/messages")[1]}`,
    );
const bookingGets = (id: string) =>
  callsTo(h.fetchMock, `/api/bookings/${id}`).filter((c) => c[1] === "GET");

async function setup(
  role: "chef" | "customer",
  status: BookingDetail["status"],
) {
  const b = seededBooking(9104, role, (x) => ({
    ...x,
    status: "accepted",
    frozen: false,
  }));
  let hidden = false;
  let current: BookingDetail = b;
  let postN = 0;
  routes(h.fetchMock, {
    [`GET /api/bookings/${b.id}`]: () => res(200, current),
    [`GET /api/bookings/${b.id}/messages?limit=50`]: () =>
      hidden ? HIDDEN() : res(200, { items: [], nextCursor: null }),
    [`POST /api/bookings/${b.id}/messages`]: () => {
      // First POST: the network drops (so Retry exists). Second: the booking was closed meanwhile.
      if (postN++ === 0 && retryMode.on) throw new TypeError("offline");
      hidden = true;
      current = { ...b, status };
      return HIDDEN();
    },
  });
  await h.mount(view(role, b.id));
  await h.flush();
  return b;
}
const retryMode = { on: false };
beforeEach(() => {
  retryMode.on = false;
});

const box = () =>
  h.host.querySelector<HTMLTextAreaElement>(
    'textarea[data-testid="chat-box"]',
  )!;

describe.each(["customer", "chef"] as const)("%s page", (role) => {
  it.each(["declined", "cancelled"] as const)(
    "send finds the chat closed (%s): notice focused, one refetch, new status shown, quiet afterwards",
    async (status) => {
      const b = await setup(role, status);
      expect(h.q("chat")).not.toBeNull();
      await h.type(box(), "are you still coming?");
      await h.click(h.button("Send"));
      await h.flush();
      await h.flush();
      expect(bookingGets(b.id)).toHaveLength(2); // first load + exactly one reload
      expect(h.text()).toMatch(
        status === "declined" ? /declined/i : /cancelled/i,
      );
      expect(h.q("chat")).toBeNull();
      expect(
        h.host.querySelector("textarea[data-testid='chat-box']"),
      ).toBeNull();
      const notice = h.q("chat-closed")!;
      expect(notice.textContent).toBe("The chat for this booking is closed.");
      expect(notice.getAttribute("role")).toBe("status");
      expect(document.activeElement).toBe(notice);
      // Nothing is fetched or sent after the close.
      const before = h.fetchMock.mock.calls.length;
      await h.flush();
      await h.flush();
      expect(h.fetchMock.mock.calls.length).toBe(before);
      expect(msgCalls().filter((c) => c.startsWith("POST"))).toHaveLength(1);
      // The typed text is not echoed anywhere on the page.
      expect(h.text()).not.toContain("are you still coming?");
    },
  );

  it("retry finds the chat closed: same result, and the retry was the second and last POST", async () => {
    retryMode.on = true;
    const b = await setup(role, "declined");
    await h.type(box(), "hello?");
    await h.click(h.button("Send"));
    expect(h.q("chat-failed")).not.toBeNull();
    expect(bookingGets(b.id)).toHaveLength(1); // a network failure does not reload the page
    await h.click(h.button("Retry sending"));
    await h.flush();
    await h.flush();
    expect(bookingGets(b.id)).toHaveLength(2);
    expect(h.text()).toMatch(/declined/i);
    expect(h.q("chat-closed")).not.toBeNull();
    expect(document.activeElement).toBe(h.q("chat-closed"));
    expect(msgCalls().filter((c) => c.startsWith("POST"))).toHaveLength(2);
    const before = h.fetchMock.mock.calls.length;
    await h.flush();
    expect(h.fetchMock.mock.calls.length).toBe(before);
  });

  it("a booking that is hidden when the page loads: no notice, no chat, no /messages request", async () => {
    const b = seededBooking(9104, role, (x) => ({ ...x, status: "declined" }));
    routes(h.fetchMock, { [`GET /api/bookings/${b.id}`]: () => res(200, b) });
    await h.mount(view(role, b.id));
    await h.flush();
    await h.flush();
    expect(h.q("chat")).toBeNull();
    expect(h.q("chat-closed")).toBeNull();
    expect(msgCalls()).toEqual([]);
    expect(bookingGets(b.id)).toHaveLength(1);
  });

  it("a chat that is hidden by the server at load although the page says accepted: silent, no reload", async () => {
    const b = seededBooking(9104, role, (x) => ({ ...x, status: "accepted" }));
    routes(h.fetchMock, {
      [`GET /api/bookings/${b.id}`]: () => res(200, b),
      [`GET /api/bookings/${b.id}/messages?limit=50`]: HIDDEN,
    });
    await h.mount(view(role, b.id));
    await h.flush();
    await h.flush();
    expect(h.q("chat")).toBeNull();
    expect(h.q("chat-closed")).toBeNull();
    expect(bookingGets(b.id)).toHaveLength(1);
  });
});
