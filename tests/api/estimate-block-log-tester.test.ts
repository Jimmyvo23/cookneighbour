// T-103 Tester round (LOCAL Supabase, runs in CI). The estimate's block log against the real
// record_free_trial_block function, the admin list, and privacy. Every user and chef is new.
import { beforeEach, describe, expect, it } from "vitest";
import { PUT as addressRoute } from "@/app/api/me/address/route";
import { freshLimits } from "./harness";
import {
  decline,
  bookOk,
  bookableChef,
  bookingBody,
  book,
  bookingCustomer,
  day,
  estimate,
  type TestChef,
} from "./booking-helpers";
import { adminBlocks } from "./engagement-helpers";
import { newAdmin, svc } from "./chef-helpers";
import { setPrivate } from "../rls/helpers";

beforeEach(() => freshLimits());

const dayBody = (chef: TestChef, offset: number) => ({
  date: day(offset),
  dishes: [{ dishId: chef.dishes.pho, quantity: 1 }],
});
const ask = (chef: TestChef, offset: number, useFreeTrial = true) =>
  bookingBody(chef, { days: [dayBody(chef, offset)], useFreeTrial });
const rowsOf = async (id: string) =>
  (
    await svc
      .from("free_trial_blocks")
      .select("reason, attempts")
      .eq("customer_id", id)
  ).data;

describe("T-103: estimate block log, real database", () => {
  it("phone rule: same stored phone, different address, logs 'phone' and the admin list shows it with no private data", async () => {
    const chef = await bookableChef();
    const a = await bookingCustomer();
    await bookOk(a, ask(chef, 6));
    const b = await bookingCustomer();
    await setPrivate(svc, b.id, { phone_e164: a.phone });
    const r = await estimate(b, ask(chef, 7));
    expect(r.status, r.text).toBe(200);
    expect(r.body.freeTrial).toEqual({ eligible: false, blocker: "USED" });
    expect(await rowsOf(b.id)).toEqual([{ reason: "phone", attempts: 1 }]);

    const admin = await newAdmin();
    const list = await adminBlocks(admin.b, "limit=50");
    expect(list.status, list.text).toBe(200);
    const mine = list.body.items.filter(
      (x: { customer: { id: string } }) => x.customer.id === b.id,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].reason).toBe("phone");
    const text = JSON.stringify(mine);
    expect(text).not.toContain(a.phone.slice(-7));
    expect(text).not.toContain(a.line);
    expect(text).not.toMatch(/hash/i);
    // The response to the customer is generic and carries no rule name or private value.
    expect(r.text).not.toContain(a.phone.slice(-7));
    expect(r.text).not.toContain(a.line);
    expect(r.text).not.toMatch(/hash|"phone"|"address"/i);
  });

  it("D-154: own second asked-for estimate while the first booking is pending is refused but logs nothing; box off logs nothing", async () => {
    const chef = await bookableChef();
    const a = await bookingCustomer();
    await bookOk(a, ask(chef, 6));
    const off = await estimate(a, ask(chef, 7, false));
    expect(off.status, off.text).toBe(200);
    expect(await rowsOf(a.id)).toEqual([]);
    const on = await estimate(a, ask(chef, 7));
    expect(on.status, on.text).toBe(200);
    expect(on.body.freeTrial).toEqual({ eligible: false, blocker: "USED" });
    expect(await rowsOf(a.id)).toEqual([]);
  });

  it("a declined first booking releases the claim: the estimate is eligible and logs nothing", async () => {
    const chef = await bookableChef();
    const a = await bookingCustomer();
    const booked = await bookOk(a, ask(chef, 6));
    const dr = await decline(chef.b, booked.id, {
      reason: "Sorry, I am away.",
    });
    expect(dr.status, dr.text).toBe(200);
    const r = await estimate(a, ask(chef, 7));
    expect(r.status, r.text).toBe(200);
    expect(r.body.freeTrial).toEqual({ eligible: true, blocker: null });
    expect(await rowsOf(a.id)).toEqual([]);
  });

  it("an eligible customer never logs, with the box on or off", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    expect((await estimate(c, ask(chef, 6))).status).toBe(200);
    expect((await estimate(c, ask(chef, 6, false))).status).toBe(200);
    expect(await rowsOf(c.id)).toEqual([]);
  });

  it("ten parallel estimates make one row whose counter is 10 (advisory lock, no flood)", async () => {
    const chef = await bookableChef();
    const a = await bookingCustomer();
    await bookOk(a, ask(chef, 6));
    const b = await bookingCustomer({ address: false });
    const put = await b.b.call(addressRoute, {
      method: "PUT",
      body: { line: a.line, city: "Mississauga", postalCode: "L5B 1A1" },
    });
    expect(put.status, put.text).toBe(200);
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => estimate(b, ask(chef, 7))),
    );
    for (const r of rs) expect(r.status, r.text).toBe(200);
    expect(await rowsOf(b.id)).toEqual([{ reason: "address", attempts: 10 }]);
  });

  it("admin list `attempts` shows the stored counter (D-155, T-103 round 1)", async () => {
    // After 3 refreshes in one window the column says 3 and so does the admin API.
    const chef = await bookableChef();
    const a = await bookingCustomer();
    await bookOk(a, ask(chef, 6));
    const b = await bookingCustomer({ address: false });
    await b.b.call(addressRoute, {
      method: "PUT",
      body: { line: a.line, city: "Mississauga", postalCode: "L5B 1A1" },
    });
    for (let i = 0; i < 3; i++) await estimate(b, ask(chef, 7));
    expect(await rowsOf(b.id)).toEqual([{ reason: "address", attempts: 3 }]);
    const admin = await newAdmin();
    const list = await adminBlocks(admin.b, "limit=50");
    const mine = list.body.items.filter(
      (x: { customer: { id: string } }) => x.customer.id === b.id,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].attempts).toBe(3);
  });

  it("round 1: several hourly rows sum their stored counters in the admin list (3 + 4 = 7)", async () => {
    const c = await bookingCustomer();
    const ins = await svc.from("free_trial_blocks").insert([
      { customer_id: c.id, reason: "address", attempts: 3 },
      { customer_id: c.id, reason: "address", attempts: 4 },
      { customer_id: c.id, reason: "phone", attempts: 2 },
    ]);
    expect(ins.error).toBeNull();
    const admin = await newAdmin();
    const list = await adminBlocks(admin.b, "limit=50");
    const mine = list.body.items.filter(
      (x: { customer: { id: string } }) => x.customer.id === c.id,
    );
    expect(mine).toHaveLength(3);
    for (const x of mine)
      expect(x.attempts).toBe(x.reason === "address" ? 7 : 2);
  });

  it("round 1: POST /api/bookings still logs the customer's own rule (D-154 covers the estimate only)", async () => {
    const chef = await bookableChef();
    const a = await bookingCustomer();
    await bookOk(a, ask(chef, 6));
    const r = await book(a, ask(chef, 8));
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("FREE_TRIAL_USED");
    expect(await rowsOf(a.id)).toEqual([{ reason: "customer", attempts: 1 }]);
  });
});
