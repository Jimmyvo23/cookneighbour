// T-064 Tester: gaps left by tests/api/flag-freeze.test.ts. Runs against the LOCAL Supabase (CI).
// - D-65: the customer's pickup proposal is refused on a frozen booking (chef's-home booking);
// - D-53: a chef's receipt submit is 409 frozen, nothing is stored;
// - D-66: the customer's receipt confirm and dispute still work on a frozen booking;
// - D-68 through the route: rejecting a chef with an open no_day_cooked flag freezes the booking;
// - BookingDetail.frozen is never shown to a stranger (404) or to an anonymous caller (401).
// Every chef and customer is new, so no date or list is shared with another file.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as submitRoute } from "@/app/api/bookings/[id]/receipts/route";
import { POST as respondRoute } from "@/app/api/bookings/[id]/receipts/[receiptId]/respond/route";
import { POST as rejectRoute } from "@/app/api/admin/chefs/[id]/reject/route";
import { CHANGE_REFUSALS } from "@/lib/domain/bookingChanges";
import { Browser, freshLimits, type Reply } from "./harness";
import {
  accept,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  bookingRow,
  cooked,
  day,
  getBooking,
  propose,
  shiftDays,
  svc,
  type TestChef,
} from "./booking-helpers";
import { newAdmin, upload } from "./chef-helpers";

beforeEach(() => freshLimits());

const withId = (id: string) => ({ params: Promise.resolve({ id }) });
const submit = (b: Browser, id: string, body: unknown): Promise<Reply> =>
  b.call((r) => submitRoute(r, withId(id)), { body });
const answer = (b: Browser, id: string, rid: string, body: unknown) =>
  b.call(
    (r) => respondRoute(r, { params: Promise.resolve({ id, receiptId: rid }) }),
    { body },
  );

async function setup() {
  const chef = await bookableChef({
    options: ["customer_home", "chef_home"],
    homeEnabled: true,
    dishes: [{ key: "pho", shelf: 2 }],
  });
  const cust = await bookingCustomer();
  const r = await bookOk(
    cust,
    bookingBody(chef, {
      days: [
        { date: day(3), dishes: [{ dishId: chef.dishes.pho, quantity: 1 }] },
      ],
      locationType: "chef_home",
      address: undefined,
      groceryOption: "chef_shops",
    }),
  );
  expect((await accept(chef.b, r.id)).status).toBe(200);
  return { chef, cust, id: r.id as string };
}

async function reject(chef: TestChef) {
  const admin = await newAdmin();
  const rj = await admin.b.call(
    (req) => rejectRoute(req, { params: Promise.resolve({ id: chef.id }) }),
    { body: { reason: "Documents did not pass." } },
  );
  expect(rj.status, rj.text).toBe(200);
}

async function receiptFor(chef: TestChef, id: string) {
  const filePath = `${id}/receipt-${randomUUID()}.png`;
  await upload("receipts", filePath);
  const r = await submit(chef.b, id, { filePath, amountCents: 2500 });
  return { filePath, r };
}

describe("D-65: a frozen booking refuses the customer's pickup proposal", () => {
  it("409 frozen, no proposal stored, status unchanged", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    expect((await cooked(chef.b, id, 1)).status).toBe(200);
    await reject(chef);
    const when = new Date(Date.now() + 86_400_000).toISOString();
    const r = await propose(cust.b, id, 1, { proposedAt: when });
    expect(r.status, r.text).toBe(409);
    expect(r.body.error).toMatchObject({
      code: "INVALID_STATE",
      reason: "frozen",
      message: CHANGE_REFUSALS.frozen,
    });
    const p = await svc
      .from("pickup_proposals")
      .select("id")
      .eq("booking_id", id);
    expect(p.data).toEqual([]);
    expect((await bookingRow(id)).status).toBe("accepted");
  });
});

describe("receipts on a frozen booking (D-53 chef, D-66 customer)", () => {
  it("the chef's new receipt is 409 frozen and stores nothing", async () => {
    const { chef, id } = await setup();
    await reject(chef);
    const { r } = await receiptFor(chef, id);
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.reason).toBe("frozen");
    const rows = await svc.from("receipts").select("id").eq("booking_id", id);
    expect(rows.data).toEqual([]);
  });

  it.each([
    ["confirm", { action: "confirm" }],
    ["dispute", { action: "dispute", note: "The total looks too high." }],
  ])(
    "an earlier receipt can still be %s-ed by the customer; the booking stays frozen",
    async (_n, body) => {
      const { chef, cust, id } = await setup();
      const { r } = await receiptFor(chef, id);
      expect(r.status, r.text).toBe(201);
      await reject(chef);
      const a = await answer(cust.b, id, r.body.id, body);
      expect(a.status, a.text).toBe(200);
      const got = await getBooking(cust.b, id);
      expect(got.body.status).toBe("accepted");
      expect(got.body.frozen).toBe(true);
    },
  );
});

describe("D-68 through the route", () => {
  it("rejecting a chef whose booking has an open no_day_cooked flag freezes it, and the chef cannot mark a day", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 5);
    expect((await getBooking(cust.b, id)).body.frozen).toBe(false); // lazy sweep flags it
    await reject(chef);
    const f = await svc
      .from("booking_flags")
      .select("reason, resolved_at")
      .eq("booking_id", id)
      .single();
    expect(f.data).toMatchObject({
      reason: "chef_rejected",
      resolved_at: null,
    });
    expect((await getBooking(cust.b, id)).body.frozen).toBe(true);
    const c = await cooked(chef.b, id, 1);
    expect(c.status).toBe(409);
    expect(c.body.error.reason).toBe("frozen");
  });
});

describe("BookingDetail.frozen is only for the two parties", () => {
  it("a stranger customer, another chef and a signed-out caller get no detail", async () => {
    const { chef, cust, id } = await setup();
    await reject(chef);
    const stranger = await bookingCustomer();
    const other = await bookableChef();
    const anon = new Browser();
    for (const b of [stranger.b, other.b]) {
      const r = await getBooking(b, id);
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.body)).not.toMatch(/frozen/);
    }
    expect((await getBooking(anon, id)).status).toBe(401);
    expect((await getBooking(cust.b, id)).body.frozen).toBe(true);
  });
});
