// T-081 Tester round: races, the report/sweep path, the free trial used exactly once on both
// completion paths, and the "missed after completion" refusal. Runs against the LOCAL Supabase
// (CI). Every chef and customer is new, so nothing else holds their dates.
import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import {
  accept,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  bookingRow,
  claimOf,
  complete,
  confirmPickup,
  cooked,
  day,
  getBooking,
  listBookings,
  missed,
  notesFor,
  setEatBy,
  shiftDays,
  svc,
} from "./booking-helpers";

beforeEach(() => freshLimits());

async function setup(offsets: number[] = [3]) {
  const chef = await bookableChef({
    options: ["customer_home", "chef_home"],
    homeEnabled: true,
    dishes: [{ key: "pho", shelf: 2 }],
  });
  const cust = await bookingCustomer();
  const r = await bookOk(
    cust,
    bookingBody(chef, {
      days: offsets.map((n) => ({
        date: day(n),
        dishes: [{ dishId: chef.dishes.pho, quantity: 1 }],
      })),
      useFreeTrial: true,
      locationType: "chef_home",
      address: undefined,
    }),
  );
  expect((await accept(chef.b, r.id)).status).toBe(200);
  return { chef, cust, id: r.id as string };
}

async function consumedClaims(customerId: string) {
  const { data, error } = await svc
    .from("free_trial_claims")
    .select("booking_id")
    .eq("customer_id", customerId)
    .eq("state", "consumed");
  expect(error).toBeNull();
  return (data ?? []).length;
}

async function readyTwoDays() {
  const s = await setup([3, 4]);
  await shiftDays(s.id, 4); // both days are in the past
  await setEatBy(s.id, 5); // the pickup deadline is days away: only a pickup can complete it
  expect((await cooked(s.chef.b, s.id, 1)).status).toBe(200);
  expect((await cooked(s.chef.b, s.id, 2)).status).toBe(200);
  return s;
}

describe("T-081 tester: parallel confirms", () => {
  it("two different last days confirmed at once: exactly one completion, one notice each, trial consumed once", async () => {
    const { chef, cust, id } = await readyTwoDays();
    const [a, b] = await Promise.all([
      confirmPickup(cust.b, id, 1),
      confirmPickup(cust.b, id, 2),
    ]);
    expect([a.status, b.status], `${a.text} ${b.text}`).toEqual([200, 200]);
    // The booking lock serialises them. Each answer is the booking as loaded AFTER its own change,
    // so the first one may already show the other's completion: at least one says completed.
    for (const x of [a, b])
      expect(["accepted", "completed"]).toContain(x.body.status);
    expect([a.body.status, b.body.status]).toContain("completed");
    expect((await bookingRow(id)).status).toBe("completed");
    expect((await notesFor(cust.id, "booking_completed")).length).toBe(1);
    expect((await notesFor(chef.id, "booking_completed")).length).toBe(1);
    expect((await notesFor(chef.id, "pickup_confirmed")).length).toBe(2);
    expect((await claimOf(id))?.state).toBe("consumed");
    expect(await consumedClaims(cust.id)).toBe(1);
    // Later reads and sweeps change nothing.
    expect((await getBooking(cust.b, id)).body.status).toBe("completed");
    expect((await listBookings(chef.b)).status).toBe(200);
    expect((await notesFor(cust.id, "booking_completed")).length).toBe(1);
    expect(await consumedClaims(cust.id)).toBe(1);
  });

  it("the same last day confirmed twice at once: both 200, one completion notice", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await setEatBy(id, 5);
    await cooked(chef.b, id, 1);
    const [a, b] = await Promise.all([
      confirmPickup(cust.b, id, 1),
      confirmPickup(cust.b, id, 1),
    ]);
    expect([a.status, b.status], `${a.text} ${b.text}`).toEqual([200, 200]);
    expect(a.body.status).toBe("completed");
    expect(b.body.status).toBe("completed");
    expect((await notesFor(cust.id, "booking_completed")).length).toBe(1);
    expect((await notesFor(chef.id, "pickup_confirmed")).length).toBe(1);
    expect(await consumedClaims(cust.id)).toBe(1);
  });
});

describe("T-081 tester: after completion", () => {
  it("'pickup missed' after the last confirm is 409 wrong_status, even once the deadline has passed", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await setEatBy(id, 5);
    await cooked(chef.b, id, 1);
    expect((await confirmPickup(cust.b, id, 1)).body.status).toBe("completed");
    await setEatBy(id, -3); // the deadline is now long past
    const r = await missed(chef.b, id);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("wrong_status");
    expect((await bookingRow(id)).status).toBe("completed");
  });

  it("confirming another (unconfirmed) day of a completed booking is refused, not repeated", async () => {
    const { chef, cust, id } = await setup([3, 4]);
    await shiftDays(id, 4);
    await setEatBy(id, 5);
    await cooked(chef.b, id, 1);
    await cooked(chef.b, id, 2);
    // The chef completes by hand with day 2 still unconfirmed; day 2 can no longer be confirmed.
    expect((await confirmPickup(cust.b, id, 1)).body.status).toBe("accepted");
    expect((await complete(chef.b, id)).status).toBe(200);
    const r = await confirmPickup(cust.b, id, 2);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("wrong_status");
    expect((await notesFor(cust.id, "booking_completed")).length).toBe(1);
  });
});

describe("T-081 tester: the sweep path", () => {
  it("a report opened between cooked and confirm: confirm keeps it accepted; the first read after the report is closed completes it and consumes the trial once", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await setEatBy(id, 5);
    await cooked(chef.b, id, 1);
    const rep = await svc
      .from("reports")
      .insert({
        booking_id: id,
        reporter_id: cust.id,
        description: "A problem.",
      })
      .select("id")
      .single();
    expect(rep.error).toBeNull();
    const r = await confirmPickup(cust.b, id, 1);
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe("accepted");
    expect((await claimOf(id))?.state).toBe("held");
    // Reading while the report is open changes nothing.
    expect((await getBooking(cust.b, id)).body.status).toBe("accepted");
    // Reviewing is also open.
    await svc
      .from("reports")
      .update({ status: "reviewing" })
      .eq("id", rep.data?.id as string);
    expect((await getBooking(cust.b, id)).body.status).toBe("accepted");
    await svc
      .from("reports")
      .update({ status: "resolved" })
      .eq("id", rep.data?.id as string);
    // A route read runs the lazy sweep, which also applies the free-trial change.
    const g = await getBooking(cust.b, id);
    expect(g.body.status).toBe("completed");
    expect((await claimOf(id))?.state).toBe("consumed");
    expect(await consumedClaims(cust.id)).toBe(1);
    expect((await notesFor(cust.id, "booking_completed")).length).toBe(1);
    expect((await notesFor(chef.id, "booking_completed")).length).toBe(1);
    // More reads do not repeat the notice or the claim.
    await getBooking(chef.b, id);
    await listBookings(cust.b);
    expect((await notesFor(cust.id, "booking_completed")).length).toBe(1);
    expect(await consumedClaims(cust.id)).toBe(1);
  });

  it("sweep path alone consumes the trial: all days picked up behind the route's back, then one read", async () => {
    const { chef, cust, id } = await readyTwoDays();
    const up = await svc
      .from("booking_days")
      .update({ picked_up_at: new Date().toISOString() })
      .eq("booking_id", id);
    expect(up.error).toBeNull();
    expect((await claimOf(id))?.state).toBe("held");
    const g = await getBooking(chef.b, id);
    expect(g.body.status).toBe("completed");
    expect((await claimOf(id))?.state).toBe("consumed");
    expect(await consumedClaims(cust.id)).toBe(1);
    // A repeated confirm of a confirmed day: 200, no second notice, still one claim.
    const again = await confirmPickup(cust.b, id, 2);
    expect(again.status, again.text).toBe(200);
    expect(again.body.status).toBe("completed");
    expect((await notesFor(cust.id, "booking_completed")).length).toBe(1);
    expect(await consumedClaims(cust.id)).toBe(1);
  });

  it("a flagged no_day_cooked booking: the chef marks the late day cooked, the customer confirms, it completes and the flag is resolved", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 6);
    await setEatBy(id, -3); // every pickup deadline is past, so the booking is due (D-36)
    await getBooking(cust.b, id); // the sweep raises the flag
    const f0 = await svc
      .from("booking_flags")
      .select("resolved_at")
      .eq("booking_id", id);
    expect(f0.data?.length).toBe(1);
    expect(f0.data?.[0].resolved_at).toBeNull();
    await setEatBy(id, 5);
    const c = await cooked(chef.b, id, 1);
    expect(c.status, c.text).toBe(200);
    const r = await confirmPickup(cust.b, id, 1);
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe("completed");
    expect((await bookingRow(id)).status).toBe("completed");
    const f1 = await svc
      .from("booking_flags")
      .select("resolved_at")
      .eq("booking_id", id);
    expect(f1.data?.length).toBe(1);
    expect(f1.data?.[0].resolved_at).not.toBeNull();
    expect((await notesFor(cust.id, "booking_completed")).length).toBe(1);
    expect(await consumedClaims(cust.id)).toBe(1);
  });
});
