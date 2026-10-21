// @vitest-environment jsdom
// T-089 Tester: late-join edge cases beside ChatSection.test.tsx. Realtime is a fake `connect`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatConnect, ChatHandlers } from "@/lib/chat/realtime";
import {
  callsTo,
  harness,
  routes,
  type Harness,
} from "@/components/booking/testkit";
import { ChatSection } from "./ChatSection";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    throw new Error("the Supabase client must not be created in this test");
  },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

const BID = "00000000-0000-4000-8000-000000000b01";
const GET1 = `GET /api/bookings/${BID}/messages?limit=50`;
const mid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const view = (n: number) => ({
  id: mid(n),
  bookingId: BID,
  senderId: "other",
  mine: false,
  clientId: null,
  body: `message ${n}`,
  createdAt: `2026-10-19T12:00:0${n}.000Z`,
});
const page = (items: unknown[]) =>
  new Response(JSON.stringify({ items, nextCursor: null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

function fakeLive() {
  const f = { handlers: null as ChatHandlers | null };
  const connect: ChatConnect = async (_id, hd) => {
    f.handlers = hd;
    return { userId: "me", close: () => {} };
  };
  const row = (n: number) =>
    f.handlers!.onRow({
      id: mid(n),
      booking_id: BID,
      sender_id: "other",
      client_id: null,
      body: `message ${n}`,
      created_at: `2026-10-19T12:00:0${n}.000Z`,
    });
  return { f, connect, row };
}
async function mount(l: ReturnType<typeof fakeLive>) {
  await h.mount(
    <ChatSection
      bookingId={BID}
      status="accepted"
      frozen={false}
      expiresAt={null}
      otherName="Lan"
      connect={l.connect}
      mock={false}
    />,
  );
}
const items = () =>
  [...h.host.querySelectorAll('[data-testid="chat-message"]')].map(
    (e) => e.textContent ?? "",
  );
const loads = () => callsTo(h.fetchMock, "limit=50").length;

describe("T-089 late join", () => {
  it("a message missing from the first GET is picked up by the extra load, once", async () => {
    const l = fakeLive();
    const gates: Array<(r: Response) => void> = [];
    routes(h.fetchMock, {
      [GET1]: () => new Promise<Response>((res) => gates.push(res)),
    });
    await mount(l);
    l.f.handlers!.onStatus("live");
    await h.flush();
    expect(gates).toHaveLength(2);
    gates[1](page([view(1)])); // the second load sees the message
    await h.flush();
    gates[0](page([])); // the stale first GET answers last, without it
    await h.flush();
    expect(items()).toHaveLength(1);
    expect(items()[0]).toContain("message 1");
  });

  it("a Realtime row during the first GET shows exactly once after both loads", async () => {
    const l = fakeLive();
    const gates: Array<(r: Response) => void> = [];
    routes(h.fetchMock, {
      [GET1]: () => new Promise<Response>((res) => gates.push(res)),
    });
    await mount(l);
    l.f.handlers!.onStatus("live");
    l.row(1);
    l.row(1); // a repeated event
    await h.flush();
    gates[0](page([view(1)]));
    gates[1](page([view(1)]));
    await h.flush();
    expect(items()).toHaveLength(1);
  });

  it("repeated live statuses never loop: one late load, then one load per drop", async () => {
    const l = fakeLive();
    routes(h.fetchMock, { [GET1]: () => page([]) });
    await mount(l);
    expect(loads()).toBe(1);
    const hd = l.f.handlers!;
    hd.onStatus("live"); // first join after the first load finished: late, one load
    await h.flush();
    expect(loads()).toBe(2);
    hd.onStatus("live");
    hd.onStatus("live");
    await h.flush();
    expect(loads()).toBe(2); // no drop, no load
    hd.onStatus("down");
    hd.onStatus("live");
    await h.flush();
    expect(loads()).toBe(3);
    hd.onStatus("live");
    await h.flush();
    expect(loads()).toBe(3);
  });

  it("no extra load when the channel never joins (connecting forever)", async () => {
    const l = fakeLive();
    routes(h.fetchMock, { [GET1]: () => page([]) });
    await mount(l);
    await h.flush();
    expect(loads()).toBe(1);
  });

  it("a failed first GET shows the load error; a late join then loads once more and the list is not duplicated", async () => {
    const l = fakeLive();
    let n = 0;
    routes(h.fetchMock, {
      [GET1]: () => {
        n++;
        return n === 1
          ? new Response(
              JSON.stringify({ error: { code: "INTERNAL", message: "boom" } }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            )
          : page([view(1)]);
      },
    });
    await mount(l);
    expect(h.q("chat-load-error")).not.toBeNull();
    l.f.handlers!.onStatus("live");
    await h.flush();
    expect(loads()).toBe(2);
    // Pinned current behaviour (Tester note, LOW): the late load succeeded in the background, but
    // the error box stays until the person presses the retry button; nothing is shown twice.
    expect(h.q("chat-load-error")).not.toBeNull();
    expect(items()).toHaveLength(0);
  });
});
