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
    expect(f.calls.channel).toEqual(["chat:b-1"]);
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
