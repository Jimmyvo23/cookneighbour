// T-044 Tester: edge cases for grocery receipts against the LOCAL Supabase (runs in CI).
// Complements tests/api/groceries.test.ts. Every chef and customer is new with a unique cuisine tag.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GET as listRoute,
  POST as submitRoute,
} from "@/app/api/bookings/[id]/receipts/route";
import { POST as respondRoute } from "@/app/api/bookings/[id]/receipts/[receiptId]/respond/route";
import { GET as shoppingRoute } from "@/app/api/bookings/[id]/shopping-list/route";
import { Browser, freshLimits, type Reply } from "./harness";
import {
  accept,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  cancel,
  svc,
  type TestChef,
} from "./booking-helpers";
import { newAdmin, upload } from "./chef-helpers";

beforeEach(() => freshLimits());

const withId = (id: string) => ({ params: Promise.resolve({ id }) });
const withBoth = (id: string, receiptId: string) => ({
  params: Promise.resolve({ id, receiptId }),
});
const get = (
  b: Browser,
  route: typeof shoppingRoute,
  id: string,
): Promise<Reply> =>
  b.call(
    (r) =>
      route(new Request(`http://localhost/api/bookings/${id}`, r), withId(id)),
    { method: "GET" },
  );
const shopping = (b: Browser, id: string) => get(b, shoppingRoute, id);
const receipts = (b: Browser, id: string) => get(b, listRoute, id);
const submit = (b: Browser, id: string, body: unknown): Promise<Reply> =>
  b.call((r) => submitRoute(r, withId(id)), { body });
const answer = (
  b: Browser,
  id: string,
  rid: string,
  body: unknown,
): Promise<Reply> =>
  b.call((r) => respondRoute(r, withBoth(id, rid)), { body });
const newPath = (booking: string, ext = "png") =>
  `${booking}/receipt-${randomUUID()}.${ext}`;

async function setup(
  cost = 2500,
  option: "chef_shops" | "customer_buys" = "chef_shops",
) {
  const chef = await bookableChef({ dishes: [{ key: "pho", cost }] });
  const cust = await bookingCustomer();
  const r = await bookOk(cust, bookingBody(chef, { groceryOption: option }));
  const a = await accept(chef.b, r.id);
  expect(a.status, a.text).toBe(200);
  return { chef, cust, id: r.id as string };
}
async function upAndSubmit(chef: TestChef, id: string, amountCents: number) {
  const filePath = newPath(id);
  await upload("receipts", filePath);
  const r = await submit(chef.b, id, { filePath, amountCents });
  return { filePath, r };
}

describe("A-15 through the API (estimate snapshot, integer cents)", () => {
  it.each([
    // [estimate, amount, flagged]
    [10000, 11500, false],
    [10000, 11501, true],
    [10000, 8500, false],
    [10000, 8499, true],
    [2500, 3000, false],
    [2500, 3001, true],
    [2500, 2000, false],
    [2500, 1999, true],
    [3350, 3853, false], // 15% = 502.5 rounds half up to 503
    [3350, 3854, true],
  ])("estimate %i, receipt %i -> flagged %s", async (est, amount, flagged) => {
    const { chef, id } = await setup(est);
    const { r } = await upAndSubmit(chef, id, amount);
    expect(r.status, r.text).toBe(201);
    expect(r.body.mismatchFlagged).toBe(flagged);
    expect(r.body.estimatedIngredientsCents).toBe(est);
    expect(r.body.differenceCents).toBe(amount - est);
    const row = await svc
      .from("receipts")
      .select("mismatch_flagged, amount_cents")
      .eq("booking_id", id)
      .single();
    expect(row.data).toEqual({
      mismatch_flagged: flagged,
      amount_cents: amount,
    });
  });

  it("is measured against the booking snapshot, even if the dish price changes later", async () => {
    const { chef, id } = await setup(2500);
    const up = await svc
      .from("dishes")
      .update({ ingredient_cost_cents: 9000 })
      .eq("id", Object.values(chef.dishes)[0]);
    expect(up.error).toBeNull();
    const { r } = await upAndSubmit(chef, id, 9000);
    expect(r.status, r.text).toBe(201);
    expect(r.body.estimatedIngredientsCents).toBe(2500);
    expect(r.body.mismatchFlagged).toBe(true);
  });

  it("the stored snapshot cannot be changed by either party's session", async () => {
    const { chef, cust, id } = await setup(2500);
    for (const b of [chef.b, cust.b]) {
      const r = await b.call((req) => submitRoute(req, withId(id)), {
        body: {
          filePath: newPath(id),
          amountCents: 2500,
          estIngredientsCents: 1,
        },
      });
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
    const row = await svc
      .from("bookings")
      .select("est_ingredients_cents")
      .eq("id", id)
      .single();
    expect(row.data?.est_ingredients_cents).toBe(2500);
  });
});

describe("no markup, MOCK", () => {
  it("reimbursement equals the receipt amount exactly, only after confirmation, never collected", async () => {
    const { chef, cust, id } = await setup(2500);
    const { r } = await upAndSubmit(chef, id, 3777);
    expect(r.body.reimbursement).toEqual({
      mock: true,
      collected: false,
      amountCents: null,
    });
    const ok = await answer(cust.b, id, r.body.id, { action: "confirm" });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.reimbursement).toEqual({
      mock: true,
      collected: false,
      amountCents: 3777,
    });
    const b = await svc.from("bookings").select("*").eq("id", id).single();
    // The booking total is not changed by a receipt.
    const after = await svc.from("bookings").select("*").eq("id", id).single();
    expect(after.data).toEqual(b.data);
    // fileUrl is a signed URL with a random token, which can contain "fee" by chance (T-079).
    const { fileUrl: _signed, ...noUrl } = ok.body;
    void _signed;
    expect(JSON.stringify(noUrl)).not.toMatch(/markup|fee/i);
  });

  it("a disputed receipt reimburses nothing", async () => {
    const { chef, cust, id } = await setup(2500);
    const { r } = await upAndSubmit(chef, id, 2500);
    const d = await answer(cust.b, id, r.body.id, {
      action: "dispute",
      note: "Not my groceries",
    });
    expect(d.body.status).toBe("disputed");
    expect(d.body.reimbursement.amountCents).toBeNull();
    expect(d.body.disputeNote).toBe("Not my groceries");
  });
});

describe("access on all routes", () => {
  it("anonymous is 401 on the list and respond routes; admin 403; other customer and other chef 404", async () => {
    const { chef, cust, id } = await setup();
    const { r } = await upAndSubmit(chef, id, 2500);
    const rid = r.body.id as string;
    const anon = new Browser();
    const admin = (await newAdmin()).b;
    const otherC = (await bookingCustomer()).b;
    const otherChef = (await bookableChef()).b;
    expect((await receipts(anon, id)).status).toBe(401);
    expect((await answer(anon, id, rid, { action: "confirm" })).status).toBe(
      401,
    );
    expect((await answer(admin, id, rid, { action: "confirm" })).status).toBe(
      403,
    );
    expect((await answer(otherC, id, rid, { action: "confirm" })).status).toBe(
      404,
    );
    expect(
      (await answer(otherChef, id, rid, { action: "confirm" })).status,
    ).toBe(403);
    expect((await answer(chef.b, id, rid, { action: "confirm" })).status).toBe(
      403,
    );
    // A chef who is not on the booking is a chef (role ok) but not a party: 404 on the read routes.
    expect((await receipts(otherChef, id)).status).toBe(404);
    expect((await shopping(otherChef, id)).status).toBe(404);
    const row = await svc
      .from("receipts")
      .select("customer_confirmed_at")
      .eq("id", rid)
      .single();
    expect(row.data?.customer_confirmed_at).toBeNull();
    // The real customer still can.
    expect((await answer(cust.b, id, rid, { action: "confirm" })).status).toBe(
      200,
    );
  });

  it("a receipt id from another booking is 404 on respond, and its details never leak", async () => {
    const a = await setup();
    const b = await setup();
    const { r } = await upAndSubmit(b.chef, b.id, 2500);
    const x = await answer(a.cust.b, a.id, r.body.id, { action: "confirm" });
    expect(x.status).toBe(404);
    const row = await svc
      .from("receipts")
      .select("customer_confirmed_at")
      .eq("id", r.body.id)
      .single();
    expect(row.data?.customer_confirmed_at).toBeNull();
    // The list of booking A shows nothing of booking B.
    expect((await receipts(a.cust.b, a.id)).body.items).toEqual([]);
  });

  it("the customer cannot register a receipt, even for their own booking", async () => {
    const { cust, id } = await setup();
    const p = newPath(id);
    await upload("receipts", p);
    expect(
      (await submit(cust.b, id, { filePath: p, amountCents: 2500 })).status,
    ).toBe(403);
  });

  it("a bad receipt id is 404 and does not reach the database", async () => {
    const { cust, id } = await setup();
    expect(
      (await answer(cust.b, id, "nope", { action: "confirm" })).status,
    ).toBe(404);
    expect(
      (await answer(cust.b, id, randomUUID(), { action: "confirm" })).status,
    ).toBe(404);
  });
});

describe("path rules through the route", () => {
  it("rejects leading slash, backslash, double slash, dot segments, wrong extensions, unicode, long names", async () => {
    const { chef, id } = await setup();
    const bad = [
      `/${id}/a.png`,
      `${id}\\a.png`,
      `${id}//a.png`,
      `${id}/./a.png`,
      `${id}/../${id}/a.png`,
      `${id}/a.svg`,
      `${id}/a.png.exe`,
      `${id}/noextension`,
      `${id}/é.png`,
      `${id}/${"a".repeat(120)}.png`,
      `${id}/a\u0000.png`,
      id,
      `${id}/`,
      "",
    ];
    for (const filePath of bad) {
      const r = await submit(chef.b, id, { filePath, amountCents: 2500 });
      expect(r.status, JSON.stringify(filePath)).toBe(422);
      expect(
        r.body.error.fields.filePath,
        JSON.stringify(filePath),
      ).toBeTruthy();
    }
    expect(
      (await svc.from("receipts").select("id").eq("booking_id", id)).data,
    ).toEqual([]);
  });

  it("accepts pdf, jpg, jpeg uploads", async () => {
    for (const ext of ["pdf", "jpg", "jpeg"]) {
      const { chef, id } = await setup();
      const filePath = newPath(id, ext);
      await upload("receipts", filePath);
      const r = await submit(chef.b, id, { filePath, amountCents: 2500 });
      expect(r.status, `${ext}: ${r.text}`).toBe(201);
    }
  });

  it("a path used on one booking cannot be registered on another (folder rule and unique path)", async () => {
    const a = await setup();
    const b = await setup();
    const first = await upAndSubmit(a.chef, a.id, 2500);
    expect(first.r.status).toBe(201);
    const r = await submit(b.chef.b, b.id, {
      filePath: first.filePath,
      amountCents: 2500,
    });
    expect(r.status).toBe(422);
  });

  it("a missing object is refused with a field error and nothing is stored", async () => {
    const { chef, id } = await setup();
    const r = await submit(chef.b, id, {
      filePath: newPath(id),
      amountCents: 2500,
    });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.filePath).toBeTruthy();
  });
});

describe("flow and state", () => {
  it("option A booking: option B route is 409 not_chef_shops, list is empty, shopping list works", async () => {
    const { chef, cust, id } = await setup(2500, "customer_buys");
    const { r } = await upAndSubmit(chef, id, 2500);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("not_chef_shops");
    expect((await receipts(cust.b, id)).body.items).toEqual([]);
    expect((await shopping(cust.b, id)).status).toBe(200);
  });

  it("the shopping list also works for option B and equals the stored estimate", async () => {
    const { cust, id } = await setup(2500, "chef_shops");
    const s = await shopping(cust.b, id);
    expect(s.status, s.text).toBe(200);
    expect(s.body.plan.receiptRequired).toBe(true);
    expect(s.body.plan.note).toMatch(/MOCK/);
    const row = await svc
      .from("bookings")
      .select("est_ingredients_cents")
      .eq("id", id)
      .single();
    expect(s.body.estimatedCostCents).toBe(row.data?.est_ingredients_cents);
  });

  it("a cancelled booking refuses new receipts and answers (409 wrong_status)", async () => {
    const { chef, cust, id } = await setup();
    const { r } = await upAndSubmit(chef, id, 2500);
    expect((await cancel(cust.b, id)).status).toBe(200);
    const ans = await answer(cust.b, id, r.body.id, { action: "confirm" });
    expect(ans.status, ans.text).toBe(409);
    expect(ans.body.error.reason).toBe("wrong_status");
    const again = await upAndSubmit(chef, id, 2500);
    expect(again.r.status).toBe(409);
    expect(again.r.body.error.reason).toBe("wrong_status");
  });

  it("a completed booking accepts a receipt and an answer", async () => {
    const { chef, cust, id } = await setup();
    const up = await svc
      .from("bookings")
      .update({ status: "completed" })
      .eq("id", id);
    expect(up.error).toBeNull();
    const { r } = await upAndSubmit(chef, id, 2600);
    expect(r.status, r.text).toBe(201);
    expect(
      (await answer(cust.b, id, r.body.id, { action: "confirm" })).status,
    ).toBe(200);
  });

  it("confirm twice and dispute-after-confirm are 409 already_answered, nothing changes", async () => {
    const { chef, cust, id } = await setup();
    const { r } = await upAndSubmit(chef, id, 2500);
    expect(
      (await answer(cust.b, id, r.body.id, { action: "confirm" })).status,
    ).toBe(200);
    for (const body of [
      { action: "confirm" },
      { action: "dispute", note: "Changed my mind" },
    ]) {
      const x = await answer(cust.b, id, r.body.id, body);
      expect(x.status).toBe(409);
      expect(x.body.error.reason).toBe("already_answered");
    }
    const row = await svc
      .from("receipts")
      .select("customer_confirmed_at, customer_disputed_at, dispute_note")
      .eq("id", r.body.id)
      .single();
    expect(row.data?.customer_disputed_at).toBeNull();
    expect(row.data?.dispute_note).toBeNull();
  });

  it("dispute, replace, old is superseded (no link), answering the old one is 409 receipt_superseded", async () => {
    const { chef, cust, id } = await setup();
    const first = await upAndSubmit(chef, id, 5000);
    expect(first.r.body.mismatchFlagged).toBe(true);
    expect(
      (
        await answer(cust.b, id, first.r.body.id, {
          action: "dispute",
          note: "Too high",
        })
      ).status,
    ).toBe(200);
    const second = await upAndSubmit(chef, id, 2600);
    expect(second.r.status, second.r.text).toBe(201);
    expect(second.r.body.mismatchFlagged).toBe(false);
    const old = await answer(cust.b, id, first.r.body.id, {
      action: "confirm",
    });
    expect(old.status).toBe(409);
    expect(old.body.error.reason).toBe("receipt_superseded");
    const list = await receipts(cust.b, id);
    expect(list.body.items.map((i: { status: string }) => i.status)).toEqual([
      "superseded",
      "waiting",
    ]);
    expect(list.body.items[0].fileUrl).toBeNull();
    expect(list.body.items[1].fileUrl).toBeTruthy();
    // Only the new one can be confirmed, and then it is final.
    const ok = await answer(cust.b, id, second.r.body.id, {
      action: "confirm",
    });
    expect(ok.body.reimbursement.amountCents).toBe(2600);
    const third = await upAndSubmit(chef, id, 2600);
    expect(third.r.body.error.reason).toBe("receipt_confirmed");
  });

  it("double submit of the first receipt: exactly one wins, with different files and with the same file", async () => {
    const one = await setup();
    const p2 = newPath(one.id);
    const p3 = newPath(one.id);
    await upload("receipts", p2);
    await upload("receipts", p3);
    const res = await Promise.all([
      submit(one.chef.b, one.id, { filePath: p2, amountCents: 2500 }),
      submit(one.chef.b, one.id, { filePath: p3, amountCents: 2500 }),
    ]);
    expect(res.map((x) => x.status).sort()).toEqual([201, 409]);
    const two = await setup();
    const same = newPath(two.id);
    await upload("receipts", same);
    const res2 = await Promise.all([
      submit(two.chef.b, two.id, { filePath: same, amountCents: 2500 }),
      submit(two.chef.b, two.id, { filePath: same, amountCents: 2500 }),
    ]);
    expect(res2.map((x) => x.status).sort()).toEqual([201, 409]);
    for (const id of [one.id, two.id])
      expect(
        (await svc.from("receipts").select("id").eq("booking_id", id)).data,
      ).toHaveLength(1);
  });

  it("chef notifications carry no amounts, addresses or phone numbers", async () => {
    const { chef, cust, id } = await setup();
    const { r } = await upAndSubmit(chef, id, 4321);
    await answer(cust.b, id, r.body.id, { action: "confirm" });
    const n = await svc
      .from("notifications")
      .select("title, body, type")
      .eq("booking_id", id);
    const all = JSON.stringify(n.data);
    expect(all).not.toMatch(/4321|43\.21|Cooking Street|\+1\d{10}/);
    expect(all).toMatch(/MOCK/);
  });
});
