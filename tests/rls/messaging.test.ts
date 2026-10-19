// T-046 (WO-5a, migration 20261021100000_messaging.sql): who can read a chat, and the one writer.
// - D-94: parties read the chat of a requested, accepted or completed booking only; declined,
//   cancelled, expired and no-show chats (and a stale request) are hidden from them, so Realtime
//   (which applies the same select policy to every subscriber) stops streaming them too;
// - D-95 / A-34: the admin still reads every chat, and never sends;
// - sending is the function send_message only (service role): party, status, stale request,
//   freeze (D-93), client id guard, one notification per message with no text in it (D-96, A-33).
// A Realtime subscriber test is NOT included: it needs the local Realtime service and a timing
// window that cannot be made reliable in CI. The policy it depends on is tested here by selects.
import { describe, expect, inject, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  anonClient,
  clientFor,
  dayPlus,
  expectCode,
  expectNoRows,
  expectRows,
  makeBooking,
  makeChef,
  makeCustomer,
  rand,
  serviceClient,
  type Person,
} from "./helpers";

const fx = inject("fx");
const svc = serviceClient();
const todayTo = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
}).format(new Date());
const future = () => dayPlus(todayTo, 700 + Math.floor(Math.random() * 300));

interface Setup {
  chef: Person;
  cust: Person;
  id: string;
}
async function chat(status: string): Promise<Setup> {
  const n = rand(3);
  const chef = await makeChef(svc, `msg-chef-${n}`);
  const cust = await makeCustomer(svc, `msg-cust-${n}`);
  const b = await makeBooking(svc, {
    customer: cust,
    chef,
    dates: [future()],
    status,
  });
  // A requested fixture must not run out while the suite runs.
  const up = await svc
    .from("bookings")
    .update({ expires_at: "2099-01-01T00:00:00Z" })
    .eq("id", b.id);
  expect(up.error).toBeNull();
  return { chef, cust, id: b.id };
}

/** send_message as the server calls it (service role). */
const send = async (
  s: Setup,
  sender: string,
  body = "hello",
  clientId: string = randomUUID(),
) => {
  const r = await svc.rpc("send_message", {
    p_booking: s.id,
    p_sender: sender,
    p_client_id: clientId,
    p_body: body,
  });
  expect(r.error, r.error?.message).toBeNull();
  return r.data as {
    result: string;
    reason?: string;
    duplicate?: boolean;
    message?: { id: string; body: string; sender_id: string };
  };
};
const rows = async (id: string) => {
  const r = await svc.from("messages").select("id, body").eq("booking_id", id);
  expect(r.error).toBeNull();
  return r.data ?? [];
};
const flag = async (id: string, reason: "chef_rejected" | "no_day_cooked") => {
  const r = await svc.from("booking_flags").insert({ booking_id: id, reason });
  expect(r.error).toBeNull();
};

describe("who reads a chat (D-94, D-95, A-34)", () => {
  const OPEN = ["requested", "accepted", "completed"];
  const HIDDEN = [
    "declined",
    "cancelled",
    "expired",
    "no_show_customer",
    "no_show_chef",
  ];

  for (const status of [...OPEN, ...HIDDEN]) {
    it(`${status}: ${OPEN.includes(status) ? "both parties read" : "both parties see nothing, the admin reads"}`, async () => {
      const s = await chat(status);
      // The booking is made in its final status; the message is written by the server directly.
      const ins = await svc.from("messages").insert({
        booking_id: s.id,
        sender_id: s.cust.id,
        body: `hi from ${status}`,
      });
      expect(ins.error).toBeNull();
      const [c, h, admin] = await Promise.all(
        [s.cust, s.chef, fx.admin].map(clientFor),
      );
      const q = (cl: typeof c) =>
        cl.from("messages").select("id").eq("booking_id", s.id);
      if (OPEN.includes(status)) {
        expectRows(await q(c), 1);
        expectRows(await q(h), 1);
      } else {
        expectNoRows(await q(c));
        expectNoRows(await q(h));
      }
      expectRows(await q(admin), 1);
    });
  }

  it("a stale request (past its expiry, not swept yet) is hidden; a live one is not", async () => {
    const s = await chat("requested");
    await svc
      .from("messages")
      .insert({ booking_id: s.id, sender_id: s.cust.id, body: "x" });
    const c = await clientFor(s.cust);
    expectRows(await c.from("messages").select("id").eq("booking_id", s.id), 1);
    const up = await svc
      .from("bookings")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", s.id);
    expect(up.error).toBeNull();
    expectNoRows(await c.from("messages").select("id").eq("booking_id", s.id));
    // The admin still reads it (A-34).
    expectRows(
      await (
        await clientFor(fx.admin)
      )
        .from("messages")
        .select("id")
        .eq("booking_id", s.id),
      1,
    );
  });

  it("strangers, the other booking's chef and customer, and anon read nothing", async () => {
    const s = await chat("accepted");
    await svc
      .from("messages")
      .insert({ booking_id: s.id, sender_id: s.chef.id, body: "private" });
    const q = (cl: Awaited<ReturnType<typeof clientFor>>) =>
      cl.from("messages").select("id").eq("booking_id", s.id);
    for (const p of [fx.c1, fx.c2, fx.h1, fx.h2])
      expectNoRows(await q(await clientFor(p)));
    expectNoRows(await q(anonClient()));
  });
});

describe("send_message is the only writer", () => {
  it("a browser cannot call it, not even as a party; booking_chat_open is not for anon", async () => {
    const s = await chat("accepted");
    const c = await clientFor(s.cust);
    const r = await c.rpc("send_message", {
      p_booking: s.id,
      p_sender: s.cust.id,
      p_client_id: randomUUID(),
      p_body: "direct",
    });
    expectCode(r, "42501");
    const a = await anonClient().rpc("send_message", {
      p_booking: s.id,
      p_sender: s.cust.id,
      p_client_id: randomUUID(),
      p_body: "direct",
    });
    expectCode(a, "42501");
    expect(await rows(s.id)).toEqual([]);
    const open = await c.rpc("booking_chat_open", { p_booking: s.id });
    expect(open.error).toBeNull();
    expect(open.data).toBe(true);
    expectCode(
      await anonClient().rpc("booking_chat_open", { p_booking: s.id }),
      "42501",
    );
  });

  it("round 2 LOW-1: a stranger cannot probe an open chat with booking_chat_open; the admin and parties can", async () => {
    const s = await chat("accepted");
    const probe = async (p: Person) =>
      (await clientFor(p)).rpc("booking_chat_open", { p_booking: s.id });
    for (const p of [fx.c2, fx.h2]) {
      const r = await probe(p);
      expect(r.error).toBeNull();
      expect(r.data).toBe(false);
    }
    for (const p of [s.cust, s.chef, fx.admin])
      expect((await probe(p)).data).toBe(true);
  });

  it("round 2 NIT-2: send_message refuses a blank body itself", async () => {
    const s = await chat("accepted");
    const r = await svc.rpc("send_message", {
      p_booking: s.id,
      p_sender: s.cust.id,
      p_client_id: randomUUID(),
      p_body: "   ",
    });
    expectCode(r, "22023");
    expect(await rows(s.id)).toEqual([]);
  });

  it("requested, accepted and completed take messages from both parties", async () => {
    for (const status of ["requested", "accepted", "completed"]) {
      const s = await chat(status);
      expect((await send(s, s.cust.id, "from customer")).result, status).toBe(
        "ok",
      );
      expect((await send(s, s.chef.id, "from chef")).result, status).toBe("ok");
      expect(await rows(s.id)).toHaveLength(2);
    }
  });

  it("hidden statuses and a stale request refuse with chat_hidden and write nothing", async () => {
    for (const status of [
      "declined",
      "cancelled",
      "expired",
      "no_show_customer",
      "no_show_chef",
    ]) {
      const s = await chat(status);
      for (const who of [s.cust.id, s.chef.id]) {
        const r = await send(s, who);
        expect([status, r.result, r.reason]).toEqual([
          status,
          "invalid_state",
          "chat_hidden",
        ]);
      }
      expect(await rows(s.id)).toEqual([]);
    }
    const s = await chat("requested");
    await svc
      .from("bookings")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", s.id);
    const r = await send(s, s.cust.id);
    expect([r.result, r.reason]).toEqual(["invalid_state", "chat_hidden"]);
    expect(await rows(s.id)).toEqual([]);
  });

  it("a stranger, the admin and an unknown booking get not_found", async () => {
    const s = await chat("accepted");
    for (const who of [fx.c2.id, fx.h2.id, fx.admin.id])
      expect((await send(s, who)).result).toBe("not_found");
    const ghost = await svc.rpc("send_message", {
      p_booking: randomUUID(),
      p_sender: s.cust.id,
      p_client_id: randomUUID(),
      p_body: "x",
    });
    expect(ghost.data).toEqual({ result: "not_found" });
    expect(await rows(s.id)).toEqual([]);
  });

  it("D-93: a frozen booking refuses sending but can still be read; no_day_cooked does not freeze", async () => {
    const s = await chat("accepted");
    expect((await send(s, s.cust.id, "before")).result).toBe("ok");
    await flag(s.id, "chef_rejected");
    const r = await send(s, s.chef.id, "during");
    expect([r.result, r.reason]).toEqual(["invalid_state", "frozen"]);
    expect(await rows(s.id)).toHaveLength(1);
    const c = await clientFor(s.cust);
    expectRows(await c.from("messages").select("id").eq("booking_id", s.id), 1);

    const t = await chat("accepted");
    await flag(t.id, "no_day_cooked");
    expect((await send(t, t.cust.id)).result).toBe("ok");
  });

  it("a retried clientId returns the first row, with one message and one notification", async () => {
    const s = await chat("accepted");
    const id = randomUUID();
    const a = await send(s, s.cust.id, "once", id);
    const b = await send(s, s.cust.id, "once", id);
    expect([a.result, a.duplicate, b.result, b.duplicate]).toEqual([
      "ok",
      false,
      "ok",
      true,
    ]);
    expect(b.message?.id).toBe(a.message?.id);
    expect(await rows(s.id)).toHaveLength(1);
    const n = await svc
      .from("notifications")
      .select("id")
      .eq("booking_id", s.id)
      .eq("type", "new_message");
    expect(n.data).toHaveLength(1);
  });

  it("the same clientId for another text or booking is refused; two senders may share one", async () => {
    const s = await chat("accepted");
    const t = await chat("accepted");
    const id = randomUUID();
    await send(s, s.cust.id, "first", id);
    let r = await send(s, s.cust.id, "different", id);
    expect([r.result, r.reason]).toEqual([
      "invalid_state",
      "message_id_reused",
    ]);
    r = await send(t, s.cust.id, "first", id);
    expect(r.result).toBe("not_found"); // not a party of t
    // A different sender can use the same id.
    expect((await send(s, s.chef.id, "reply", id)).result).toBe("ok");
    expect(await rows(s.id)).toHaveLength(2);
  });

  it("refuses an empty or over-long body at the database too", async () => {
    const s = await chat("accepted");
    for (const body of ["", "a".repeat(2001)]) {
      const r = await svc.rpc("send_message", {
        p_booking: s.id,
        p_sender: s.cust.id,
        p_client_id: randomUUID(),
        p_body: body,
      });
      expectCode(r, "22023");
    }
    expect((await send(s, s.cust.id, "a".repeat(2000))).result).toBe("ok");
  });

  it("D-96 / A-33: one notification for the OTHER party per message, without the text", async () => {
    const s = await chat("accepted");
    const secret = `SECRET-${rand(4)} call 416 555 0199`;
    await send(s, s.cust.id, secret);
    await send(s, s.chef.id, `reply ${secret}`);
    const n = await svc
      .from("notifications")
      .select("user_id, type, title, body")
      .eq("booking_id", s.id)
      .eq("type", "new_message");
    expect(n.error).toBeNull();
    expect((n.data ?? []).map((x) => x.user_id).sort()).toEqual(
      [s.chef.id, s.cust.id].sort(),
    );
    for (const row of n.data ?? []) {
      const text = `${row.title} ${row.body}`;
      expect(text).not.toContain("SECRET");
      expect(text).not.toMatch(/\d{3}/);
    }
    // Each party can read only their own notification.
    const mine = await (
      await clientFor(s.chef)
    )
      .from("notifications")
      .select("user_id")
      .eq("booking_id", s.id);
    expect((mine.data ?? []).map((x) => x.user_id)).toEqual([s.chef.id]);
  });

  it("a refused send writes no notification", async () => {
    const s = await chat("declined");
    await send(s, s.cust.id);
    const n = await svc
      .from("notifications")
      .select("id")
      .eq("booking_id", s.id)
      .eq("type", "new_message");
    expect(n.data).toEqual([]);
  });
});
