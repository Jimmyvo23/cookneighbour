// T-046: the MOCK chat routes follow contract 7C (same pure rules as the real routes).
import { describe, expect, it } from "vitest";
import type { ApiError, MessageList, MessageView } from "@/lib/api/types";
import { MESSAGE_REFUSALS } from "@/lib/domain/messages";
import {
  bookingRoutes,
  type BookingMockState,
  type BookingRouteResult,
} from "@/lib/mocks/mock-bookings";

const NOW = new Date();
const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const REQUESTED = ID(9101);
const ACCEPTED = ID(9103);
const FROZEN = ID(9104);
const cid = (n: number) =>
  `6f1c1c1e-0000-4000-8000-${String(n).padStart(12, "0")}`;

class Session {
  s: BookingMockState;
  constructor(frozen: string[] = []) {
    this.s = {
      profile: {
        id: "mock-user-1",
        role: "chef",
        displayName: "Demo",
        country: "CA",
        currency: "CAD",
        language: "en",
      },
      phone: null,
      phoneVerified: true,
      address: null,
      bookings: [],
      hooks: { frozenSeeded: frozen },
    };
  }
  async call(method: string, path: string, body: unknown = {}) {
    const r = bookingRoutes(
      method,
      path,
      body,
      this.s,
      NOW,
    ) as BookingRouteResult;
    expect(r, `${method} ${path} was not routed`).toBeTruthy();
    if (r.next) this.s = { ...this.s, ...r.next } as BookingMockState;
    const json = await r.res.json();
    return {
      status: r.res.status,
      json,
      error: (json as ApiError).error,
      headers: r.res.headers,
    };
  }
  send = (id: string, body: unknown) =>
    this.call("POST", `/api/bookings/${id}/messages`, body);
  read = (id: string, qs = "") =>
    this.call("GET", `/api/bookings/${id}/messages${qs}`);
}

describe("mock chat routes", () => {
  it("a first read shows one made-up greeting from the other party", async () => {
    const c = new Session();
    const r = await c.read(ACCEPTED);
    expect(r.status).toBe(200);
    const list = r.json as MessageList;
    expect(list.items).toHaveLength(1);
    expect(list.items[0].mine).toBe(false);
    expect(list.items[0].body).toContain("MOCK");
    expect(list.nextCursor).toBeNull();
  });

  it("sends 201, then the same clientId again 200 with the first message", async () => {
    const c = new Session();
    const a = await c.send(ACCEPTED, { clientId: cid(1), body: " Hello " });
    expect(a.status).toBe(201);
    expect((a.json as MessageView).body).toBe("Hello");
    expect((a.json as MessageView).mine).toBe(true);
    const b = await c.send(ACCEPTED, { clientId: cid(1), body: "Hello" });
    expect(b.status).toBe(200);
    expect((b.json as MessageView).id).toBe((a.json as MessageView).id);
    const again = await c.send(ACCEPTED, { clientId: cid(1), body: "Other" });
    expect(again.status).toBe(409);
    expect(again.error.reason).toBe("message_id_reused");
    const list = (await c.read(ACCEPTED)).json as MessageList;
    expect(list.items.filter((m) => m.mine)).toHaveLength(1);
  });

  it("pages oldest first with an opaque cursor", async () => {
    const c = new Session();
    await c.read(ACCEPTED); // the first read adds the greeting
    for (let i = 1; i <= 3; i++)
      await c.send(ACCEPTED, { clientId: cid(i), body: `m${i}` });
    const p1 = (await c.read(ACCEPTED, "?limit=2")).json as MessageList;
    expect(p1.items.map((m) => m.body)).toEqual([
      expect.stringContaining("MOCK"),
      "m1",
    ]);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = (await c.read(ACCEPTED, `?limit=2&cursor=${p1.nextCursor}`))
      .json as MessageList;
    expect(p2.items.map((m) => m.body)).toEqual(["m2", "m3"]);
    expect(p2.nextCursor).toBeNull();
    const bad = await c.read(ACCEPTED, "?limit=0&cursor=zzz");
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.error.fields ?? {}).sort()).toEqual([
      "cursor",
      "limit",
    ]);
  });

  it("refuses contact details before acceptance, not after", async () => {
    const c = new Session();
    const r = await c.send(REQUESTED, {
      clientId: cid(1),
      body: "call 416 555 0199",
    });
    expect(r.status).toBe(422);
    expect(r.error.code).toBe("CONTACT_DETAILS_NOT_ALLOWED");
    expect(r.error.fields?.body).toBeTruthy();
    const ok = await c.send(ACCEPTED, {
      clientId: cid(2),
      body: "call 416 555 0199",
    });
    expect(ok.status).toBe(201);
  });

  it("validates the body", async () => {
    const c = new Session();
    const r = await c.send(ACCEPTED, { clientId: "x", body: "   " });
    expect(r.status).toBe(422);
    expect(Object.keys(r.error.fields ?? {}).sort()).toEqual([
      "body",
      "clientId",
    ]);
  });

  it("a frozen booking can be read but not written (D-93)", async () => {
    const c = new Session([FROZEN]);
    expect((await c.read(FROZEN)).status).toBe(200);
    const r = await c.send(FROZEN, { clientId: cid(1), body: "hi" });
    expect(r.status).toBe(409);
    expect(r.error.reason).toBe("frozen");
    expect(r.error.message).toBe(MESSAGE_REFUSALS.frozen);
  });

  it("a declined booking's chat is hidden for read and send (D-94)", async () => {
    const c = new Session();
    const d = await c.call("POST", `/api/bookings/${REQUESTED}/decline`, {
      reason: "Sorry, fully booked.",
    });
    expect(d.status).toBe(200);
    for (const r of [
      await c.read(REQUESTED),
      await c.send(REQUESTED, { clientId: cid(1), body: "hi" }),
    ]) {
      expect(r.status).toBe(409);
      expect(r.error.reason).toBe("chat_hidden");
    }
  });

  it("unknown booking is 404; the rate-limit hook answers 429 once", async () => {
    const c = new Session();
    expect((await c.read(ID(1))).status).toBe(404);
    expect((await c.read("nope")).status).toBe(404);
    c.s = { ...c.s, hooks: { ...c.s.hooks, messagesRateLimited: true } };
    const r = await c.send(ACCEPTED, { clientId: cid(1), body: "hi" });
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("30");
    expect(
      (await c.send(ACCEPTED, { clientId: cid(1), body: "hi" })).status,
    ).toBe(201);
  });

  it("round 3: unknown or repeated query parameters are 422 like the real route", async () => {
    const c = new Session();
    const r = await c.read(ACCEPTED, "?sort=desc&limit=1&limit=2");
    expect(r.status).toBe(422);
    expect(Object.keys(r.error.fields ?? {}).sort()).toEqual(["limit", "sort"]);
  });

  it("round 3: a clientId reused on another booking is 409 message_id_reused", async () => {
    const c = new Session();
    expect(
      (await c.send(ACCEPTED, { clientId: cid(1), body: "hi" })).status,
    ).toBe(201);
    const r = await c.send(FROZEN, { clientId: cid(1), body: "hi" });
    expect(r.status).toBe(409);
    expect(r.error.reason).toBe("message_id_reused");
  });

  it("round 3: a request past its expiry is hidden even before the sweep marks it", async () => {
    const c = new Session();
    // Seed the chef bookings, then make the requested one stale without changing its status.
    await c.read(ACCEPTED);
    const rows = (c.s.chefBookings ?? []).map((x) =>
      x.detail.id === REQUESTED
        ? {
            ...x,
            detail: {
              ...x.detail,
              expiresAt: new Date(NOW.getTime() - 1000).toISOString(),
            },
          }
        : x,
    );
    c.s = { ...c.s, chefBookings: rows };
    for (const r of [
      await c.read(REQUESTED),
      await c.send(REQUESTED, { clientId: cid(2), body: "hi" }),
    ]) {
      expect(r.status).toBe(409);
      expect(r.error.reason).toBe("chat_hidden");
    }
  });
});
