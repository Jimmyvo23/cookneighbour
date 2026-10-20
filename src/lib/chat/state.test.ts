import { describe, expect, it } from "vitest";
import type { MessageView } from "@/lib/api/types";
import {
  addPending,
  markFailed,
  markPending,
  mergeServer,
  removeItem,
  rowToView,
  type ChatItem,
} from "./state";

const msg = (n: number, over: Partial<MessageView> = {}): MessageView => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  bookingId: "b1",
  senderId: n % 2 ? "other" : "me",
  mine: n % 2 === 0,
  clientId: null,
  body: `m${n}`,
  createdAt: `2026-10-19T12:00:0${n}.000Z`,
  ...over,
});

describe("mergeServer", () => {
  it("adds messages oldest first and ignores a repeat by id", () => {
    let items: ChatItem[] = [];
    items = mergeServer(items, [msg(3), msg(1)]);
    items = mergeServer(items, [msg(2), msg(1)]);
    expect(items.map((i) => i.body)).toEqual(["m1", "m2", "m3"]);
  });

  it("turns a pending bubble into the saved message by clientId, keeping its key", () => {
    const cid = "11111111-1111-4111-8111-111111111111";
    let items = addPending([], cid, "hi", "2026-10-19T12:00:00.000Z");
    const key = items[0].key;
    items = mergeServer(items, [
      msg(2, { clientId: cid, body: "hi", mine: true }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ state: "sent", mine: true, key });
    expect(items[0].id).toBe(msg(2).id);
  });

  it("keeps unsent bubbles after the saved ones", () => {
    const cid = "11111111-1111-4111-8111-111111111111";
    let items = addPending([], cid, "later", "2026-10-19T12:00:05.000Z");
    items = mergeServer(items, [msg(1), msg(2)]);
    expect(items.map((i) => i.body)).toEqual(["m1", "m2", "later"]);
  });

  it("orders same-instant messages by id", () => {
    const t = "2026-10-19T12:00:00.000Z";
    const items = mergeServer(
      [],
      [msg(2, { createdAt: t }), msg(1, { createdAt: t })],
    );
    expect(items.map((i) => i.body)).toEqual(["m1", "m2"]);
  });
});

describe("local states", () => {
  const cid = "22222222-2222-4222-8222-222222222222";
  it("fails, retries and removes a bubble", () => {
    let items = addPending([], cid, "x", "t");
    items = markFailed(items, cid, "No network", true);
    expect(items[0]).toMatchObject({
      state: "failed",
      error: "No network",
      retryable: true,
    });
    items = markPending(items, cid);
    expect(items[0]).toMatchObject({ state: "pending", error: undefined });
    expect(removeItem(items, cid)).toEqual([]);
  });
});

describe("rowToView", () => {
  it("maps the raw Realtime row and marks my own", () => {
    const row = {
      id: "i1",
      booking_id: "b1",
      sender_id: "me",
      client_id: "c1",
      body: "yo",
      created_at: "2026-10-19T12:00:00+00:00",
    };
    expect(rowToView(row, "me")).toEqual({
      id: "i1",
      bookingId: "b1",
      senderId: "me",
      mine: true,
      clientId: "c1",
      body: "yo",
      createdAt: "2026-10-19T12:00:00+00:00",
    });
    expect(rowToView(row, "someone")?.mine).toBe(false);
    expect(rowToView({ ...row, client_id: null }, null)?.clientId).toBeNull();
  });
  it("refuses a row that is not a message", () => {
    expect(rowToView({ id: 5 }, "me")).toBeNull();
    expect(rowToView(null, "me")).toBeNull();
  });
});
