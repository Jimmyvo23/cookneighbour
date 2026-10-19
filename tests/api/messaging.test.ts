// T-046 (WO-5a, contract 7C): the two chat routes through the real handlers. LOCAL Supabase (CI).
// D-93 frozen = read only; D-94 hidden chats; D-95 admin never sends; D-96 + A-33 notification
// without text; finding 4a stale request; contact guard before acceptance; client id guard.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GET as listRoute,
  POST as sendRoute,
} from "@/app/api/bookings/[id]/messages/route";
import { MESSAGE_RATE_LIMIT, MESSAGE_REFUSALS } from "@/lib/domain/messages";
import { Browser, freshLimits, type Reply } from "./harness";
import {
  accept,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  cancel,
  decline,
  day,
  makeStale,
  noShow,
  notesFor,
  shiftDays,
  svc,
} from "./booking-helpers";
import { newAdmin } from "./chef-helpers";

beforeEach(() => freshLimits());

interface Msg {
  body: string;
  mine: boolean;
}

const withId = (id: string) => ({ params: Promise.resolve({ id }) });
const read = (b: Browser, id: string, qs = ""): Promise<Reply> =>
  b.call(
    (r) =>
      listRoute(
        new Request(`http://localhost/api/bookings/${id}/messages?${qs}`, r),
        withId(id),
      ),
    { method: "GET" },
  );
const post = (
  b: Browser,
  id: string,
  body: unknown,
  o: { contentType?: string | null; raw?: string } = {},
): Promise<Reply> => b.call((r) => sendRoute(r, withId(id)), { body, ...o });
const say = (b: Browser, id: string, text: string, clientId = randomUUID()) =>
  post(b, id, { clientId, body: text });

async function setup(opts: { acceptIt?: boolean } = {}) {
  const chef = await bookableChef();
  const cust = await bookingCustomer();
  const r = await bookOk(
    cust,
    bookingBody(chef, {
      days: [
        { date: day(3), dishes: [{ dishId: chef.dishes.pho, quantity: 1 }] },
      ],
    }),
  );
  if (opts.acceptIt !== false)
    expect((await accept(chef.b, r.id)).status).toBe(200);
  return { chef, cust, id: r.id as string };
}
const count = async (id: string) =>
  (await svc.from("messages").select("id").eq("booking_id", id)).data?.length;

describe("POST /api/bookings/:id/messages", () => {
  it("checks session, role, content type and ownership in house order", async () => {
    const { chef, cust, id } = await setup();
    const anon = new Browser();
    expect((await say(anon, id, "hi")).status).toBe(401);
    expect((await say((await newAdmin()).b, id, "hi")).status).toBe(403);
    expect(
      (await post(cust.b, id, {}, { contentType: "text/plain" })).status,
    ).toBe(400);
    expect((await post(cust.b, id, {}, { raw: "{nope" })).status).toBe(400);
    // Not a party / not a booking: the same 404, even with an invalid body.
    const stranger = await bookingCustomer();
    expect((await say(stranger.b, id, "hi")).status).toBe(404);
    expect((await post(stranger.b, id, { nonsense: 1 })).status).toBe(404);
    expect((await say(cust.b, "not-a-uuid", "hi")).status).toBe(404);
    expect((await say(cust.b, randomUUID(), "hi")).status).toBe(404);
    expect((await say(chef.b, id, "hi")).status).toBe(201);
    expect(await count(id)).toBe(1);
  });

  it("201 with the message and no-store; both parties send and read", async () => {
    const { chef, cust, id } = await setup();
    const clientId = randomUUID();
    const a = await say(cust.b, id, "  Hello chef\nsecond line  ", clientId);
    expect(a.status, a.text).toBe(201);
    expect(a.headers.get("cache-control")).toBe("no-store");
    expect(a.body).toMatchObject({
      bookingId: id,
      senderId: cust.id,
      mine: true,
      clientId,
      body: "Hello chef\nsecond line",
    });
    expect(new Date(a.body.createdAt).toISOString()).toBe(a.body.createdAt);
    expect((await say(chef.b, id, "Hi!")).status).toBe(201);
    const asChef = await read(chef.b, id);
    expect(asChef.status).toBe(200);
    expect(asChef.headers.get("cache-control")).toBe("no-store");
    expect(asChef.body.items.map((m: Msg) => [m.body, m.mine])).toEqual([
      ["Hello chef\nsecond line", false],
      ["Hi!", true],
    ]);
    expect(asChef.body.nextCursor).toBeNull();
  });

  it("validates the body (422 fields), unknown keys included", async () => {
    const { cust, id } = await setup();
    const bad: [unknown, string[]][] = [
      [{}, ["body", "clientId"]],
      [{ clientId: randomUUID(), body: "   " }, ["body"]],
      [{ clientId: randomUUID(), body: "a".repeat(2001) }, ["body"]],
      [{ clientId: randomUUID(), body: "x\u0000y" }, ["body"]],
      [{ clientId: randomUUID(), body: "x\ud800y" }, ["body"]],
      [{ clientId: "nope", body: "hi" }, ["clientId"]],
      [{ clientId: randomUUID(), body: 5 }, ["body"]],
      [{ clientId: randomUUID(), body: "hi", senderId: cust.id }, ["senderId"]],
    ];
    for (const [b, keys] of bad) {
      const r = await post(cust.b, id, b);
      expect(r.status, JSON.stringify(b)).toBe(422);
      expect(r.body.error.code).toBe("VALIDATION_FAILED");
      expect(Object.keys(r.body.error.fields).sort()).toEqual(keys);
    }
    expect((await say(cust.b, id, "b".repeat(2000))).status).toBe(201);
    expect(await count(id)).toBe(1);
  });

  it("cannot be spoofed: the sender is the session user", async () => {
    const { chef, cust, id } = await setup();
    const r = await post(cust.b, id, {
      clientId: randomUUID(),
      body: "hi",
      sender_id: chef.id,
    });
    expect(r.status).toBe(422);
    const ok = await say(cust.b, id, "hi");
    expect(ok.body.senderId).toBe(cust.id);
  });

  it("before acceptance a phone number, email or link is 422; after acceptance it is allowed", async () => {
    const { chef, cust, id } = await setup({ acceptIt: false });
    for (const t of [
      "call me on 416 555 0199",
      "write to me@example.com",
      "see https://example.com/x",
    ]) {
      for (const who of [cust, chef]) {
        const r = await say(who.b, id, t);
        expect(r.status, t).toBe(422);
        expect(r.body.error.code).toBe("CONTACT_DETAILS_NOT_ALLOWED");
        expect(r.body.error.fields.body).toBeTruthy();
        expect(r.body.error.message).not.toContain("416");
      }
    }
    expect(await count(id)).toBe(0);
    expect(
      (await say(cust.b, id, "Is Tuesday at 6 fine? 2 dishes")).status,
    ).toBe(201);
    expect((await accept(chef.b, id)).status).toBe(200);
    expect((await say(cust.b, id, "call me on 416 555 0199")).status).toBe(201);
  });

  it("a retry with the same clientId returns the first message (200), one row, one notification", async () => {
    const { chef, cust, id } = await setup();
    const clientId = randomUUID();
    const a = await say(cust.b, id, "once", clientId);
    const b = await say(cust.b, id, "once", clientId);
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.body.id).toBe(a.body.id);
    expect(await count(id)).toBe(1);
    expect(
      (await notesFor(chef.id, "new_message")).filter(
        (n) => n.booking_id === id,
      ),
    ).toHaveLength(1);
    const reuse = await say(cust.b, id, "something else", clientId);
    expect(reuse.status).toBe(409);
    expect(reuse.body.error).toMatchObject({
      code: "INVALID_STATE",
      reason: "message_id_reused",
      message: MESSAGE_REFUSALS.message_id_reused,
    });
  });

  it("D-96 / A-33: the other party gets one notification per message, without the text", async () => {
    const { chef, cust, id } = await setup();
    const secret = `Peanut-${randomUUID().slice(0, 8)} 416 555 0199`;
    await say(cust.b, id, secret);
    await say(cust.b, id, "second");
    await say(chef.b, id, "reply");
    const toChef = (await notesFor(chef.id, "new_message")).filter(
      (n) => n.booking_id === id,
    );
    const toCust = (await notesFor(cust.id, "new_message")).filter(
      (n) => n.booking_id === id,
    );
    expect([toChef.length, toCust.length]).toEqual([2, 1]);
    for (const n of [...toChef, ...toCust]) {
      const text = `${n.title} ${n.body}`;
      expect(text).not.toContain("Peanut");
      expect(text).not.toContain("second");
      expect(text).not.toContain("reply");
      expect(text).not.toMatch(/\d{3}/);
    }
  });

  it("D-94: declined, cancelled, expired and no-show chats take no messages", async () => {
    // declined
    const a = await setup({ acceptIt: false });
    expect((await decline(a.chef.b, a.id)).status).toBe(200);
    // cancelled
    const b = await setup({ acceptIt: false });
    expect((await cancel(b.cust.b, b.id)).status).toBe(200);
    // expired (a stale request is swept by this very call: finding 4a)
    const c = await setup({ acceptIt: false });
    await makeStale(c.id);
    // customer no-show
    const d = await setup();
    await shiftDays(d.id, 3);
    expect((await noShow(d.chef.b, d.id)).body.status).toBe("no_show_customer");
    for (const s of [a, b, c, d]) {
      for (const who of [s.cust, s.chef]) {
        const r = await say(who.b, s.id, "hello?");
        expect(r.status, r.text).toBe(409);
        expect(r.body.error).toMatchObject({
          code: "INVALID_STATE",
          reason: "chat_hidden",
          message: MESSAGE_REFUSALS.chat_hidden,
        });
      }
      expect(await count(s.id)).toBe(0);
    }
    const row = await svc
      .from("bookings")
      .select("status")
      .eq("id", c.id)
      .single();
    expect(row.data?.status).toBe("expired");
  });

  it("D-94: a completed booking's chat stays open", async () => {
    const { chef, cust, id } = await setup();
    const up = await svc
      .from("bookings")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", id);
    expect(up.error).toBeNull();
    expect((await say(cust.b, id, "thank you")).status).toBe(201);
    expect((await say(chef.b, id, "my pleasure")).status).toBe(201);
  });

  it("D-93: a frozen booking is read only (409 frozen), reading still works", async () => {
    const { chef, cust, id } = await setup();
    expect((await say(cust.b, id, "before")).status).toBe(201);
    const f = await svc
      .from("booking_flags")
      .insert({ booking_id: id, reason: "chef_rejected" });
    expect(f.error).toBeNull();
    for (const who of [cust, chef]) {
      const r = await say(who.b, id, "during");
      expect(r.status).toBe(409);
      expect(r.body.error).toMatchObject({
        code: "INVALID_STATE",
        reason: "frozen",
        message: MESSAGE_REFUSALS.frozen,
      });
      const rd = await read(who.b, id);
      expect(rd.status).toBe(200);
      expect(rd.body.items).toHaveLength(1);
    }
    expect(await count(id)).toBe(1);
  });

  it("is rate limited per user: the extra message is 429 with Retry-After", async () => {
    const { cust, id } = await setup();
    for (let i = 0; i < MESSAGE_RATE_LIMIT.limit; i++)
      expect((await say(cust.b, id, `m${i}`)).status).toBe(201);
    const r = await say(cust.b, id, "one too many");
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("RATE_LIMITED");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await count(id)).toBe(MESSAGE_RATE_LIMIT.limit);
  });
});

describe("GET /api/bookings/:id/messages", () => {
  it("is for the booking's customer and chef only", async () => {
    const { chef, cust, id } = await setup();
    await say(cust.b, id, "private");
    expect((await read(cust.b, id)).status).toBe(200);
    expect((await read(chef.b, id)).status).toBe(200);
    const stranger = await bookingCustomer();
    expect((await read(stranger.b, id)).status).toBe(404);
    const otherChef = await bookableChef();
    expect((await read(otherChef.b, id)).status).toBe(404);
    expect((await read((await newAdmin()).b, id)).status).toBe(403);
    expect((await read(cust.b, "x")).status).toBe(404);
    const anon = new Browser();
    expect((await read(anon, id)).status).toBe(401);
  });

  it("pages oldest first with a stable cursor; new messages never reorder old pages", async () => {
    const { chef, cust, id } = await setup();
    const sent: string[] = [];
    for (let i = 0; i < 5; i++) {
      const who = i % 2 ? chef : cust;
      expect((await say(who.b, id, `m${i}`)).status).toBe(201);
      sent.push(`m${i}`);
    }
    const p1 = await read(cust.b, id, "limit=2");
    expect(p1.body.items.map((m: Msg) => m.body)).toEqual(["m0", "m1"]);
    expect(p1.body.nextCursor).toEqual(expect.any(String));
    // A new message arrives between the two reads: the old order does not move.
    await say(cust.b, id, "m5");
    sent.push("m5");
    const p2 = await read(cust.b, id, `limit=2&cursor=${p1.body.nextCursor}`);
    expect(p2.body.items.map((m: Msg) => m.body)).toEqual(["m2", "m3"]);
    const p3 = await read(cust.b, id, `limit=2&cursor=${p2.body.nextCursor}`);
    expect(p3.body.items.map((m: Msg) => m.body)).toEqual(["m4", "m5"]);
    expect(p3.body.nextCursor).toBeNull();
    const all = await read(cust.b, id, "limit=50");
    expect(all.body.items.map((m: Msg) => m.body)).toEqual(sent);
    expect(all.body.items.map((m: Msg) => m.mine)).toEqual([
      true,
      false,
      true,
      false,
      true,
      true,
    ]);
  });

  it("an empty chat is an empty page; bad query values are 422", async () => {
    const { cust, id } = await setup();
    const r = await read(cust.b, id);
    expect(r.body).toEqual({ items: [], nextCursor: null });
    const bad = await read(cust.b, id, "limit=0&cursor=zzz&sort=desc");
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual([
      "cursor",
      "limit",
      "sort",
    ]);
    expect((await read(cust.b, id, "limit=51")).status).toBe(422);
    expect((await read(cust.b, id, "limit=1&limit=2")).status).toBe(422);
  });

  it("a hidden chat is 409 chat_hidden for the parties; the history is not returned", async () => {
    const { chef, cust, id } = await setup({ acceptIt: false });
    await say(cust.b, id, "hello before decline");
    expect((await decline(chef.b, id)).status).toBe(200);
    for (const who of [cust, chef]) {
      const r = await read(who.b, id);
      expect(r.status).toBe(409);
      expect(r.body.error.reason).toBe("chat_hidden");
      expect(r.text).not.toContain("hello before decline");
    }
    // The database row is still there (D-95: the admin can read it through row-level security).
    expect(await count(id)).toBe(1);
  });

  it("a stale request is swept before reading: chat_hidden and the booking is expired", async () => {
    const { cust, id } = await setup({ acceptIt: false });
    await say(cust.b, id, "hello");
    await makeStale(id);
    const r = await read(cust.b, id);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("chat_hidden");
    const row = await svc
      .from("bookings")
      .select("status")
      .eq("id", id)
      .single();
    expect(row.data?.status).toBe("expired");
  });
});
