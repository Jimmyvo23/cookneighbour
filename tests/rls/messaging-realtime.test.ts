// T-046 Tester round: Realtime subscriber test against the LOCAL stack (CI only).
// Why it is not flaky: every "nobody receives" claim is only checked AFTER a positive control in the
// same test proved that events do flow (a party and the admin received the same insert), and the
// positive wait is a polling loop that re-sends until something arrives (a late-ready subscription
// costs time, not a failure). A negative can therefore only pass wrongly (never fail wrongly).
import { describe, expect, inject, it } from "vitest";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  anonClient,
  clientFor,
  dayPlus,
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

interface Listener {
  name: string;
  status: string;
  bodies: string[];
  client: SupabaseClient;
  channel: RealtimeChannel;
}
const FINAL = ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"];

async function listen(
  name: string,
  client: SupabaseClient,
  booking: string,
  token?: string,
): Promise<Listener> {
  if (token) await client.realtime.setAuth(token);
  const l = {
    name,
    status: "pending",
    bodies: [] as string[],
    client,
  } as Listener;
  l.channel = client
    .channel(`chat-${name}-${rand(3)}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `booking_id=eq.${booking}`,
      },
      (p) => l.bodies.push((p.new as { body: string }).body),
    )
    .subscribe((s) => {
      l.status = s;
    });
  return l;
}
const until = async (cond: () => boolean, ms: number, step = 250) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return cond();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function session(p: Person) {
  const c = await clientFor(p);
  const { data } = await c.auth.getSession();
  return { c, token: data.session?.access_token };
}

describe("Realtime delivery follows the select policy (D-94, D-95)", () => {
  it("parties and the admin receive an insert; a stranger and anon do not; a hidden chat stops streaming", async () => {
    const n = rand(3);
    const chef = await makeChef(svc, `rt-chef-${n}`);
    const cust = await makeCustomer(svc, `rt-cust-${n}`);
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [dayPlus(todayTo, 1500 + Math.floor(Math.random() * 100))],
      status: "accepted",
    });
    const all: Listener[] = [];
    try {
      const mk = async (name: string, p: Person | null) => {
        if (!p) return listen(name, anonClient(), b.id);
        const s = await session(p);
        return listen(name, s.c, b.id, s.token);
      };
      const customer = await mk("customer", cust);
      const chefL = await mk("chef", chef);
      const admin = await mk("admin", fx.admin);
      const stranger = await mk("stranger", fx.c2);
      const otherChef = await mk("otherChef", fx.h2);
      const anon = await mk("anon", null);
      all.push(customer, chefL, admin, stranger, otherChef, anon);

      // Everyone who must be able to listen is subscribed (anon may be refused at subscribe time).
      expect(
        await until(() => all.every((l) => FINAL.includes(l.status)), 20_000),
        all.map((l) => `${l.name}:${l.status}`).join(" "),
      ).toBe(true);
      for (const l of [customer, chefL, admin, stranger, otherChef])
        expect(l.status, l.name).toBe("SUBSCRIBED");

      // Positive control: send until all three entitled listeners got a message.
      const sent: string[] = [];
      const entitled = [customer, chefL, admin];
      const got = () => entitled.every((l) => l.bodies.length > 0);
      for (let i = 0; i < 12 && !got(); i++) {
        const body = `live-${i}-${rand(2)}`;
        const r = await svc.rpc("send_message", {
          p_booking: b.id,
          p_sender: cust.id,
          p_client_id: randomUUID(),
          p_body: body,
        });
        expect(r.error, r.error?.message).toBeNull();
        expect((r.data as { result: string }).result).toBe("ok");
        sent.push(body);
        await until(got, 2_500);
      }
      expect(
        got(),
        entitled.map((l) => `${l.name}:${l.bodies.length}`).join(" "),
      ).toBe(true);
      expect(sent).toContain(customer.bodies[0]);

      // Let any wrongly delivered event arrive, then check the people who must get nothing.
      await sleep(3_000);
      for (const l of [stranger, otherChef, anon])
        expect(l.bodies, l.name).toEqual([]);

      // The booking is declined (D-94): a later insert reaches the admin only.
      const up = await svc
        .from("bookings")
        .update({ status: "declined" })
        .eq("id", b.id);
      expect(up.error).toBeNull();
      const before = {
        customer: customer.bodies.length,
        chef: chefL.bodies.length,
      };
      const marker = `after-hide-${rand(3)}`;
      const ins = await svc.from("messages").insert({
        booking_id: b.id,
        sender_id: cust.id,
        body: marker,
      });
      expect(ins.error).toBeNull();
      expect(
        await until(() => admin.bodies.includes(marker), 20_000),
        "admin control event",
      ).toBe(true);
      await sleep(3_000);
      expect(customer.bodies.length, "customer").toBe(before.customer);
      expect(chefL.bodies.length, "chef").toBe(before.chef);
      for (const l of [stranger, otherChef, anon])
        expect(l.bodies, l.name).toEqual([]);
    } finally {
      for (const l of all) {
        await l.client.removeChannel(l.channel).catch(() => undefined);
        await l.client.realtime.disconnect();
      }
    }
  }, 120_000);
});
