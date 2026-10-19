// T-046 Tester round: edge cases for the two chat routes that tests/api/messaging.test.ts leaves
// open (WO-5a; D-93 to D-96, A-33). LOCAL Supabase (CI only).
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GET as listRoute,
  POST as sendRoute,
} from "@/app/api/bookings/[id]/messages/route";
import { MESSAGE_RATE_LIMIT } from "@/lib/domain/messages";
import { Browser, freshLimits, type Reply } from "./harness";
import {
  accept,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  decline,
  day,
  makeStale,
  notesFor,
  svc,
} from "./booking-helpers";

beforeEach(() => freshLimits());

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
const post = (b: Browser, id: string, body: unknown): Promise<Reply> =>
  b.call((r) => sendRoute(r, withId(id)), { body });
const say = (b: Browser, id: string, text: string, clientId = randomUUID()) =>
  post(b, id, { clientId, body: text });

async function setup(opts: { acceptIt?: boolean; chefDay?: number } = {}) {
  const chef = await bookableChef();
  const cust = await bookingCustomer();
  const r = await bookOk(
    cust,
    bookingBody(chef, {
      days: [
        {
          date: day(opts.chefDay ?? 3),
          dishes: [{ dishId: chef.dishes.pho, quantity: 1 }],
        },
      ],
    }),
  );
  if (opts.acceptIt !== false)
    expect((await accept(chef.b, r.id)).status).toBe(200);
  return { chef, cust, id: r.id as string };
}
const rowsOf = async (id: string) =>
  (await svc.from("messages").select("id, body").eq("booking_id", id)).data ??
  [];
const newMsgNotes = async (userId: string, id: string) =>
  (await notesFor(userId, "new_message")).filter((n) => n.booking_id === id);

describe("body edge cases (route)", () => {
  it("2000 vs 2001 characters are counted AFTER trimming", async () => {
    const { cust, id } = await setup();
    const pad = " \n\t ";
    expect(
      (await say(cust.b, id, `${pad}${"a".repeat(2000)}${pad}`)).status,
    ).toBe(201);
    expect((await say(cust.b, id, "a".repeat(2001))).status).toBe(422);
    expect(
      (await say(cust.b, id, `${pad}${"a".repeat(2001)}${pad}`)).status,
    ).toBe(422);
    expect(await rowsOf(id)).toHaveLength(1);
  });

  it("whitespace-only text of any kind is 422 on body, and writes nothing", async () => {
    const { cust, id } = await setup();
    for (const t of ["", " ", "\n\n", "\t", "\r\n", " ", " ", "　", "﻿"]) {
      const r = await say(cust.b, id, t);
      expect(r.status, JSON.stringify(t)).toBe(422);
      expect(Object.keys(r.body.error.fields)).toEqual(["body"]);
    }
    expect(await rowsOf(id)).toEqual([]);
  });

  it("line breaks and tabs inside the text are kept; other control characters are 422", async () => {
    const { cust, id } = await setup();
    const ok = await say(cust.b, id, "line one\r\nline two\tend");
    expect(ok.status).toBe(201);
    expect(ok.body.body).toBe("line one\r\nline two\tend");
    for (const bad of [
      "bell\u0007x",
      "esc\u001b[0m",
      "del\u007fx",
      "nul\u0000x",
      "lone\udc00",
      "pair\ud83dx",
    ]) {
      const r = await say(cust.b, id, bad);
      expect(r.status, JSON.stringify(bad)).toBe(422);
    }
    expect(await rowsOf(id)).toHaveLength(1);
  });

  // Vertical tab and form feed are control characters too (a trailing one would be trimmed, so
  // they are tested in the middle of the text).
  it("vertical tab and form feed inside a message are 422 (contract 7C)", async () => {
    const { cust, id } = await setup();
    for (const bad of ["a\u000bb", "a\u000cb"])
      expect((await say(cust.b, id, bad)).status, JSON.stringify(bad)).toBe(
        422,
      );
  });

  it("emoji and non-Latin text are stored as sent", async () => {
    const { cust, chef, id } = await setup();
    const text = "Xin chào 🍜 phở bò — 你好 ✓";
    const r = await say(cust.b, id, text);
    expect(r.status).toBe(201);
    const back = await read(chef.b, id);
    expect(back.body.items[0].body).toBe(text);
  });

  it("clientId must be a lower-case UUID; an upper-case one is 422", async () => {
    const { cust, id } = await setup();
    const r = await post(cust.b, id, {
      clientId: randomUUID().toUpperCase(),
      body: "hi",
    });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.error.fields)).toEqual(["clientId"]);
  });

  it("body array/object/null/number types are 422, not 500", async () => {
    const { cust, id } = await setup();
    for (const body of [null, ["a"], { a: 1 }, 5, true]) {
      const r = await post(cust.b, id, { clientId: randomUUID(), body });
      expect(r.status, JSON.stringify(body)).toBe(422);
    }
  });
});

describe("contact guard before acceptance, and after", () => {
  it("catches spaced and punctuated phone numbers, www links, tel: and email; allows dates and times", async () => {
    const { chef, cust, id } = await setup({ acceptIt: false });
    for (const t of [
      "416-555-0199",
      "(416) 555 0199",
      "+1 416 555 0199",
      "4 1 6 5 5 5 0 1 9 9",
      "call 416.555.0199",
      "www.example.com",
      "visit example.com/menu",
      "tel:4165550199",
      "me@example.com",
    ])
      for (const who of [cust, chef])
        expect((await say(who.b, id, t)).status, t).toBe(422);
    expect(await rowsOf(id)).toEqual([]);
    for (const t of [
      "Can you come on 2026-10-31 at 18:00?",
      "Is Tuesday at 6 fine? 2 dishes",
      "Budget is $1,234.50 for 3 days",
    ])
      expect((await say(cust.b, id, t)).status, t).toBe(201);
  });

  it("the guard text of the 422 never echoes the text, and nothing is saved or notified", async () => {
    const { chef, cust, id } = await setup({ acceptIt: false });
    const r = await say(cust.b, id, "my number is 416 555 0199");
    expect(r.status).toBe(422);
    expect(r.text).not.toContain("0199");
    expect(await newMsgNotes(chef.id, id)).toEqual([]);
  });

  it("a chef may share contact details once accepted, and the customer too", async () => {
    const { chef, cust, id } = await setup({ acceptIt: false });
    expect((await say(chef.b, id, "email me@example.com")).status).toBe(422);
    expect((await accept(chef.b, id)).status).toBe(200);
    expect((await say(chef.b, id, "email me@example.com")).status).toBe(201);
    expect((await say(cust.b, id, "call 416 555 0199")).status).toBe(201);
  });

  it("completed bookings allow contact details too (guard is for requested only)", async () => {
    const { cust, id } = await setup();
    await svc
      .from("bookings")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", id);
    expect((await say(cust.b, id, "call 416 555 0199")).status).toBe(201);
  });
});

describe("retry rules (route)", () => {
  it("a retry whose text differs only by outer whitespace is the same message (200)", async () => {
    const { cust, id } = await setup();
    const clientId = randomUUID();
    expect((await say(cust.b, id, "hello", clientId)).status).toBe(201);
    const r = await say(cust.b, id, "  hello \n", clientId);
    expect(r.status).toBe(200);
    expect(await rowsOf(id)).toHaveLength(1);
  });

  it("a retry after the state changed gets the new state's 409, the first row survives", async () => {
    const { chef, cust, id } = await setup();
    const clientId = randomUUID();
    expect((await say(cust.b, id, "saved", clientId)).status).toBe(201);
    await svc
      .from("booking_flags")
      .insert({ booking_id: id, reason: "chef_rejected" });
    let r = await say(cust.b, id, "saved", clientId);
    expect([r.status, r.body.error.reason]).toEqual([409, "frozen"]);
    await svc.from("bookings").update({ status: "no_show_chef" }).eq("id", id);
    r = await say(cust.b, id, "saved", clientId);
    expect([r.status, r.body.error.reason]).toEqual([409, "chat_hidden"]);
    expect(await rowsOf(id)).toHaveLength(1);
    expect(await newMsgNotes(chef.id, id)).toHaveLength(1);
  });

  it("a clientId reused on ANOTHER booking of the same customer is 409 message_id_reused", async () => {
    const a = await setup();
    const chef2 = await bookableChef();
    const r2 = await bookOk(
      a.cust,
      bookingBody(chef2, {
        days: [
          { date: day(5), dishes: [{ dishId: chef2.dishes.pho, quantity: 1 }] },
        ],
      }),
    );
    expect((await accept(chef2.b, r2.id)).status).toBe(200);
    const clientId = randomUUID();
    expect((await say(a.cust.b, a.id, "same", clientId)).status).toBe(201);
    const r = await say(a.cust.b, r2.id, "same", clientId);
    expect([r.status, r.body.error.reason]).toEqual([409, "message_id_reused"]);
    expect(await rowsOf(r2.id)).toEqual([]);
  });

  it("two parallel sends with one clientId: one 201, one 200, one row and one notification", async () => {
    const { chef, cust, id } = await setup();
    const clientId = randomUUID();
    const out = await Promise.all([
      say(cust.b, id, "twin", clientId),
      say(cust.b, id, "twin", clientId),
      say(cust.b, id, "twin", clientId),
    ]);
    expect(out.map((o) => o.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(out.map((o) => o.body.id)).size).toBe(1);
    expect(await rowsOf(id)).toHaveLength(1);
    expect(await newMsgNotes(chef.id, id)).toHaveLength(1);
  });

  it("unfrozen: sending works again once the flag is resolved", async () => {
    const { cust, id } = await setup();
    await svc
      .from("booking_flags")
      .insert({ booking_id: id, reason: "chef_rejected" });
    expect((await say(cust.b, id, "x")).status).toBe(409);
    await svc
      .from("booking_flags")
      .update({ resolved_at: new Date().toISOString() })
      .eq("booking_id", id);
    expect((await say(cust.b, id, "x")).status).toBe(201);
  });
});

describe("order of checks (contract 7C)", () => {
  it("an invalid body on a hidden chat is 422 (shape first), a valid one is 409", async () => {
    const { chef, cust, id } = await setup({ acceptIt: false });
    expect((await decline(chef.b, id)).status).toBe(200);
    expect((await post(cust.b, id, { clientId: "x", body: "hi" })).status).toBe(
      422,
    );
    expect((await say(cust.b, id, "hi")).status).toBe(409);
  });

  it("a stale request: contact-detail text is still 422 first? (status is read after the sweep)", async () => {
    const { cust, id } = await setup({ acceptIt: false });
    await makeStale(id);
    // The sweep marks it expired before the guard runs, so the answer is the hidden chat, not 422.
    const r = await say(cust.b, id, "call 416 555 0199");
    expect([r.status, r.body.error.reason]).toEqual([409, "chat_hidden"]);
  });

  it("the rate limit is per user and runs before the ownership check", async () => {
    const { chef, cust, id } = await setup();
    for (let i = 0; i < MESSAGE_RATE_LIMIT.limit; i++)
      expect((await say(cust.b, id, `m${i}`)).status).toBe(201);
    // The chef has their own budget.
    expect((await say(chef.b, id, "still fine")).status).toBe(201);
    // The customer is over the limit.
    expect((await say(cust.b, id, "x")).status).toBe(429);
    // The same user is limited on a booking that is not theirs as well (429 before 404).
    expect((await say(cust.b, randomUUID(), "x")).status).toBe(429);
  });
});

describe("paging", () => {
  it("rows with an identical created_at are paged by id with no skip and no repeat", async () => {
    const { cust, id } = await setup();
    const t = new Date().toISOString();
    const ins = await svc.from("messages").insert(
      Array.from({ length: 7 }, (_, i) => ({
        booking_id: id,
        sender_id: cust.id,
        body: `tie${i}`,
        created_at: t,
      })),
    );
    expect(ins.error).toBeNull();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const r: Reply = await read(
        cust.b,
        id,
        `limit=2${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(r.status, r.text).toBe(200);
      seen.push(...r.body.items.map((m: { id: string }) => m.id));
      cursor = r.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect([...seen]).toEqual([...seen].sort());
  });

  it("cursor of a message with microsecond precision still pages (the raw DB timestamp is used)", async () => {
    const { chef, cust, id } = await setup();
    for (let i = 0; i < 4; i++)
      expect((await say(i % 2 ? chef.b : cust.b, id, `u${i}`)).status).toBe(
        201,
      );
    const p1 = await read(cust.b, id, "limit=1");
    const p2 = await read(cust.b, id, `limit=1&cursor=${p1.body.nextCursor}`);
    const p3 = await read(cust.b, id, `limit=2&cursor=${p2.body.nextCursor}`);
    expect(
      [p1, p2, p3].flatMap((p) =>
        p.body.items.map((m: { body: string }) => m.body),
      ),
    ).toEqual(["u0", "u1", "u2", "u3"]);
  });

  it("a tampered or foreign cursor is 422 or harmless, never a filter injection or a leak", async () => {
    const a = await setup();
    const b = await setup();
    await say(a.cust.b, a.id, "A-secret");
    await say(b.cust.b, b.id, "B-message");
    const enc = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString("base64url");
    const good = (await read(b.cust.b, b.id, "limit=1")).body;
    expect(good.items).toHaveLength(1);
    for (const c of [
      enc({
        c: '2020-01-01T00:00:00Z",id.neq.x,created_at.gt."1',
        i: randomUUID(),
      }),
      enc({ c: "2020-01-01T00:00:00Z", i: "1),id.not.is.null" }),
      enc({ c: "2020-01-01T00:00:00Z", i: randomUUID(), extra: 1 }),
      enc([1, 2]),
      "!!!",
      "a".repeat(3000),
    ]) {
      const r = await read(b.cust.b, b.id, `cursor=${encodeURIComponent(c)}`);
      expect([r.status, c.slice(0, 20)]).toEqual([422, c.slice(0, 20)]);
    }
    // A valid cursor made on booking A used on booking B returns B's rows only.
    const pa = await read(a.cust.b, a.id, "limit=1");
    await say(a.cust.b, a.id, "A-two");
    const pa2 = await read(a.cust.b, a.id, "limit=1");
    const cur = pa2.body.nextCursor ?? pa.body.nextCursor;
    const r = await read(b.cust.b, b.id, `cursor=${cur ?? "x"}`);
    if (r.status === 200)
      expect(JSON.stringify(r.body)).not.toContain("A-secret");
  });

  it("bad limit and query values are 422 with the field named", async () => {
    const { cust, id } = await setup();
    for (const qs of [
      "limit=abc",
      "limit=-1",
      "limit=1.5",
      "limit=1e1",
      "limit=051x",
    ]) {
      const r = await read(cust.b, id, qs);
      expect(r.status, qs).toBe(422);
      expect(Object.keys(r.body.error.fields)).toEqual(["limit"]);
    }
    expect((await read(cust.b, id, "limit=50")).status).toBe(200);
    expect((await read(cust.b, id, "foo=bar")).status).toBe(422);
  });
});

describe("notifications", () => {
  it("only the other party is notified, once per new message, with no text, name or number", async () => {
    const { chef, cust, id } = await setup();
    const text = `Allergic to peanuts, I live at 12 Elm Street ${randomUUID().slice(0, 6)}`;
    await say(cust.b, id, text);
    await say(chef.b, id, "On my way");
    await say(cust.b, id, "Thanks-zebra");
    const toChef = await newMsgNotes(chef.id, id);
    const toCust = await newMsgNotes(cust.id, id);
    expect([toChef.length, toCust.length]).toEqual([2, 1]);
    for (const n of [...toChef, ...toCust]) {
      const blob = `${n.title} ${n.body}`;
      for (const w of ["peanut", "Elm", "On my way", "zebra", chef.id, cust.id])
        expect(blob.toLowerCase()).not.toContain(String(w).toLowerCase());
    }
  });

  it("refusals (422, 409, 404, 429) create no notification", async () => {
    const { chef, cust, id } = await setup({ acceptIt: false });
    await say(cust.b, id, "call 416 555 0199"); // 422
    await say(cust.b, id, ""); // 422
    await say((await bookingCustomer()).b, id, "stranger"); // 404
    expect(await newMsgNotes(chef.id, id)).toEqual([]);
    expect(await newMsgNotes(cust.id, id)).toEqual([]);
  });
});
