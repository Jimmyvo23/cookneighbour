// @vitest-environment jsdom
// T-096: Retry (reload) must not write a stale answer over a newer one. Realtime is a fake `connect`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatConnect, ChatHandlers } from "@/lib/chat/realtime";
import { harness, routes, type Harness } from "@/components/booking/testkit";
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

const err500 = () =>
  new Response(JSON.stringify({ error: { code: "INTERNAL" } }), {
    status: 500,
  });
const hidden = () =>
  new Response(
    JSON.stringify({
      error: {
        code: "INVALID_STATE",
        message: "closed",
        reason: "chat_hidden",
      },
    }),
    { status: 409 },
  );

describe("T-096 Retry is guarded against stale answers", () => {
  // Load 1 fails (error box). Retry (load 2) and the late load (load 3) run together.
  async function setup() {
    const l = fakeLive();
    const gates: Array<(r: Response) => void> = [];
    let n = 0;
    routes(h.fetchMock, {
      [GET1]: () =>
        ++n === 1 ? err500() : new Promise<Response>((res) => gates.push(res)),
    });
    await mount(l);
    expect(h.q("chat-load-error")).not.toBeNull();
    await h.click(h.button(/Try loading the chat again/)); // retry: gates[0]
    l.f.handlers!.onStatus("live"); // late load: gates[1]
    await h.flush();
    expect(gates).toHaveLength(2);
    return { gates };
  }

  it("a late hidden answer is not overwritten by a stale retry success", async () => {
    const { gates } = await setup();
    gates[1](hidden());
    await h.flush();
    gates[0](page([view(1)]));
    await h.flush();
    expect(h.q("chat")).toBeNull();
    expect(h.q("chat-load-error")).toBeNull();
  });

  it("a late success is not undone by a failed retry", async () => {
    const { gates } = await setup();
    gates[1](page([view(1)]));
    await h.flush();
    gates[0](err500());
    await h.flush();
    expect(h.q("chat-load-error")).toBeNull();
    expect(items()).toHaveLength(1);
  });

  it("a retry that works still clears the error box (T-092 kept)", async () => {
    const { gates } = await setup();
    gates[0](page([view(1)]));
    gates[1](page([view(1)]));
    await h.flush();
    expect(h.q("chat-load-error")).toBeNull();
    expect(items()).toHaveLength(1);
  });

  it("an answer that arrives after unmount writes nothing", async () => {
    const { gates } = await setup();
    await h.mount(<div />);
    gates[0](hidden());
    gates[1](page([view(1)]));
    await h.flush();
    expect(h.q("chat")).toBeNull();
  });
});
