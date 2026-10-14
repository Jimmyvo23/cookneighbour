// T-044: grocery option A shopping list and option B receipts against the LOCAL Supabase
// (contract section 7B, CLAUDE.md 6.4 step 3, 10 receipt mismatch, A-15). Every chef and customer
// is new, with a unique cuisine tag (API tests share one database).
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
  notesFor,
  svc,
  type TestChef,
} from "./booking-helpers";
import { chefClient, newAdmin, upload } from "./chef-helpers";

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
    {
      method: "GET",
    },
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

interface Opts {
  option?: "customer_buys" | "chef_shops";
  home?: boolean;
  accepted?: boolean;
}
/** Estimated ingredients are $25.00 (one dish at 2500 cents), tolerance $5.00. */
async function setup(o: Opts = {}) {
  const chef = await bookableChef({
    options: o.home ? ["customer_home", "chef_home"] : ["customer_home"],
    homeEnabled: o.home === true,
    dishes: [{ key: "pho", cost: 2500 }],
  });
  const cust = await bookingCustomer();
  const r = await bookOk(
    cust,
    bookingBody(chef, {
      groceryOption: o.option ?? "chef_shops",
      ...(o.home ? { locationType: "chef_home", address: undefined } : {}),
    }),
  );
  if (o.accepted !== false) {
    const a = await accept(chef.b, r.id);
    expect(a.status, a.text).toBe(200);
  }
  return { chef, cust, id: r.id };
}

async function upAndSubmit(chef: TestChef, id: string, amountCents: number) {
  const filePath = newPath(id);
  await upload("receipts", filePath);
  const r = await submit(chef.b, id, { filePath, amountCents });
  return { filePath, r };
}

describe("GET /api/bookings/:id/shopping-list (option A)", () => {
  it("both parties see the dishes; the total equals the estimate", async () => {
    const { chef, cust, id } = await setup({ option: "customer_buys" });
    for (const b of [cust.b, chef.b]) {
      const r = await shopping(b, id);
      expect(r.status, r.text).toBe(200);
      expect(r.body.groceryOption).toBe("customer_buys");
      expect(r.body.days).toHaveLength(1);
      expect(r.body.days[0].dishes[0]).toMatchObject({
        name: "Pho bo",
        quantity: 1,
        lineCostCents: 2500,
      });
      expect(r.body.estimatedCostCents).toBe(2500);
      expect(r.body.plan).toMatchObject({
        buyer: "customer",
        customerDeliversToChef: false,
        deliverTo: "customer_home",
      });
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    const detail = await svc
      .from("bookings")
      .select("est_ingredients_cents")
      .eq("id", id)
      .single();
    expect(detail.data?.est_ingredients_cents).toBe(2500);
  });

  it("chef's-home booking: the plan says the customer delivers the ingredients to the chef", async () => {
    const { cust, id } = await setup({ option: "customer_buys", home: true });
    const r = await shopping(cust.b, id);
    expect(r.status, r.text).toBe(200);
    expect(r.body.plan).toMatchObject({
      customerDeliversToChef: true,
      deliverTo: "chef_home",
    });
    expect(JSON.stringify(r.body)).not.toMatch(/phone|address|postal/i);
  });

  it("strangers get 404, admin 403, anonymous 401, a bad id 404", async () => {
    const { id } = await setup({ option: "customer_buys" });
    const other = await bookingCustomer();
    const otherChef = await bookableChef();
    expect((await shopping(other.b, id)).status).toBe(404);
    expect((await shopping(otherChef.b, id)).status).toBe(404);
    expect((await shopping((await newAdmin()).b, id)).status).toBe(403);
    expect((await shopping(new Browser(), id)).status).toBe(401);
    expect((await shopping(other.b, "not-a-uuid")).status).toBe(404);
    expect((await shopping(other.b, randomUUID())).status).toBe(404);
  });
});

describe("POST /api/bookings/:id/receipts (option B)", () => {
  it("chef registers a receipt close to the estimate: not flagged, customer notified", async () => {
    const { chef, cust, id } = await setup();
    const { r } = await upAndSubmit(chef, id, 2900);
    expect(r.status, r.text).toBe(201);
    expect(r.body).toMatchObject({
      bookingId: id,
      amountCents: 2900,
      estimatedIngredientsCents: 2500,
      differenceCents: 400,
      toleranceCents: 500,
      mismatchFlagged: false,
      status: "waiting",
      reimbursement: { mock: true, collected: false, amountCents: null },
    });
    expect(r.body.fileUrl).toBeTruthy();
    const row = await svc
      .from("receipts")
      .select("uploaded_by, file_path")
      .eq("booking_id", id)
      .single();
    expect(row.data).toMatchObject({
      uploaded_by: chef.id,
    });
    expect(row.data?.file_path).toMatch(new RegExp(`^${id}/receipt-`));
    expect((await notesFor(cust.id, "receipt_uploaded")).length).toBe(1);
  });

  it("a receipt more than max(15%, $5) away is flagged, in either direction", async () => {
    const hi = await setup();
    expect(
      (await upAndSubmit(hi.chef, hi.id, 3100)).r.body.mismatchFlagged,
    ).toBe(true);
    const lo = await setup();
    const r = (await upAndSubmit(lo.chef, lo.id, 1900)).r;
    expect(r.body).toMatchObject({
      mismatchFlagged: true,
      differenceCents: -600,
    });
    const edge = await setup();
    expect(
      (await upAndSubmit(edge.chef, edge.id, 3000)).r.body.mismatchFlagged,
    ).toBe(false);
  });

  it("refuses option A bookings and bookings that are not accepted", async () => {
    const a = await setup({ option: "customer_buys" });
    const ra = (await upAndSubmit(a.chef, a.id, 2500)).r;
    expect(ra.status).toBe(409);
    expect(ra.body.error).toMatchObject({
      code: "INVALID_STATE",
      reason: "not_chef_shops",
    });
    const req = await setup({ accepted: false });
    const rr = (await upAndSubmit(req.chef, req.id, 2500)).r;
    expect(rr.status).toBe(409);
    expect(rr.body.error.reason).toBe("wrong_status");
    expect(
      (await svc.from("receipts").select("id").eq("booking_id", req.id)).data,
    ).toEqual([]);
  });

  it("authorization: customer 403, other chef 404, stranger 404, admin 403, anonymous 401", async () => {
    const { cust, id } = await setup();
    const other = await bookableChef();
    const path = newPath(id);
    await upload("receipts", path);
    const body = { filePath: path, amountCents: 2500 };
    expect((await submit(cust.b, id, body)).status).toBe(403);
    expect((await submit(other.b, id, body)).status).toBe(404);
    expect((await submit((await newAdmin()).b, id, body)).status).toBe(403);
    expect((await submit(new Browser(), id, body)).status).toBe(401);
    expect(
      (await svc.from("receipts").select("id").eq("booking_id", id)).data,
    ).toEqual([]);
  });

  it("validates the path and the amount", async () => {
    const { chef, id } = await setup();
    const other = randomUUID();
    const ok = newPath(id);
    await upload("receipts", ok);
    const bad = async (body: Record<string, unknown>, field: string) => {
      const r = await submit(chef.b, id, body);
      expect(r.status, r.text).toBe(422);
      expect(r.body.error.fields[field], r.text).toBeTruthy();
    };
    await bad({ filePath: ok, amountCents: 12.5 }, "amountCents");
    await bad({ filePath: ok, amountCents: 0 }, "amountCents");
    await bad({ filePath: ok, amountCents: "25" }, "amountCents");
    await bad({ filePath: ok, amountCents: 99999999 }, "amountCents");
    await bad({ amountCents: 2500 }, "filePath");
    await bad({ filePath: `${other}/x.png`, amountCents: 2500 }, "filePath");
    await bad(
      { filePath: `${id}/../${other}/x.png`, amountCents: 2500 },
      "filePath",
    );
    await bad({ filePath: `${id}/x.gif`, amountCents: 2500 }, "filePath");
    await bad(
      { filePath: `${id}/never-uploaded.png`, amountCents: 2500 },
      "filePath",
    );
    await bad({ filePath: ok, amountCents: 2500, extra: 1 }, "extra");
    expect(
      (await svc.from("receipts").select("id").eq("booking_id", id)).data,
    ).toEqual([]);
  });

  it("another booking's object cannot be registered here", async () => {
    const a = await setup();
    const b = await setup();
    const path = newPath(b.id);
    await upload("receipts", path);
    const r = await submit(a.chef.b, a.id, {
      filePath: path,
      amountCents: 2500,
    });
    expect(r.status).toBe(422);
  });

  it("one current receipt at a time; a confirmed one is final", async () => {
    const { chef, cust, id } = await setup();
    const first = await upAndSubmit(chef, id, 2500);
    expect(first.r.status).toBe(201);
    const second = await upAndSubmit(chef, id, 2600);
    expect(second.r.status).toBe(409);
    expect(second.r.body.error.reason).toBe("receipt_waiting");
    expect(
      (await answer(cust.b, id, first.r.body.id, { action: "confirm" })).status,
    ).toBe(200);
    const third = await upAndSubmit(chef, id, 2600);
    expect(third.r.status).toBe(409);
    expect(third.r.body.error.reason).toBe("receipt_confirmed");
  });

  it("a registered path cannot be registered again (new name per upload)", async () => {
    const { chef, cust, id } = await setup();
    const first = await upAndSubmit(chef, id, 2500);
    await answer(cust.b, id, first.r.body.id, {
      action: "dispute",
      note: "Wrong total",
    });
    const again = await submit(chef.b, id, {
      filePath: first.filePath,
      amountCents: 2400,
    });
    expect(again.status).toBe(409);
    expect(again.body.error.reason).toBe("path_used");
    const rows = await svc
      .from("receipts")
      .select("id, superseded_at")
      .eq("booking_id", id);
    expect(rows.data).toHaveLength(1);
    expect(rows.data?.[0].superseded_at).toBeNull();
  });

  it("the chef's own session uploads through storage rules, then registers (flow)", async () => {
    const { chef, id } = await setup();
    const c = await chefClient(chef.email);
    const path = newPath(id);
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const up = await c.storage
      .from("receipts")
      .upload(path, png, { contentType: "image/png" });
    expect(up.error).toBeNull();
    const r = await submit(chef.b, id, { filePath: path, amountCents: 2500 });
    expect(r.status, r.text).toBe(201);
    // Overwriting the same path is refused (insert only).
    const again = await c.storage
      .from("receipts")
      .upload(path, png, { contentType: "image/png", upsert: true });
    expect(again.error).not.toBeNull();
  });
});

describe("POST /api/bookings/:id/receipts/:receiptId/respond", () => {
  it("customer confirms: reimbursement at cost is recorded (MOCK), chef notified", async () => {
    const { chef, cust, id } = await setup();
    const { r } = await upAndSubmit(chef, id, 3100);
    expect(r.body.mismatchFlagged).toBe(true);
    const c = await answer(cust.b, id, r.body.id, { action: "confirm" });
    expect(c.status, c.text).toBe(200);
    expect(c.body).toMatchObject({
      status: "confirmed",
      amountCents: 3100,
      reimbursement: { mock: true, collected: false, amountCents: 3100 },
    });
    expect(c.body.customerConfirmedAt).toBeTruthy();
    expect((await notesFor(chef.id, "receipt_confirmed")).length).toBe(1);
    const again = await answer(cust.b, id, r.body.id, {
      action: "dispute",
      note: "Too late",
    });
    expect(again.status).toBe(409);
    expect(again.body.error.reason).toBe("already_answered");
  });

  it("customer disputes with a note; the chef uploads a replacement that supersedes it", async () => {
    const { chef, cust, id } = await setup();
    const first = await upAndSubmit(chef, id, 5000);
    const d = await answer(cust.b, id, first.r.body.id, {
      action: "dispute",
      note: "That total is too high",
    });
    expect(d.status, d.text).toBe(200);
    expect(d.body).toMatchObject({
      status: "disputed",
      disputeNote: "That total is too high",
    });
    expect((await notesFor(chef.id, "receipt_disputed")).length).toBe(1);
    const second = await upAndSubmit(chef, id, 2600);
    expect(second.r.status, second.r.text).toBe(201);
    const list = await receipts(cust.b, id);
    expect(list.status, list.text).toBe(200);
    expect(list.body.items.map((i: { status: string }) => i.status)).toEqual([
      "superseded",
      "waiting",
    ]);
    expect(list.body.items[0].fileUrl).toBeNull();
    const old = await answer(cust.b, id, first.r.body.id, {
      action: "confirm",
    });
    expect(old.status).toBe(409);
    expect(old.body.error.reason).toBe("receipt_superseded");
  });

  it("validates the body", async () => {
    const { chef, cust, id } = await setup();
    const { r } = await upAndSubmit(chef, id, 2500);
    const bad = async (body: Record<string, unknown>, field: string) => {
      const x = await answer(cust.b, id, r.body.id, body);
      expect(x.status, x.text).toBe(422);
      expect(x.body.error.fields[field]).toBeTruthy();
    };
    await bad({}, "action");
    await bad({ action: "pay" }, "action");
    await bad({ action: "dispute" }, "note");
    await bad({ action: "dispute", note: "ab" }, "note");
    await bad({ action: "dispute", note: "bad\u0000text" }, "note");
    await bad({ action: "confirm", note: "hello" }, "note");
    await bad({ action: "confirm", extra: 1 }, "extra");
    const ok = await receipts(cust.b, id);
    expect(ok.body.items[0].status).toBe("waiting");
  });

  it("authorization: chef 403, other customer 404, admin 403, unknown receipt 404", async () => {
    const { chef, cust, id } = await setup();
    const { r } = await upAndSubmit(chef, id, 2500);
    const other = await bookingCustomer();
    expect(
      (await answer(chef.b, id, r.body.id, { action: "confirm" })).status,
    ).toBe(403);
    expect(
      (await answer(other.b, id, r.body.id, { action: "confirm" })).status,
    ).toBe(404);
    expect(
      (await answer((await newAdmin()).b, id, r.body.id, { action: "confirm" }))
        .status,
    ).toBe(403);
    expect(
      (await answer(cust.b, id, randomUUID(), { action: "confirm" })).status,
    ).toBe(404);
    expect(
      (await answer(cust.b, id, "nope", { action: "confirm" })).status,
    ).toBe(404);
    // A receipt of another booking cannot be answered through this booking.
    const b2 = await setup();
    const r2 = (await upAndSubmit(b2.chef, b2.id, 2500)).r;
    expect(
      (await answer(cust.b, id, r2.body.id, { action: "confirm" })).status,
    ).toBe(404);
    expect((await receipts(cust.b, id)).body.items[0].status).toBe("waiting");
  });

  it("two answers at once: exactly one wins", async () => {
    const { chef, cust, id } = await setup();
    const { r } = await upAndSubmit(chef, id, 2500);
    const res = await Promise.all([
      answer(cust.b, id, r.body.id, { action: "confirm" }),
      answer(cust.b, id, r.body.id, { action: "dispute", note: "Not mine" }),
    ]);
    expect(res.map((x) => x.status).sort()).toEqual([200, 409]);
    const row = await svc
      .from("receipts")
      .select("customer_confirmed_at, customer_disputed_at")
      .eq("booking_id", id)
      .single();
    expect(
      Boolean(row.data?.customer_confirmed_at) !==
        Boolean(row.data?.customer_disputed_at),
    ).toBe(true);
  });

  it("an answer racing a replacement cannot both win", async () => {
    const { chef, cust, id } = await setup();
    const first = await upAndSubmit(chef, id, 5000);
    expect(
      (
        await answer(cust.b, id, first.r.body.id, {
          action: "dispute",
          note: "Wrong total",
        })
      ).status,
    ).toBe(200);
    const p2 = newPath(id);
    await upload("receipts", p2);
    const p3 = newPath(id);
    await upload("receipts", p3);
    const res = await Promise.all([
      submit(chef.b, id, { filePath: p2, amountCents: 2500 }),
      submit(chef.b, id, { filePath: p3, amountCents: 2500 }),
    ]);
    expect(res.map((x) => x.status).sort()).toEqual([201, 409]);
    const cur = await svc
      .from("receipts")
      .select("id")
      .eq("booking_id", id)
      .is("superseded_at", null);
    expect(cur.data).toHaveLength(1);
  });
});

describe("GET /api/bookings/:id/receipts", () => {
  it("only the two parties; signed links work for both", async () => {
    const { chef, cust, id } = await setup();
    await upAndSubmit(chef, id, 2500);
    for (const b of [cust.b, chef.b]) {
      const r = await receipts(b, id);
      expect(r.status, r.text).toBe(200);
      expect(r.body).toMatchObject({
        bookingId: id,
        estimatedIngredientsCents: 2500,
      });
      expect(r.body.items).toHaveLength(1);
      const dl = await fetch(r.body.items[0].fileUrl);
      expect(dl.status).toBe(200);
    }
    const other = await bookingCustomer();
    const otherChef = await bookableChef();
    expect((await receipts(other.b, id)).status).toBe(404);
    expect((await receipts(otherChef.b, id)).status).toBe(404);
    expect((await receipts((await newAdmin()).b, id)).status).toBe(403);
  });

  it("is empty for a booking without receipts", async () => {
    const { cust, id } = await setup();
    const r = await receipts(cust.b, id);
    expect(r.body.items).toEqual([]);
  });
});
