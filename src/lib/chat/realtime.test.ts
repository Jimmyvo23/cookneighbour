import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeConnectChat } from "./realtime";

function fakeClient(session: unknown) {
  const calls: Record<string, unknown[]> = { on: [], channel: [] };
  let onRow: (p: { new: unknown }) => void = () => {};
  let onStatus: (s: string) => void = () => {};
  const channel = {
    on: vi.fn((_t: string, filter: unknown, cb: typeof onRow) => {
      calls.on.push(filter);
      onRow = cb;
      return channel;
    }),
    subscribe: vi.fn((cb: typeof onStatus) => {
      onStatus = cb;
      return channel;
    }),
  };
  const client = {
    auth: { getSession: vi.fn(async () => ({ data: { session } })) },
    realtime: { setAuth: vi.fn(async () => {}) },
    channel: vi.fn((name: string) => {
      calls.channel.push(name);
      return channel;
    }),
    removeChannel: vi.fn(async () => "ok"),
  };
  return {
    client: client as unknown as SupabaseClient,
    raw: client,
    calls,
    emit: (row: unknown) => onRow({ new: row }),
    status: (s: string) => onStatus(s),
  };
}

describe("makeConnectChat", () => {
  it("subscribes to the booking's channel with the filter and the user's token", async () => {
    const f = fakeClient({ access_token: "tok", user: { id: "u1" } });
    const rows: unknown[] = [];
    const states: string[] = [];
    const sub = await makeConnectChat(async () => f.client)("b-1", {
      onRow: (r) => rows.push(r),
      onStatus: (s) => states.push(s),
    });
    expect(f.calls.channel).toHaveLength(1);
    expect(f.calls.channel[0]).toMatch(/^chat:b-1:.+/);
    expect(f.calls.on[0]).toEqual({
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: "booking_id=eq.b-1",
    });
    expect(f.raw.realtime.setAuth).toHaveBeenCalledWith("tok");
    expect(sub.userId).toBe("u1");
    f.emit({ id: "m1" });
    f.status("SUBSCRIBED");
    f.status("CHANNEL_ERROR");
    expect(rows).toEqual([{ id: "m1" }]);
    expect(states).toEqual(["live", "down"]);
    sub.close();
    expect(f.raw.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("fails when nobody is signed in", async () => {
    const f = fakeClient(null);
    await expect(
      makeConnectChat(async () => f.client)("b-1", {
        onRow() {},
        onStatus() {},
      }),
    ).rejects.toThrow(/session/);
    expect(f.raw.channel).not.toHaveBeenCalled();
  });
});

// T-094 (B-1): @supabase/ssr's browser client is a singleton and channel(topic) returns the
// SAME channel for the same topic. An overlapping remount used to close the new mount's channel.
function singletonClient() {
  type Ch = {
    topic: string;
    cb: (p: { new: unknown }) => void;
    removed: boolean;
    on: (t: string, f: unknown, cb: Ch["cb"]) => Ch;
    subscribe: (cb: (s: string) => void) => Ch;
  };
  const channels = new Map<string, Ch>();
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "tok", user: { id: "u1" } } },
      }),
    },
    realtime: { setAuth: async () => {} },
    channel(topic: string) {
      const existing = channels.get(topic);
      if (existing) return existing; // the real client does this
      const ch: Ch = {
        topic,
        cb: () => {},
        removed: false,
        on(_t, _f, cb) {
          ch.cb = cb;
          return ch;
        },
        subscribe() {
          return ch;
        },
      };
      channels.set(topic, ch);
      return ch;
    },
    async removeChannel(ch: Ch) {
      ch.removed = true;
      channels.delete(ch.topic);
      return "ok";
    },
  };
  // Server side: deliver a row to every live (not removed) channel.
  const deliver = (row: unknown) =>
    channels.forEach((c) => !c.removed && c.cb({ new: row }));
  return { client: client as unknown as SupabaseClient, deliver };
}

describe("makeConnectChat overlapping mounts (T-094)", () => {
  it("the second mount still receives messages after the first one closes", async () => {
    const s = singletonClient();
    const connect = makeConnectChat(async () => s.client);
    const first: unknown[] = [];
    const second: unknown[] = [];
    const a = await connect("b-1", {
      onRow: (r) => first.push(r),
      onStatus() {},
    });
    const b = await connect("b-1", {
      onRow: (r) => second.push(r),
      onStatus() {},
    });
    a.close(); // StrictMode: the first mount's cleanup runs after the second subscribed
    await Promise.resolve();
    s.deliver({ id: "m1" });
    expect(second).toEqual([{ id: "m1" }]);
    b.close();
  });
});
