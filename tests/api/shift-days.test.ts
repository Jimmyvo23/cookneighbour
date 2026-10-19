// T-086: `shiftDays` must move a multi-day booking in a safe order, in both directions.
// Before the fix it updated rows in whatever order Postgres returned them, so days [0, +1]
// shifted by 1 sometimes put day 2 on day 1's date (23505 booking_days_one_per_chef_date).
// Runs against the LOCAL Supabase (CI). The ordering rule itself is tested in shift-order.test.ts.
import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import {
  accept,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  day,
  shiftDays,
  svc,
} from "./booking-helpers";

beforeEach(() => freshLimits());

describe("T-086: shiftDays on a multi-day booking", () => {
  it("3 consecutive days shift earlier and later by 1 without a date clash", async () => {
    const chef = await bookableChef({
      options: ["customer_home"],
      dishes: [{ key: "pho", shelf: 2 }],
    });
    const cust = await bookingCustomer();
    const r = await bookOk(
      cust,
      bookingBody(chef, {
        days: [3, 4, 5].map((n) => ({
          date: day(n),
          dishes: [{ dishId: chef.dishes.pho, quantity: 1 }],
        })),
        useFreeTrial: true,
      }),
    );
    expect((await accept(chef.b, r.id)).status).toBe(200);
    const dates = async () =>
      (
        await svc
          .from("booking_days")
          .select("day_number, visit_date")
          .eq("booking_id", r.id)
          .order("day_number")
      ).data?.map((d) => d.visit_date);
    await shiftDays(r.id, 1);
    expect(await dates()).toEqual([day(2), day(3), day(4)]);
    await shiftDays(r.id, -1);
    expect(await dates()).toEqual([day(3), day(4), day(5)]);
  });
});
