// T-046 Tester round: gaps found after reading the migration (WO-5a, D-93 to D-96, A-33, A-34).
// Adds: direct insert as every role (incl. admin and stranger) on an OPEN chat, rpc refusals for
// admin, a status change hides history at once, unfreeze reopens, check order inside send_message,
// a retry after the state changed, concurrent retries, a client id reused for another booking by
// a sender who IS a party of both, and the stale boundary. Runs in CI only (needs local Supabase).
import { describe, expect, inject, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  anonClient,
  clientFor,
  dayPlus,
  expectCode,
  expectDenied,
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
// Own date range (1100 to 1400 days ahead), so no other file shares these dates.
const future = () => dayPlus(todayTo, 1100 + Math.floor(Math.random() * 300));

interface Setup {
  chef: Person;
  cust: Person;
  id: string;
}
async function chat(
  status: string,
  who?: { chef: Person; cust: Person },
): Promise<Setup> {
  const n = rand(3);
  const chef = who?.chef ?? (await makeChef(svc, `mge-chef-${n}`));
  const cust = who?.cust ?? (await makeCustomer(svc, `mge-cust-${n}`));
  const b = await makeBooking(svc, {
    customer: cust,
    chef,
    dates: [future()],
    status,
  });
  const up = await svc
    .from("bookings")
    .update({ expires_at: "2099-01-01T00:00:00Z" })
    .eq("id", b.id);
  expect(up.error).toBeNull();
  return { chef, cust, id: b.id };
}
const rpcSend = (
  booking: string,
  sender: string,
  body = "hello",
  clientId: string = randomUUID(),
) =>
  svc.rpc("send_message", {
    p_booking: booking,
    p_sender: sender,
    p_client_id: clientId,
    p_body: body,
  });
const send = async (s: Setup, sender: string, body?: string, id?: string) => {
  const r = await rpcSend(s.id, sender, body, id);
  expect(r.error, r.error?.message).toBeNull();
  return r.data as {
    result: string;
    reason?: string;
    duplicate?: boolean;
    message?: { id: string };
  };
};
const rows = async (id: string) =>
  (await svc.from("messages").select("id").eq("booking_id", id)).data ?? [];
const notes = async (id: string) =>
  (
    await svc
      .from("notifications")
      .select("user_id")
      .eq("booking_id", id)
      .eq("type", "new_message")
  ).data ?? [];

describe("direct writes are closed for every role, on an OPEN chat", () => {
  it("customer, chef, admin, stranger and anon cannot insert, upsert, update or delete", async () => {
    const s = await chat("accepted");
    expect((await send(s, s.cust.id, "seed")).result).toBe("ok");
    const clients: [string, Awaited<ReturnType<typeof clientFor>>, string][] = [
      ["customer", await clientFor(s.cust), s.cust.id],
      ["chef", await clientFor(s.chef), s.chef.id],
      ["admin", await clientFor(fx.admin), fx.admin.id],
      ["stranger", await clientFor(fx.c2), fx.c2.id],
      ["anon", anonClient(), s.cust.id],
    ];
    for (const [who, cl, sender] of clients) {
      const row = { booking_id: s.id, sender_id: sender, body: `x-${who}` };
      expectDenied(await cl.from("messages").insert(row).select());
      expectDenied(
        await cl
          .from("messages")
          .upsert({ ...row, client_id: randomUUID() })
          .select(),
      );
      expectDenied(
        await cl
          .from("messages")
          .update({ body: "edited" })
          .eq("booking_id", s.id)
          .select(),
      );
      expectDenied(
        await cl.from("messages").delete().eq("booking_id", s.id).select(),
      );
    }
    const left = await svc
      .from("messages")
      .select("body")
      .eq("booking_id", s.id);
    expect(left.data).toEqual([{ body: "seed" }]);
  });

  it("the admin cannot call send_message or booking_chat_open as anon; admin rpc is refused", async () => {
    const s = await chat("accepted");
    const admin = await clientFor(fx.admin);
    expectCode(
      await admin.rpc("send_message", {
        p_booking: s.id,
        p_sender: s.cust.id,
        p_client_id: randomUUID(),
        p_body: "as admin",
      }),
      "42501",
    );
    expect(await rows(s.id)).toEqual([]);
  });
});

describe("history follows the booking status at once (D-94)", () => {
  it("an open chat turns hidden when the booking is declined, cancelled or no-show, and the admin still reads", async () => {
    for (const next of ["declined", "cancelled", "no_show_chef", "expired"]) {
      const s = await chat("accepted");
      await send(s, s.cust.id, "before");
      const [c, h, a] = await Promise.all(
        [s.cust, s.chef, fx.admin].map(clientFor),
      );
      const q = (cl: typeof c) =>
        cl.from("messages").select("id").eq("booking_id", s.id);
      expectRows(await q(c), 1);
      expectRows(await q(h), 1);
      const up = await svc
        .from("bookings")
        .update({
          status: next,
          ...(next === "cancelled"
            ? { cancelled_at: new Date().toISOString() }
            : {}),
        })
        .eq("id", s.id);
      expect(up.error, next).toBeNull();
      expectNoRows(await q(c));
      expectNoRows(await q(h));
      expectRows(await q(a), 1);
      const open = await c.rpc("booking_chat_open", { p_booking: s.id });
      expect(open.data, next).toBe(false);
    }
  });

  it("the stale boundary: expires_at in the past is hidden, in the near future is open", async () => {
    const s = await chat("requested");
    const set = (ms: number) =>
      svc
        .from("bookings")
        .update({ expires_at: new Date(Date.now() + ms).toISOString() })
        .eq("id", s.id);
    const c = await clientFor(s.cust);
    await set(60_000);
    expect((await send(s, s.cust.id)).result).toBe("ok");
    expectRows(await c.from("messages").select("id").eq("booking_id", s.id), 1);
    await set(-1_000);
    expectNoRows(await c.from("messages").select("id").eq("booking_id", s.id));
    const r = await send(s, s.cust.id);
    expect([r.result, r.reason]).toEqual(["invalid_state", "chat_hidden"]);
    // A request with no expiry time uses created_at + 72 hours (fresh booking: open).
    await svc.from("bookings").update({ expires_at: null }).eq("id", s.id);
  });
});

describe("freeze (D-93): frozen, then unfrozen", () => {
  it("send is refused while a flag is open, history stays readable, and sending works again once resolved", async () => {
    const s = await chat("accepted");
    await send(s, s.cust.id, "one");
    const f = await svc
      .from("booking_flags")
      .insert({ booking_id: s.id, reason: "chef_rejected" });
    expect(f.error).toBeNull();
    for (const who of [s.cust.id, s.chef.id]) {
      const r = await send(s, who, "blocked");
      expect([r.result, r.reason]).toEqual(["invalid_state", "frozen"]);
    }
    expectRows(
      await (
        await clientFor(s.chef)
      )
        .from("messages")
        .select("id")
        .eq("booking_id", s.id),
      1,
    );
    const un = await svc
      .from("booking_flags")
      .update({ resolved_at: new Date().toISOString() })
      .eq("booking_id", s.id);
    expect(un.error).toBeNull();
    expect((await send(s, s.chef.id, "back")).result).toBe("ok");
    expect(await rows(s.id)).toHaveLength(2);
    expect(await notes(s.id)).toHaveLength(2);
  });

  it("order of checks: hidden beats frozen; not-a-party beats everything", async () => {
    const s = await chat("accepted");
    await svc
      .from("booking_flags")
      .insert({ booking_id: s.id, reason: "chef_rejected" });
    await svc
      .from("bookings")
      .update({ status: "no_show_customer" })
      .eq("id", s.id);
    const r = await send(s, s.cust.id);
    expect([r.result, r.reason]).toEqual(["invalid_state", "chat_hidden"]);
    expect((await send(s, fx.c2.id)).result).toBe("not_found");
  });
});

describe("retry rules (T-075)", () => {
  it("a retry after the booking froze or was hidden gets the NEW state, and the saved row survives", async () => {
    const s = await chat("accepted");
    const id = randomUUID();
    const first = await send(s, s.cust.id, "saved", id);
    expect(first.result).toBe("ok");
    await svc
      .from("booking_flags")
      .insert({ booking_id: s.id, reason: "chef_rejected" });
    let r = await send(s, s.cust.id, "saved", id);
    expect([r.result, r.reason]).toEqual(["invalid_state", "frozen"]);
    await svc
      .from("bookings")
      .update({ status: "no_show_chef" })
      .eq("id", s.id);
    r = await send(s, s.cust.id, "saved", id);
    expect([r.result, r.reason]).toEqual(["invalid_state", "chat_hidden"]);
    expect(await rows(s.id)).toHaveLength(1);
    expect(await notes(s.id)).toHaveLength(1);
  });

  it("five parallel sends with one clientId give one row, one notification and exactly one non-duplicate", async () => {
    const s = await chat("accepted");
    const id = randomUUID();
    const out = await Promise.all(
      Array.from({ length: 5 }, () => send(s, s.cust.id, "race", id)),
    );
    expect(out.every((o) => o.result === "ok")).toBe(true);
    expect(out.filter((o) => o.duplicate === false)).toHaveLength(1);
    expect(new Set(out.map((o) => o.message?.id)).size).toBe(1);
    expect(await rows(s.id)).toHaveLength(1);
    expect(await notes(s.id)).toHaveLength(1);
  });

  it("a clientId reused for ANOTHER booking by a sender who is a party of both is message_id_reused", async () => {
    const a = await chat("accepted");
    const b = await chat("accepted", { chef: a.chef, cust: a.cust });
    const id = randomUUID();
    expect((await send(a, a.cust.id, "same text", id)).result).toBe("ok");
    const r = await send(b, a.cust.id, "same text", id);
    expect([r.result, r.reason]).toEqual([
      "invalid_state",
      "message_id_reused",
    ]);
    expect(await rows(b.id)).toEqual([]);
    expect(await notes(b.id)).toEqual([]);
  });

  it("a whitespace-only or NUL body never reaches a stored row", async () => {
    const s = await chat("accepted");
    const nul = await rpcSend(s.id, s.cust.id, "a\u0000b");
    expect(nul.error).not.toBeNull();
    expect(await rows(s.id)).toEqual([]);
  });
});

describe("notification rows (D-96, A-33)", () => {
  it("the sender never gets a row; the other party's row has no name, address or text", async () => {
    const s = await chat("accepted");
    const text = `Peanut allergy, I live at 12 Elm Street ${rand(3)}`;
    await send(s, s.cust.id, text);
    const n = await svc
      .from("notifications")
      .select("user_id, title, body, type, booking_id")
      .eq("booking_id", s.id);
    expect(n.data).toHaveLength(1);
    expect(n.data?.[0]?.user_id).toBe(s.chef.id);
    const blob = JSON.stringify(n.data);
    for (const w of ["Peanut", "Elm", "allergy", "hello"])
      expect(blob).not.toContain(w);
    // The customer cannot see the chef's notification, and the stranger cannot see it either.
    for (const p of [s.cust, fx.c2])
      expectNoRows(
        await (
          await clientFor(p)
        )
          .from("notifications")
          .select("id")
          .eq("booking_id", s.id),
      );
  });
});
