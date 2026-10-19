import { describe, expect, it } from "vitest";
import type {
  ApiError,
  BookingDetail,
  BookingListResponse,
  ReceiptList,
  ReceiptView,
  ShoppingListResponse,
} from "@/lib/api/types";
import { addDays, torontoToday } from "@/lib/domain/dishes";
import {
  bookingRoutes,
  type BookingMockState,
  type BookingRouteResult,
} from "@/lib/mocks/mock-bookings";
import { seedChefBookings } from "@/lib/mocks/mock-booking-changes";

const NOW = new Date();
const TODAY = torontoToday(NOW);
const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A01 = ID(9101); // requested, customer's home, allergy conflict
const A02 = ID(9102); // requested, chef's home, chef shops
const A03 = ID(9103); // accepted, chef's home, open pickup proposal
const A04 = ID(9104); // accepted, customer's home, chef shops, day 1 today
const A05 = ID(9105); // accepted, chef's home, pickup window over
const A06 = ID(9106); // accepted, customer's home, chef shops, flagged receipt

const chef = (over: Partial<BookingMockState> = {}): BookingMockState => ({
  profile: {
    id: "mock-user-1",
    role: "chef",
    displayName: "Demo chef",
    country: "CA",
    currency: "CAD",
    language: "en",
  },
  phone: null,
  phoneVerified: true,
  address: null,
  bookings: [],
  hooks: {},
  ...over,
});

/** A route call that applies `next` to the state like the adapter does. */
class Session {
  constructor(public s: BookingMockState) {}
  async call(method: string, path: string, body: unknown = {}, now = NOW) {
    const r = bookingRoutes(
      method,
      path,
      body,
      this.s,
      now,
    ) as BookingRouteResult;
    expect(r, `${method} ${path} was not routed`).toBeTruthy();
    if (r.next) this.s = { ...this.s, ...r.next } as BookingMockState;
    const json = await r.res.json();
    return { status: r.res.status, json, error: (json as ApiError).error };
  }
}
const asChef = () => new Session(chef());
const asCustomer = (rows: BookingMockState["bookings"], receipts = {}) =>
  new Session(
    chef({
      profile: { ...chef().profile!, role: "customer" },
      bookings: rows,
      receipts,
    }),
  );

describe("seed dates (T-085): one booking per chef per date", () => {
  const me = chef().profile!;
  const ids = [A01, A02, A03, A04, A05, A06];
  const dupes = (rows: ReturnType<typeof seedChefBookings>["rows"]) => {
    const seen = new Map<string, number>();
    for (const r of rows)
      for (const d of r.detail.days)
        seen.set(d.date, (seen.get(d.date) ?? 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([date]) => date);
  };
  it("has no two booking days of the same chef on one date", () => {
    expect(dupes(seedChefBookings(me, NOW).rows)).toEqual([]);
  });
  it("still has none when the pickedUpSeeded hook adds a day 2 to every booking", () => {
    expect(dupes(seedChefBookings(me, NOW, [], ids).rows)).toEqual([]);
  });
});

describe("seeded requests for a chef", () => {
  it("lists made-up bookings with the customer as counterparty", async () => {
    const c = asChef();
    const { status, json } = await c.call("GET", "/api/bookings?status=all");
    expect(status).toBe(200);
    const list = json as BookingListResponse;
    expect(list.items.map((i) => i.id)).toEqual(
      expect.arrayContaining([A01, A02, A03, A04, A05, A06]),
    );
    expect(list.items.find((i) => i.id === A01)?.counterparty.displayName).toBe(
      "Priya Patel",
    );
    const open = (await c.call("GET", "/api/bookings?status=requested"))
      .json as BookingListResponse;
    expect(open.items.map((i) => i.id).sort()).toEqual([A01, A02]);
  });
  it("seeds once, not on every call", async () => {
    const c = asChef();
    await c.call("POST", `/api/bookings/${A01}/decline`, {
      reason: "Not free then",
    });
    const again = (await c.call("GET", "/api/bookings?status=declined"))
      .json as BookingListResponse;
    expect(again.items.map((i) => i.id)).toEqual([A01]);
  });
  it("shows the intake and the allergy conflict before accepting", async () => {
    const d = (await asChef().call("GET", `/api/bookings/${A01}`))
      .json as BookingDetail;
    expect(d.status).toBe("requested");
    expect(d.viewerRole).toBe("chef");
    expect(d.intake.allergies).toMatch(/peanuts/);
    expect(d.allergyConflicts.map((x) => x.dishName)).toEqual([
      "Chicken satay",
    ]);
  });
  it("hides the customer's address and phone until accepted (6.8)", async () => {
    const c = asChef();
    const req = (await c.call("GET", `/api/bookings/${A01}`))
      .json as BookingDetail;
    expect(req.cookingPlace).toBeNull();
    expect(req.contact).toBeNull();
    const acc = (await c.call("GET", `/api/bookings/${A04}`))
      .json as BookingDetail;
    expect(acc.cookingPlace?.line).toMatch(/Maple/);
    expect(acc.contact?.phone).toMatch(/^\+1416555/);
    // A chef's-home booking never shows a kitchen address to its own chef.
    const home = (await c.call("GET", `/api/bookings/${A03}`))
      .json as BookingDetail;
    expect(home.cookingPlace).toBeNull();
    expect(home.contact?.displayName).toBe("Mei Lin");
  });
  it("an unknown or malformed id is a 404", async () => {
    const c = asChef();
    expect((await c.call("GET", `/api/bookings/${ID(1)}`)).status).toBe(404);
    expect((await c.call("POST", `/api/bookings/nope/accept`)).status).toBe(
      404,
    );
  });
  it("a chef cannot use customer routes", async () => {
    const c = asChef();
    expect((await c.call("POST", "/api/bookings", {})).status).toBe(403);
    expect(
      (await c.call("POST", `/api/bookings/${A03}/days/1/pickup/propose`, {}))
        .status,
    ).toBe(403);
  });
});

describe("accept and decline", () => {
  it("accept moves to accepted and now shows the contact", async () => {
    const c = asChef();
    const r = await c.call("POST", `/api/bookings/${A01}/accept`);
    expect(r.status).toBe(200);
    expect((r.json as BookingDetail).status).toBe("accepted");
    expect((r.json as BookingDetail).contact?.phone).toBeTruthy();
    expect(
      (await c.call("POST", `/api/bookings/${A01}/accept`)).error,
    ).toMatchObject({
      code: "INVALID_STATE",
      reason: "wrong_status",
    });
  });
  it("accepting a chef's-home request while the kitchen is off is refused", async () => {
    const c = new Session(chef({ hooks: { chefHomeOff: true } }));
    const r = await c.call("POST", `/api/bookings/${A02}/accept`);
    expect(r.status).toBe(409);
    expect(r.error.reason).toBe("chef_home_not_enabled");
    // The customer's-home request is not affected.
    expect((await c.call("POST", `/api/bookings/${A01}/accept`)).status).toBe(
      200,
    );
  });
  it("accepting a chef's-home request with no kitchen address is refused with its reason (D-59)", async () => {
    const c = new Session(chef({ hooks: { kitchenAddressMissing: true } }));
    const r = await c.call("POST", `/api/bookings/${A02}/accept`);
    expect(r.status).toBe(409);
    expect(r.error.reason).toBe("kitchen_address_missing");
    expect((await c.call("POST", `/api/bookings/${A01}/accept`)).status).toBe(
      200,
    );
  });
  it("decline needs a reason of 3 to 500 characters (D-34)", async () => {
    const c = asChef();
    for (const body of [
      {},
      { reason: "" },
      { reason: "   " },
      { reason: null },
      { reason: "ab" },
    ]) {
      const r = await c.call("POST", `/api/bookings/${A01}/decline`, body);
      expect(r.status).toBe(422);
      expect(r.error.fields?.reason).toBeTruthy();
    }
    expect(
      (
        await c.call("POST", `/api/bookings/${A01}/decline`, {
          reason: "x".repeat(501),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await c.call("POST", `/api/bookings/${A01}/decline`, {
          reason: "a",
          extra: 1,
        })
      ).status,
    ).toBe(422);
  });
  it("decline refuses phone numbers, emails and links", async () => {
    const c = asChef();
    for (const reason of [
      "call me on 416 555 0100",
      "mail a@b.co",
      "see https://x.test",
    ]) {
      const r = await c.call("POST", `/api/bookings/${A01}/decline`, {
        reason,
      });
      expect(r.status).toBe(422);
      expect(r.error.code).toBe("CONTACT_DETAILS_NOT_ALLOWED");
    }
  });
  it("decline stores the reason and hides the contact", async () => {
    const c = asChef();
    const r = await c.call("POST", `/api/bookings/${A01}/decline`, {
      reason: "  I am away that week  ",
    });
    expect(r.status).toBe(200);
    const d = r.json as BookingDetail;
    expect(d.status).toBe("declined");
    expect(d.declineReason).toBe("I am away that week");
    expect(d.contact).toBeNull();
  });
  it("an expired request answers 409 REQUEST_EXPIRED or is swept to expired", async () => {
    const c = asChef();
    await c.call("GET", "/api/bookings"); // seeds the requests now
    const later = new Date(NOW.getTime() + 100 * 3600 * 1000);
    const r = await c.call("POST", `/api/bookings/${A01}/accept`, {}, later);
    // The lazy sweep runs first, as in the real API, so the booking is already `expired`.
    expect(r.status).toBe(409);
    const d = (await c.call("GET", `/api/bookings/${A01}`, {}, later))
      .json as BookingDetail;
    expect(d.status).toBe("expired");
  });
});

describe("cooked marker and visit done", () => {
  it("cooked is refused before the visit date (too_early)", async () => {
    const c = asChef();
    await c.call("POST", `/api/bookings/${A01}/accept`);
    const r = await c.call("POST", `/api/bookings/${A01}/days/1/cooked`);
    expect(r.error).toMatchObject({
      code: "INVALID_STATE",
      reason: "too_early",
    });
  });
  it("cooked needs an accepted booking and a real day number", async () => {
    const c = asChef();
    expect(
      (await c.call("POST", `/api/bookings/${A01}/days/1/cooked`)).error.reason,
    ).toBe("wrong_status");
    expect(
      (await c.call("POST", `/api/bookings/${A04}/days/4/cooked`)).status,
    ).toBe(404);
    expect(
      (await c.call("POST", `/api/bookings/${A04}/days/0/cooked`)).status,
    ).toBe(404);
  });
  it("marks day 1 of a booking whose visit is today, then complete needs every day", async () => {
    const c = asChef();
    const r = await c.call("POST", `/api/bookings/${A04}/days/1/cooked`);
    expect(r.status).toBe(200);
    const d = r.json as BookingDetail;
    expect(d.days[0].cookedAt).toBeTruthy();
    expect(d.days[1].cookedAt).toBeNull();
    // Repeating keeps the first time.
    const again = (await c.call("POST", `/api/bookings/${A04}/days/1/cooked`))
      .json as BookingDetail;
    expect(again.days[0].cookedAt).toBe(d.days[0].cookedAt);
    expect(
      (await c.call("POST", `/api/bookings/${A04}/complete`)).error,
    ).toMatchObject({ reason: "days_not_cooked" });
    // Day 2 is tomorrow: too early.
    expect(
      (await c.call("POST", `/api/bookings/${A04}/days/2/cooked`)).error.reason,
    ).toBe("too_early");
  });
  it("complete works once every day is cooked", async () => {
    const c = asChef();
    const r = await c.call("POST", `/api/bookings/${A06}/complete`);
    expect(r.status).toBe(200);
    expect((r.json as BookingDetail).status).toBe("completed");
    expect((r.json as BookingDetail).completedAt).toBeTruthy();
    expect(
      (await c.call("POST", `/api/bookings/${A06}/complete`)).error.reason,
    ).toBe("wrong_status");
  });
});

describe("pickups (D-29)", () => {
  it("the chef accepts or declines the open proposal", async () => {
    const c = asChef();
    const before = (await c.call("GET", `/api/bookings/${A03}`))
      .json as BookingDetail;
    expect(before.days[0].pickups.map((p) => p.status)).toEqual([
      "declined",
      "proposed",
    ]);
    const r = await c.call(
      "POST",
      `/api/bookings/${A03}/days/1/pickup/respond`,
      { accept: true },
    );
    expect(r.status).toBe(200);
    expect((r.json as BookingDetail).days[0].pickups[1].status).toBe(
      "accepted",
    );
    expect(
      (
        await c.call("POST", `/api/bookings/${A03}/days/1/pickup/respond`, {
          accept: true,
        })
      ).error.reason,
    ).toBe("no_open_proposal");
  });
  it("respond checks its body first", async () => {
    const c = asChef();
    expect(
      (
        await c.call("POST", `/api/bookings/${A03}/days/1/pickup/respond`, {
          accept: "yes",
        })
      ).status,
    ).toBe(422);
    expect(
      (await c.call("POST", `/api/bookings/${A03}/days/1/pickup/respond`, {}))
        .status,
    ).toBe(422);
  });
  it("pickup missed is refused while the window is open and works after it", async () => {
    const c = asChef();
    const early = await c.call("POST", `/api/bookings/${A03}/pickup/missed`);
    expect(early.error.reason).toBe("pickup_window_open");
    const r = await c.call("POST", `/api/bookings/${A05}/pickup/missed`);
    expect(r.status).toBe(200);
    const d = r.json as BookingDetail;
    expect(d.status).toBe("no_show_customer");
    expect(d.noShow).toMatchObject({ pickupMissed: true, dayNumber: 1 });
  });
  it("pickup missed only exists for chef's-home bookings", async () => {
    const c = asChef();
    expect(
      (await c.call("POST", `/api/bookings/${A06}/pickup/missed`)).error.reason,
    ).toBe("not_chef_home");
  });

  describe("customer proposals", () => {
    const rows = async () => {
      const c = asChef();
      await c.call("GET", "/api/bookings");
      return c.s.chefBookings!;
    };
    const at = (iso: string) => ({ proposedAt: iso });
    it("proposes a new time on a cooked day with no live proposal", async () => {
      const cust = asCustomer(await rows());
      // A05: window over. A03 has an open one. Make a clean accepted/cooked row from A05 with a later deadline.
      const row = cust.s.bookings.find((r) => r.detail.id === A05)!;
      const day = {
        ...row.detail.days[0],
        pickupDeadlineDate: addDays(TODAY, 2),
        pickups: [],
      };
      cust.s = {
        ...cust.s,
        bookings: [{ ...row, detail: { ...row.detail, days: [day] } }],
      };
      const soon = new Date(NOW.getTime() + 3600 * 1000).toISOString();
      const r = await cust.call(
        "POST",
        `/api/bookings/${A05}/days/1/pickup/propose`,
        at(soon),
      );
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect((r.json as BookingDetail).days[0].pickups.at(-1)?.status).toBe(
        "proposed",
      );
      expect(
        (
          await cust.call(
            "POST",
            `/api/bookings/${A05}/days/1/pickup/propose`,
            at(soon),
          )
        ).error.reason,
      ).toBe("proposal_open");
    });
    it("refuses a past time and a time after the end, with the latest instant", async () => {
      const cust = asCustomer(await rows());
      const row = cust.s.bookings.find((r) => r.detail.id === A05)!;
      const day = {
        ...row.detail.days[0],
        pickupDeadlineDate: addDays(TODAY, 2),
        pickups: [],
      };
      cust.s = {
        ...cust.s,
        bookings: [{ ...row, detail: { ...row.detail, days: [day] } }],
      };
      const past = await cust.call(
        "POST",
        `/api/bookings/${A05}/days/1/pickup/propose`,
        at(new Date(NOW.getTime() - 3600000).toISOString()),
      );
      expect(past.status).toBe(422);
      expect(past.error.fields?.proposedAt).toBeTruthy();
      expect(past.error.latest).toBeTruthy();
      const far = await cust.call(
        "POST",
        `/api/bookings/${A05}/days/1/pickup/propose`,
        at(new Date(NOW.getTime() + 10 * 86400000).toISOString()),
      );
      expect(far.status).toBe(422);
      expect(far.error.latest).toBe(past.error.latest);
      const bad = await cust.call(
        "POST",
        `/api/bookings/${A05}/days/1/pickup/propose`,
        at("tomorrow"),
      );
      expect(bad.status).toBe(422);
    });
    it("is refused after the deadline, before cooking and for a customer's-home booking", async () => {
      const cust = asCustomer(await rows());
      const soon = new Date(NOW.getTime() + 3600 * 1000).toISOString();
      expect(
        (
          await cust.call(
            "POST",
            `/api/bookings/${A05}/days/1/pickup/propose`,
            at(soon),
          )
        ).error.reason,
      ).toBe("deadline_passed");
      expect(
        (
          await cust.call(
            "POST",
            `/api/bookings/${A06}/days/1/pickup/propose`,
            at(soon),
          )
        ).error.reason,
      ).toBe("not_chef_home");
      expect(
        (
          await cust.call(
            "POST",
            `/api/bookings/${A03}/days/1/pickup/propose`,
            at(soon),
          )
        ).error.reason,
      ).toBe("proposal_open");
    });
  });
});

describe("shopping list and receipts", () => {
  it("serves a per-dish list with the plan for both grocery options", async () => {
    const c = asChef();
    const a = (await c.call("GET", `/api/bookings/${A03}/shopping-list`))
      .json as ShoppingListResponse;
    expect(a.plan.customerDeliversToChef).toBe(true);
    expect(a.plan.note).toMatch(/chef's home/);
    expect(a.estimatedCostCents).toBe(2200);
    const b = (await c.call("GET", `/api/bookings/${A04}/shopping-list`))
      .json as ShoppingListResponse;
    expect(b.plan.receiptRequired).toBe(true);
    expect(b.days).toHaveLength(2);
    expect(b.estimatedCostCents).toBe(2500 + 2200 + 2200);
  });
  it("lists receipts, the flagged one with its difference and tolerance", async () => {
    const c = asChef();
    const l = (await c.call("GET", `/api/bookings/${A06}/receipts`))
      .json as ReceiptList;
    expect(l.items).toHaveLength(1);
    const r = l.items[0];
    expect(r.mismatchFlagged).toBe(true);
    expect(r.differenceCents).toBe(6200 - 4000);
    expect(r.toleranceCents).toBe(600);
    expect(r.fileUrl).toBeNull();
    expect((r as unknown as { filePath?: string }).filePath).toBeUndefined();
  });
  const upload = (
    booking: string,
    name = "11111111-1111-4111-8111-111111111111.png",
  ) => ({
    filePath: `${booking}/${name}`,
    amountCents: 6900,
  });
  it("the chef adds a receipt for option B; a matching amount is not flagged", async () => {
    const c = asChef();
    const r = await c.call(
      "POST",
      `/api/bookings/${A04}/receipts`,
      upload(A04),
    );
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const v = r.json as ReceiptView;
    expect(v.status).toBe("waiting");
    expect(v.mismatchFlagged).toBe(false);
    expect(v.estimatedIngredientsCents).toBe(6900);
  });
  it("applies the contract's body rules and 409 reasons", async () => {
    const c = asChef();
    const bad = await c.call("POST", `/api/bookings/${A04}/receipts`, {
      filePath: `${A01}/x.png`,
      amountCents: 0,
    });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.error.fields ?? {}).sort()).toEqual([
      "amountCents",
      "filePath",
    ]);
    expect(
      (
        await c.call("POST", `/api/bookings/${A04}/receipts`, {
          ...upload(A04),
          x: 1,
        })
      ).status,
    ).toBe(422);
    expect(
      (await c.call("POST", `/api/bookings/${A03}/receipts`, upload(A03))).error
        .reason,
    ).toBe("not_chef_shops");
    expect(
      (await c.call("POST", `/api/bookings/${A02}/receipts`, upload(A02))).error
        .reason,
    ).toBe("wrong_status");
    await c.call("POST", `/api/bookings/${A04}/receipts`, upload(A04));
    expect(
      (
        await c.call(
          "POST",
          `/api/bookings/${A04}/receipts`,
          upload(A04, "22222222-2222-4222-8222-222222222222.pdf"),
        )
      ).error.reason,
    ).toBe("receipt_waiting");
  });
  it("after a dispute a new receipt replaces the old one; a used path is refused", async () => {
    const c = asChef();
    await c.call("GET", "/api/bookings");
    const cust = asCustomer(c.s.chefBookings!, c.s.receipts);
    const id = c.s.receipts![A06][0].id;
    const dis = await cust.call(
      "POST",
      `/api/bookings/${A06}/receipts/${id}/respond`,
      {
        action: "dispute",
        note: "The total looks too high",
      },
    );
    expect(dis.status).toBe(200);
    expect((dis.json as ReceiptView).status).toBe("disputed");
    // back on the chef side with the new receipts
    c.s = { ...c.s, receipts: cust.s.receipts };
    const same = c.s.receipts![A06][0].filePath;
    expect(
      (
        await c.call("POST", `/api/bookings/${A06}/receipts`, {
          filePath: same,
          amountCents: 4100,
        })
      ).error.reason,
    ).toBe("path_used");
    const ok = await c.call(
      "POST",
      `/api/bookings/${A06}/receipts`,
      upload(A06),
    );
    expect(ok.status).toBe(201);
    const l = (await c.call("GET", `/api/bookings/${A06}/receipts`))
      .json as ReceiptList;
    expect(l.items.map((i) => i.status)).toEqual(["superseded", "waiting"]);
  });

  describe("customer answers", () => {
    async function setup() {
      const c = asChef();
      await c.call("GET", "/api/bookings");
      const cust = asCustomer(c.s.chefBookings!, c.s.receipts);
      return { cust, rid: c.s.receipts![A06][0].id };
    }
    it("confirms: reimbursement amount is set, MOCK and not collected", async () => {
      const { cust, rid } = await setup();
      const r = await cust.call(
        "POST",
        `/api/bookings/${A06}/receipts/${rid}/respond`,
        { action: "confirm" },
      );
      expect(r.status).toBe(200);
      const v = r.json as ReceiptView;
      expect(v.status).toBe("confirmed");
      expect(v.reimbursement).toEqual({
        mock: true,
        collected: false,
        amountCents: 6200,
      });
      expect(
        (
          await cust.call(
            "POST",
            `/api/bookings/${A06}/receipts/${rid}/respond`,
            { action: "confirm" },
          )
        ).error.reason,
      ).toBe("already_answered");
    });
    it("dispute needs a 3 to 300 character note; confirm takes none", async () => {
      const { cust, rid } = await setup();
      const p = `/api/bookings/${A06}/receipts/${rid}/respond`;
      expect(
        (await cust.call("POST", p, { action: "dispute" })).error.fields?.note,
      ).toBeTruthy();
      expect(
        (await cust.call("POST", p, { action: "dispute", note: "ab" })).status,
      ).toBe(422);
      expect(
        (
          await cust.call("POST", p, {
            action: "dispute",
            note: "x".repeat(301),
          })
        ).status,
      ).toBe(422);
      expect(
        (await cust.call("POST", p, { action: "confirm", note: "hi" })).status,
      ).toBe(422);
      expect((await cust.call("POST", p, { action: "maybe" })).status).toBe(
        422,
      );
      expect(
        (await cust.call("POST", p, { action: "dispute", note: "Too much" }))
          .status,
      ).toBe(200);
    });
    it("an unknown receipt is a 404; a chef cannot answer", async () => {
      const { cust } = await setup();
      expect(
        (
          await cust.call(
            "POST",
            `/api/bookings/${A06}/receipts/${ID(5)}/respond`,
            { action: "confirm" },
          )
        ).status,
      ).toBe(404);
      const c = asChef();
      expect(
        (
          await c.call(
            "POST",
            `/api/bookings/${A06}/receipts/${ID(5)}/respond`,
            { action: "confirm" },
          )
        ).status,
      ).toBe(403);
    });
  });
});

describe("customer seeding hook (tests only)", () => {
  it("gives a customer the same bookings from their side, once, only when asked", async () => {
    const plain = asCustomer([]);
    const none = (await plain.call("GET", "/api/bookings"))
      .json as BookingListResponse;
    expect(none.items).toEqual([]);

    const cust = new Session(
      chef({
        profile: { ...chef().profile!, role: "customer", displayName: "Sam" },
        hooks: { seedCustomer: true },
      }),
    );
    const list = (await cust.call("GET", "/api/bookings"))
      .json as BookingListResponse;
    expect(list.items).toHaveLength(6);
    expect(list.items[0].counterparty.displayName).toBe("Mai Tran (MOCK)");
    const again = (await cust.call("GET", "/api/bookings"))
      .json as BookingListResponse;
    expect(again.items).toHaveLength(6);
    const d = (await cust.call("GET", `/api/bookings/${A03}`))
      .json as BookingDetail;
    expect(d.viewerRole).toBe("customer");
    expect(d.customer.displayName).toBe("Sam");
    // The customer sees the chef's kitchen once accepted, never the customer's own phone.
    expect(d.cookingPlace?.line).toMatch(/Kitchen/);
    expect(d.contact?.phone).toBe("+14165550100");
    // And the receipts are reachable.
    const r = (await cust.call("GET", `/api/bookings/${A06}/receipts`))
      .json as ReceiptList;
    expect(r.items).toHaveLength(1);
  });
});

describe("chef cancel and customer no-show (T-070)", () => {
  it("cancels an accepted booking with the D-20 timing and the optional reason", async () => {
    const c = asChef();
    // A04 is accepted with day 1 today: inside 48 hours, so late.
    const r = await c.call("POST", `/api/bookings/${A04}/cancel`, {
      reason: "  I am ill  ",
    });
    expect(r.status).toBe(200);
    const d = r.json as BookingDetail;
    expect(d).toMatchObject({
      status: "cancelled",
      cancelledBy: "chef",
      cancellationTiming: "late",
      cancelReason: "I am ill",
    });
  });
  it("an empty body is fine and a far-away first day is on time", async () => {
    const c = asChef();
    await c.call("POST", `/api/bookings/${A01}/accept`);
    const r = await c.call("POST", `/api/bookings/${A01}/cancel`, {});
    const d = r.json as BookingDetail;
    expect(d.status).toBe("cancelled");
    expect(d.cancellationTiming).toBe("on_time");
    expect(d.cancelReason).toBeNull();
  });
  it("refuses contact details, a short reason and unknown keys before looking at the state", async () => {
    const c = asChef();
    const contact = await c.call("POST", `/api/bookings/${A04}/cancel`, {
      reason: "call me on 416 555 0199",
    });
    expect(contact.status).toBe(422);
    expect(contact.error.code).toBe("CONTACT_DETAILS_NOT_ALLOWED");
    expect(
      (await c.call("POST", `/api/bookings/${A04}/cancel`, { reason: "no" }))
        .status,
    ).toBe(422);
    expect(
      (await c.call("POST", `/api/bookings/${A04}/cancel`, { x: 1 })).status,
    ).toBe(422);
  });
  it("a chef cannot cancel a waiting request (chef_use_decline), a finished one or one with nothing left", async () => {
    const c = asChef();
    const req = await c.call("POST", `/api/bookings/${A01}/cancel`, {});
    expect(req.status).toBe(409);
    expect(req.error.reason).toBe("chef_use_decline");
    // A03: accepted, its only visit was yesterday and cooked.
    const none = await c.call("POST", `/api/bookings/${A03}/cancel`, {});
    expect(none.status).toBe(409);
    expect(none.error.reason).toBe("nothing_left");
    await c.call("POST", `/api/bookings/${A04}/cancel`, {});
    const twice = await c.call("POST", `/api/bookings/${A04}/cancel`, {});
    expect(twice.error.reason).toBe("wrong_status");
  });
  it("reports a customer no-show from the visit date for an uncooked visit", async () => {
    const c = asChef();
    const r = await c.call("POST", `/api/bookings/${A04}/no-show`);
    expect(r.status).toBe(200);
    const d = r.json as BookingDetail;
    expect(d.status).toBe("no_show_customer");
    expect(d.noShow).toMatchObject({ dayNumber: 1, pickupMissed: false });
  });
  it("refuses a no-show with no visit due, then a second report", async () => {
    const c = asChef();
    // A03: its only visit is cooked, so nothing is due.
    const none = await c.call("POST", `/api/bookings/${A03}/no-show`);
    expect(none.status).toBe(409);
    expect(none.error.reason).toBe("no_visit_due");
    // A01 is only requested.
    const wrong = await c.call("POST", `/api/bookings/${A01}/no-show`);
    expect(wrong.error.reason).toBe("wrong_status");
    await c.call("POST", `/api/bookings/${A04}/no-show`);
    const twice = await c.call("POST", `/api/bookings/${A04}/no-show`);
    expect(twice.error.reason).toBe("wrong_status");
  });
});
