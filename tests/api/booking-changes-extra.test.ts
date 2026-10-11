// T-063 Tester additions: free-trial outcomes after changes (D-26, A-16), a chef's cancel after a
// cooked day (builder assumption 7), contact details in a chef's cancel reason, and the claim of a
// flagged (D-22) booking. Runs against the LOCAL Supabase (CI).
import { beforeEach, describe, expect, it } from "vitest";
import { POST as rejectRoute } from "@/app/api/admin/chefs/[id]/reject/route";
import { POST as bookingsPost } from "@/app/api/bookings/route";
import { freshLimits } from "./harness";
import {
  accept,
  activeDates,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  bookingRow,
  cancel,
  claimOf,
  cooked,
  day,
  noShow,
  shiftDays,
} from "./booking-helpers";
import { newAdmin } from "./chef-helpers";

beforeEach(() => freshLimits());

const dayBody = (chef: { dishes: { pho: string } }, offset: number) => ({
  date: day(offset),
  dishes: [{ dishId: chef.dishes.pho, quantity: 1 }],
});

async function acceptedTrial(offsets: number[]) {
  const chef = await bookableChef({ dishes: [{ key: "pho", shelf: 2 }] });
  const cust = await bookingCustomer();
  const r = await bookOk(
    cust,
    bookingBody(chef, {
      days: offsets.map((n) => dayBody(chef, n)),
      useFreeTrial: true,
    }),
  );
  expect((await accept(chef.b, r.id)).status).toBe(200);
  return { chef, cust, id: r.id as string };
}

describe("free trial after a change", () => {
  it("customer no-show consumes the trial: a second free booking is blocked", async () => {
    const { chef, cust, id } = await acceptedTrial([3]);
    await shiftDays(id, 3);
    expect((await noShow(chef.b, id)).status).toBe(200);
    expect((await claimOf(id))?.state).toBe("consumed");
    const blocked = await cust.b.call(bookingsPost, {
      body: bookingBody(chef, {
        days: [dayBody(chef, 10)],
        useFreeTrial: true,
      }),
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("FREE_TRIAL_USED");
  });

  it("chef no-show releases the trial: the customer can use it again", async () => {
    const { chef, cust, id } = await acceptedTrial([3]);
    await shiftDays(id, 3);
    expect((await noShow(cust.b, id)).status).toBe(200);
    expect((await claimOf(id))?.state).toBe("released");
    const again = await bookOk(
      cust,
      bookingBody(chef, { days: [dayBody(chef, 10)], useFreeTrial: true }),
    );
    expect(again.body.isFreeTrial).toBe(true);
  });

  it("a chef's cancel after a cooked day also consumes the trial (assumption 7, Q-A)", async () => {
    const { chef, id } = await acceptedTrial([3, 4]);
    await shiftDays(id, 3);
    expect((await cooked(chef.b, id, 1)).status).toBe(200);
    const r = await cancel(chef.b, id);
    expect(r.status, r.text).toBe(200);
    expect((await claimOf(id))?.state).toBe("consumed");
    expect(await activeDates(id)).toEqual([]);
  });

  it("cooking marks nothing before the visit date and cancel before cooking still releases", async () => {
    const { chef, id } = await acceptedTrial([3, 4]);
    const early = await cooked(chef.b, id, 1);
    expect(early.status).toBe(409);
    expect(early.body.error.reason).toBe("too_early");
    expect((await cancel(chef.b, id)).status).toBe(200);
    expect((await claimOf(id))?.state).toBe("released");
  });
});

describe("cancel reason, chef side", () => {
  it("an email or phone number in the chef's reason is refused and nothing is saved", async () => {
    const { chef, id } = await acceptedTrial([3]);
    for (const reason of [
      "Write to me at someone@example.com",
      "Text 647-555-0199 please",
    ]) {
      const r = await cancel(chef.b, id, { reason });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe("CONTACT_DETAILS_NOT_ALLOWED");
    }
    const row = await bookingRow(id);
    expect(row.status).toBe("accepted");
    expect(row.cancel_reason).toBeNull();
  });
});

describe("D-22 reject cascade and the free trial", () => {
  it("a flagged accepted booking keeps its held claim; a cancelled request releases it", async () => {
    const chef = await bookableChef();
    const c1 = await bookingCustomer();
    const c2 = await bookingCustomer();
    const reqd = await bookOk(
      c1,
      bookingBody(chef, { days: [dayBody(chef, 5)], useFreeTrial: true }),
    );
    const acc = await bookOk(
      c2,
      bookingBody(chef, { days: [dayBody(chef, 7)], useFreeTrial: true }),
    );
    expect((await accept(chef.b, acc.id)).status).toBe(200);
    const admin = await newAdmin();
    const r = await admin.b.call(
      (req) => rejectRoute(req, { params: Promise.resolve({ id: chef.id }) }),
      { body: { reason: "Documents did not pass." } },
    );
    expect(r.status, r.text).toBe(200);
    expect((await claimOf(reqd.id))?.state).toBe("released");
    expect((await claimOf(acc.id))?.state).toBe("held");
    // The cancelled request freed its date.
    expect(await activeDates(reqd.id)).toEqual([]);
  });
});
