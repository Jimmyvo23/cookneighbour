// T-042 Tester additions (LOCAL Supabase). Extra checks on top of bookings.test.ts: the races are
// repeated, overlapping multi-day requests race each other, a refused free trial leaves no rows
// behind, notifications carry no personal data, the D-19 expiry rule is checked on both sides of
// its switch-over, and expiry happens from plain reads. Every chef and customer is new.
import { beforeEach, describe, expect, it } from "vitest";
import { torontoStartOfDay } from "@/lib/domain/cancellation";
import { PUT as addressRoute } from "@/app/api/me/address/route";
import { freshLimits } from "./harness";
import {
  accept,
  book,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCount,
  bookingCustomer,
  bookingRow,
  claimOf,
  day,
  decline,
  getBooking,
  listBookings,
  makeStale,
  notesFor,
  type TestChef,
} from "./booking-helpers";
import { svc } from "./chef-helpers";

beforeEach(() => freshLimits());

const dayBody = (chef: TestChef, offset: number) => ({
  date: day(offset),
  dishes: [{ dishId: chef.dishes.pho, quantity: 1 }],
});

describe("races, repeated (T-042 asked for several runs)", () => {
  it.each([1, 2, 3, 4, 5])(
    "round %i: overlapping multi-day requests never double-book a date",
    async () => {
      const chef = await bookableChef();
      const cs = [
        await bookingCustomer(),
        await bookingCustomer(),
        await bookingCustomer(),
        await bookingCustomer(),
      ];
      // Windows [5,6] [6,7] [7,8] [8,9]: neighbours overlap on one date.
      const replies = await Promise.all(
        cs.map((c, i) =>
          book(
            c,
            bookingBody(chef, {
              days: [dayBody(chef, 5 + i), dayBody(chef, 6 + i)],
            }),
          ),
        ),
      );
      for (const r of replies) {
        expect([201, 409], r.text).toContain(r.status);
        if (r.status === 409) expect(r.body.error.code).toBe("DOUBLE_BOOKED");
      }
      expect(replies.some((r) => r.status === 201)).toBe(true);
      const rows = await svc
        .from("booking_days")
        .select("visit_date, booking_id")
        .eq("chef_id", chef.id)
        .eq("is_active", true);
      const dates = (rows.data ?? []).map((r) => r.visit_date);
      expect(new Set(dates).size).toBe(dates.length);
      // Every winner owns both of its dates; every loser left nothing behind.
      const winners = replies.filter((r) => r.status === 201).length;
      expect(dates).toHaveLength(winners * 2);
      for (let i = 0; i < cs.length; i++) {
        expect(await bookingCount(cs[i].id)).toBe(
          replies[i].status === 201 ? 1 : 0,
        );
      }
    },
  );

  it.each([1, 2, 3, 4])(
    "round %i: D-28 holds with six parallel requests from one customer",
    async () => {
      const chefs: TestChef[] = [];
      for (let i = 0; i < 6; i++) chefs.push(await bookableChef());
      const c = await bookingCustomer();
      const replies = await Promise.all(
        chefs.map((ch) => book(c, bookingBody(ch))),
      );
      expect(replies.filter((r) => r.status === 201)).toHaveLength(3);
      for (const r of replies.filter((x) => x.status !== 201)) {
        expect(r.body.error.code).toBe("TOO_MANY_OPEN_REQUESTS");
      }
      expect(await bookingCount(c.id)).toBe(3);
    },
  );

  it.each([1, 2, 3, 4, 5])(
    "round %i: the free trial is claimed once, parallel, across two accounts at one address",
    async () => {
      const chef = await bookableChef();
      const a = await bookingCustomer();
      const b = await bookingCustomer({ address: false });
      const put = await b.b.call(addressRoute, {
        method: "PUT",
        body: { line: a.line, city: "Mississauga", postalCode: "L5B 1A1" },
      });
      expect(put.status, put.text).toBe(200);
      const [ra, rb] = await Promise.all([
        book(
          a,
          bookingBody(chef, { days: [dayBody(chef, 4)], useFreeTrial: true }),
        ),
        book(
          b,
          bookingBody(chef, { days: [dayBody(chef, 7)], useFreeTrial: true }),
        ),
      ]);
      const ok = [ra, rb].filter((r) => r.status === 201);
      expect(ok, `${ra.text} ${rb.text}`).toHaveLength(1);
      const lost = [ra, rb].find((r) => r.status !== 201)!;
      expect(lost.status).toBe(409);
      expect(lost.body.error.code).toBe("FREE_TRIAL_USED");
      const claims = await svc
        .from("free_trial_claims")
        .select("id, customer_id")
        .in("customer_id", [a.id, b.id]);
      expect(claims.data).toHaveLength(1);
      expect(await bookingCount(a.id)).toBe(ra.status === 201 ? 1 : 0);
      expect(await bookingCount(b.id)).toBe(rb.status === 201 ? 1 : 0);
    },
  );

  it.each([1, 2, 3, 4, 5])(
    "round %i: accept racing decline leaves one answer and a matching claim",
    async () => {
      const chef = await bookableChef();
      const c = await bookingCustomer();
      const r = await bookOk(c, bookingBody(chef, { useFreeTrial: true }));
      const [a, d] = await Promise.all([
        accept(chef.b, r.id),
        decline(chef.b, r.id),
      ]);
      expect([a.status, d.status].sort()).toEqual([200, 409]);
      const row = await bookingRow(r.id);
      expect(row.status).toBe(a.status === 200 ? "accepted" : "declined");
      expect((await claimOf(r.id))?.state).toBe(
        a.status === 200 ? "held" : "released",
      );
      // Exactly one answer notification for the customer.
      const answered = (await notesFor(c.id)).filter((n) =>
        /accepted|declined/.test(n.type),
      );
      expect(answered).toHaveLength(1);
    },
  );
});

describe("a refused booking leaves nothing behind (one transaction)", () => {
  it("a refused free trial on a 3-day request creates no booking, days, address, claim or note", async () => {
    const chef = await bookableChef();
    const other = await bookableChef();
    const c = await bookingCustomer();
    await bookOk(c, bookingBody(other, { useFreeTrial: true }));
    const before = await svc
      .from("booking_days")
      .select("id")
      .eq("chef_id", chef.id);
    const r = await book(
      c,
      bookingBody(chef, {
        days: [dayBody(chef, 5), dayBody(chef, 6), dayBody(chef, 7)],
        useFreeTrial: true,
      }),
    );
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("FREE_TRIAL_USED");
    expect(before.data).toEqual([]);
    const days = await svc
      .from("booking_days")
      .select("id")
      .eq("chef_id", chef.id);
    expect(days.data).toEqual([]);
    expect(await notesFor(chef.id)).toEqual([]);
    expect(await bookingCount(c.id)).toBe(1);
    // The dates are still free for someone else.
    const d = await bookingCustomer();
    await bookOk(
      d,
      bookingBody(chef, {
        days: [dayBody(chef, 5), dayBody(chef, 6), dayBody(chef, 7)],
      }),
    );
  });

  it("a booking without the trial never has is_free_trial or a claim", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const r = await bookOk(c, bookingBody(chef));
    expect((await bookingRow(r.id)).is_free_trial).toBe(false);
    expect(await claimOf(r.id)).toBeNull();
  });

  it("a double-booked loser who asked for the trial keeps the trial", async () => {
    const chef = await bookableChef();
    const a = await bookingCustomer();
    const b = await bookingCustomer();
    await bookOk(a, bookingBody(chef, { days: [dayBody(chef, 5)] }));
    const lost = await book(
      b,
      bookingBody(chef, { days: [dayBody(chef, 5)], useFreeTrial: true }),
    );
    expect(lost.status, lost.text).toBe(409);
    expect(lost.body.error.code).toBe("DOUBLE_BOOKED");
    const claims = await svc
      .from("free_trial_claims")
      .select("id")
      .eq("customer_id", b.id);
    expect(claims.data).toEqual([]);
    const ok = await bookOk(
      b,
      bookingBody(chef, { days: [dayBody(chef, 6)], useFreeTrial: true }),
    );
    expect((await bookingRow(ok.id)).is_free_trial).toBe(true);
  });
});

describe("notifications carry no personal data", () => {
  it("requested, accepted, declined and expired notes hold no name, phone, address, or allergy text", async () => {
    const chef = await bookableChef({ name: "Chef Zelda Quill" });
    const c = await bookingCustomer();
    const intake = {
      allergyNotes: "peanut SECRETALLERGY",
      dietaryNotes: "halal SECRETDIET",
    };
    // The chef's own decline reason is shown to the customer by design (tested in bookings.test.ts).
    const reason = "I am travelling that week.";
    const acc = await bookOk(
      c,
      bookingBody(chef, { days: [dayBody(chef, 4)], intake }),
    );
    expect((await accept(chef.b, acc.id)).status).toBe(200);
    const dec = await bookOk(
      c,
      bookingBody(chef, { days: [dayBody(chef, 5)], intake }),
    );
    expect((await decline(chef.b, dec.id, { reason })).status).toBe(200);
    const exp = await bookOk(
      c,
      bookingBody(chef, { days: [dayBody(chef, 6)], intake }),
    );
    await makeStale(exp.id);
    expect((await getBooking(c.b, exp.id)).status).toBe(200);
    const all = [...(await notesFor(c.id)), ...(await notesFor(chef.id))];
    expect(all.length).toBeGreaterThanOrEqual(6);
    const text = JSON.stringify(all);
    for (const bad of [
      c.phone,
      c.phone.slice(-7),
      c.line,
      "Cooking Street",
      "L5B",
      "Booking Customer",
      "Zelda",
      "SECRETALLERGY",
      "SECRETDIET",
      c.id,
    ]) {
      expect(text, bad).not.toContain(bad);
    }
  });
});

describe("D-19 expiry on both sides of the switch-over", () => {
  it.each([2, 3, 4, 6])(
    "first visit in %i days: expiry is the earlier of 72 hours and 00:00 Toronto on day 1",
    async (offset) => {
      const chef = await bookableChef({ ticked: [offset] });
      const c = await bookingCustomer();
      const r = await bookOk(
        c,
        bookingBody(chef, { days: [dayBody(chef, offset)] }),
      );
      const created = new Date(r.body.createdAt).getTime();
      const expires = new Date(r.body.expiresAt).getTime();
      const midnight = torontoStartOfDay(day(offset)).getTime();
      const expected = Math.min(created + 72 * 3600_000, midnight);
      expect(Math.abs(expires - expected)).toBeLessThan(10_000);
      expect(expires).toBeLessThanOrEqual(created + 72 * 3600_000 + 10_000);
      expect(expires).toBeLessThanOrEqual(midnight);
    },
  );

  it("a multi-day request expires on its earliest day, whatever order was sent", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const r = await bookOk(
      c,
      bookingBody(chef, {
        days: [dayBody(chef, 8), dayBody(chef, 2), dayBody(chef, 9)],
      }),
    );
    expect(new Date(r.body.expiresAt).getTime()).toBeLessThanOrEqual(
      torontoStartOfDay(day(2)).getTime(),
    );
  });
});

describe("expiry from plain reads and answers", () => {
  it("a customer's GET of a stale request expires it, frees the date and releases the trial", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const r = await bookOk(
      c,
      bookingBody(chef, { days: [dayBody(chef, 4)], useFreeTrial: true }),
    );
    await makeStale(r.id);
    const g = await getBooking(c.b, r.id);
    expect(g.status, g.text).toBe(200);
    expect(g.body.status).toBe("expired");
    expect((await claimOf(r.id))?.state).toBe("released");
    const other = await bookingCustomer();
    await bookOk(other, bookingBody(chef, { days: [dayBody(chef, 4)] }));
  });

  it("a stale request is refused for decline too, and the chef's list shows it expired", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const r = await bookOk(c, bookingBody(chef));
    await makeStale(r.id);
    const d = await decline(chef.b, r.id, { reason: "Too late now" });
    expect(d.status, d.text).toBe(409);
    expect(["REQUEST_EXPIRED", "INVALID_STATE"]).toContain(d.body.error.code);
    expect((await bookingRow(r.id)).status).toBe("expired");
    const list = await listBookings(chef.b);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain("expired");
  });

  it("an accepted booking never expires, even with a past expires_at", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const r = await bookOk(c, bookingBody(chef));
    expect((await accept(chef.b, r.id)).status).toBe(200);
    await makeStale(r.id);
    expect((await getBooking(c.b, r.id)).status).toBe(200);
    await listBookings(c.b);
    expect((await bookingRow(r.id)).status).toBe("accepted");
  });
});

describe("malformed bodies are 4xx, never 500", () => {
  it.each([
    ["an impossible date", { date: "2099-02-30" }],
    ["a date with a time", { date: `${day(5)}T10:00:00Z` }],
    ["a number for a date", { date: 20261201 }],
    ["a null date", { date: null }],
  ])("%s", async (_n, over) => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const r = await book(
      c,
      bookingBody(chef, {
        days: [{ ...dayBody(chef, 5), ...over }],
      }),
    );
    expect(r.status, r.text).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(await bookingCount(c.id)).toBe(0);
  });

  it.each([
    ["no days", []],
    ["a day with no dishes", [{ date: "X", dishes: [] }]],
  ])("%s", async (_n, days) => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const fixed = (days as { date: string }[]).map((d) => ({
      ...d,
      date: day(5),
    }));
    const r = await book(c, bookingBody(chef, { days: fixed }));
    expect(r.status, r.text).toBe(422);
    expect(await bookingCount(c.id)).toBe(0);
  });

  it("a zero, negative or fractional dish quantity is refused", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    for (const quantity of [0, -1, 1.5, 1000]) {
      const r = await book(
        c,
        bookingBody(chef, {
          days: [
            {
              date: day(5),
              dishes: [{ dishId: chef.dishes.pho, quantity }],
            },
          ],
        }),
      );
      expect(r.status, `${quantity}: ${r.text}`).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    }
    expect(await bookingCount(c.id)).toBe(0);
  });
});
