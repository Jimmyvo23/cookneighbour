// T-051 (Tester): CLAUDE.md section 10 gaps found while building docs/edge-case-matrix.md.
// Runs against the LOCAL Supabase in CI only. Every chef and customer is new.
import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import {
  accept,
  activeDates,
  book,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCount,
  bookingCustomer,
  bookingRow,
  cancel,
  claimOf,
  day,
  notesFor,
  svc,
  type TestChef,
} from "./booking-helpers";

beforeEach(() => freshLimits());

const dayBody = (chef: TestChef, offset: number) => ({
  date: day(offset),
  dishes: [{ dishId: chef.dishes.pho, quantity: 1 }],
});

describe("T-051 chef cancels inside the 48 hours (D-20, A-22)", () => {
  it("is recorded as late, frees the date, releases the trial and tells the customer", async () => {
    const chef = await bookableChef();
    const cust = await bookingCustomer();
    const r = await bookOk(
      cust,
      bookingBody(chef, { days: [dayBody(chef, 1)], useFreeTrial: true }),
    );
    expect((await accept(chef.b, r.id)).status).toBe(200);

    const c = await cancel(chef.b, r.id, { reason: "I am ill." });
    expect(c.status, c.text).toBe(200);
    expect(c.body).toMatchObject({
      status: "cancelled",
      cancelledBy: "chef",
      cancellationTiming: "late",
    });
    expect((await bookingRow(r.id)).cancellation_timing).toBe("late");
    expect(await activeDates(r.id)).toEqual([]);
    expect((await claimOf(r.id))?.state).toBe("released");
    expect((await notesFor(cust.id, "booking_cancelled")).length).toBe(1);
  });
});

describe("T-051 chef double-booked across overlapping multi-day requests", () => {
  it("two customers ask for overlapping days at once: one booking is made whole, the other leaves nothing behind", async () => {
    const chef = await bookableChef();
    const a = await bookingCustomer();
    const b = await bookingCustomer();
    // Day 5 is the clash. A wants 4 and 5, B wants 5 and 6; both ask for the free trial.
    const replies = await Promise.all([
      book(
        a,
        bookingBody(chef, {
          days: [dayBody(chef, 4), dayBody(chef, 5)],
          useFreeTrial: true,
        }),
      ),
      book(
        b,
        bookingBody(chef, {
          days: [dayBody(chef, 5), dayBody(chef, 6)],
          useFreeTrial: true,
        }),
      ),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([201, 409]);
    const winnerIdx = replies.findIndex((r) => r.status === 201);
    const loserIdx = 1 - winnerIdx;
    const customers = [a, b];
    const loser = replies[loserIdx];
    expect(loser.body.error.code).toBe("DOUBLE_BOOKED");

    // The loser has no booking, no half-booked day and no free-trial claim.
    expect(await bookingCount(customers[loserIdx].id)).toBe(0);
    const claims = await svc
      .from("free_trial_claims")
      .select("customer_id")
      .eq("customer_id", customers[loserIdx].id);
    expect(claims.error).toBeNull();
    expect(claims.data).toEqual([]);

    // The winner keeps all of their own days, and the chef has exactly those.
    const wantDays = winnerIdx === 0 ? [4, 5] : [5, 6];
    expect(await activeDates(replies[winnerIdx].body.id)).toEqual(
      wantDays.map(day),
    );
    const rows = await svc
      .from("booking_days")
      .select("visit_date")
      .eq("chef_id", chef.id);
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(2);
  });
});
