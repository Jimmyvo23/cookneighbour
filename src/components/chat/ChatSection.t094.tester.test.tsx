// @vitest-environment jsdom
// T-094 / T-092 Tester: the real makeConnectChat on a fake SINGLETON Realtime client (channels are
// reused by topic, like @supabase/ssr) driven through ChatSection, with StrictMode and remounts.
import { StrictMode } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeConnectChat } from "@/lib/chat/realtime";
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
const OTHER = "00000000-0000-4000-8000-000000000b02";
const GET1 = `GET /api/bookings/${BID}/messages?limit=50`;
const page = (items: unknown[]) =>
  new Response(JSON.stringify({ items, nextCursor: null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

type Ch = {
  topic: string;
  filter: { filter?: string } | null;
  cb: (p: { new: unknown }) => void;
  status: (s: string) => void;
  on: (t: string, f: { filter?: string }, cb: Ch["cb"]) => Ch;
  subscribe: (cb: (s: string) => void) => Ch;
};
function singleton() {
  const channels = new Map<string, Ch>();
  const everCreated: string[] = [];
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "t", user: { id: "me" } } },
      }),
    },
    realtime: { setAuth: async () => {} },
    channel(topic: string) {
      const old = channels.get(topic);
      if (old) return old;
      everCreated.push(topic);
      const ch: Ch = {
        topic,
        filter: null,
        cb: () => {},
        status: () => {},
        on(_t, f, cb) {
          ch.filter = f;
          ch.cb = cb;
          return ch;
        },
        subscribe(cb) {
          ch.status = cb;
          queueMicrotask(() => cb("SUBSCRIBED"));
          return ch;
        },
      };
      channels.set(topic, ch);
      return ch;
    },
    async removeChannel(ch: Ch) {
      channels.delete(ch.topic);
      return "ok";
    },
  };
  // Server side: like postgres_changes, only channels whose filter matches the row get it.
  const deliver = (bookingId: string, id: string, n: number) =>
    [...channels.values()].forEach((c) => {
      if (c.filter?.filter === `booking_id=eq.${bookingId}`)
        c.cb({
          new: {
            id,
            booking_id: bookingId,
            sender_id: "other",
            client_id: null,
            body: `live ${n}`,
            created_at: `2026-10-19T12:00:0${n}.000Z`,
          },
        });
    });
  return {
    client: client as unknown as SupabaseClient,
    channels,
    everCreated,
    deliver,
  };
}

const mid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ui = (connect: ReturnType<typeof makeConnectChat>, id = BID) => (
  <StrictMode>
    <ChatSection
      bookingId={id}
      status="accepted"
      frozen={false}
      expiresAt={null}
      otherName="Lan"
      connect={connect}
      mock={false}
    />
  </StrictMode>
);
const items = () =>
  [...h.host.querySelectorAll('[data-testid="chat-message"]')].map(
    (e) => e.textContent ?? "",
  );

describe("T-094 real connectChat through ChatSection", () => {
  it("StrictMode double mount: a live row shows exactly once, one channel stays open", async () => {
    const s = singleton();
    routes(h.fetchMock, { [GET1]: () => page([]) });
    await h.mount(ui(makeConnectChat(async () => s.client)));
    expect(s.channels.size).toBe(1);
    await act(async () => s.deliver(BID, mid(1), 1));
    await act(async () => s.deliver(BID, mid(1), 1)); // repeated event
    expect(items()).toHaveLength(1);
  });

  it("remounts do not leak channels: topics are unique and each unmount removes its own", async () => {
    const s = singleton();
    routes(h.fetchMock, { [GET1]: () => page([]) });
    const connect = makeConnectChat(async () => s.client);
    for (let i = 0; i < 4; i++) {
      await h.mount(<div />);
      expect(s.channels.size).toBe(0);
      await h.mount(ui(connect));
      expect(s.channels.size).toBe(1);
    }
    expect(new Set(s.everCreated).size).toBe(s.everCreated.length);
    await act(async () => s.deliver(BID, mid(2), 2));
    expect(items()).toHaveLength(1);
    await h.mount(<div />);
    expect(s.channels.size).toBe(0);
  });

  it("a row of another booking never reaches this chat (filter is per booking, and a row with another booking id is dropped)", async () => {
    const s = singleton();
    routes(h.fetchMock, { [GET1]: () => page([]) });
    await h.mount(ui(makeConnectChat(async () => s.client)));
    for (const c of s.channels.values())
      expect(c.filter?.filter).toBe(`booking_id=eq.${BID}`);
    await act(async () => s.deliver(OTHER, mid(3), 3));
    expect(items()).toHaveLength(0);
    // Even if a wrong row slipped through the channel, the page drops it.
    await act(async () =>
      [...s.channels.values()][0].cb({
        new: {
          id: mid(4),
          booking_id: OTHER,
          sender_id: "other",
          client_id: null,
          body: "leak",
          created_at: "2026-10-19T12:00:04.000Z",
        },
      }),
    );
    expect(items()).toHaveLength(0);
  });
});

describe("T-092 retry and settle", () => {
  it("failed first load: the retry button still works and clears the box", async () => {
    const s = singleton();
    let n = 0;
    routes(h.fetchMock, {
      [GET1]: () =>
        ++n === 1
          ? new Response(JSON.stringify({ error: { code: "INTERNAL" } }), {
              status: 500,
            })
          : page([]),
    });
    // A connect that never reports live, so no late load runs: only the button can recover.
    const connect = makeConnectChat(async () => {
      const c = s.client as unknown as { channel: (t: string) => Ch };
      const orig = c.channel.bind(c);
      c.channel = (t) => {
        const ch = orig(t);
        ch.subscribe = (cb) => {
          ch.status = cb;
          return ch;
        };
        return ch;
      };
      return s.client;
    });
    await h.mount(ui(connect));
    expect(h.q("chat-load-error")).not.toBeNull();
    await h.click(h.button(/Try loading the chat again/));
    expect(h.q("chat-load-error")).toBeNull();
    expect(h.q("chat-box")).not.toBeNull();
  });
});
