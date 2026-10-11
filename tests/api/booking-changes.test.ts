// T-063: booking-change routes against the LOCAL Supabase (contract section 7A, CLAUDE.md 6.4,
// 6.6, 10; decisions D-20, D-22, D-26, D-29, D-33). Every chef and customer is new. There is no
// clock to move, so tests shift a booking's visit dates into the past with the service role.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as rejectRoute } from "@/app/api/admin/chefs/[id]/reject/route";
import { torontoStartOfDay } from "@/lib/domain/cancellation";
import { addDays } from "@/lib/domain/dishes";
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
  complete,
  cooked,
  day,
  getBooking,
  missed,
  noShow,
  notesFor,
  propose,
  respond,
  setChef,
  setEatBy,
  shiftDays,
  svc,
  today,
  type TestChef,
} from "./booking-helpers";
import { newAdmin, patchApp } from "./chef-helpers";

beforeEach(() => freshLimits());

const dayBody = (chef: TestChef, offset: number) => ({
  date: day(offset),
  dishes: [{ dishId: chef.dishes.pho, quantity: 1 }],
});

interface Opts {
  offsets?: number[];
  trial?: boolean;
  home?: boolean;
  shelf?: number;
  requestedOnly?: boolean;
}
/** A fresh chef and customer and a booking that is accepted (or only requested). */
async function setup(o: Opts = {}) {
  const chef = await bookableChef({
    options: o.home ? ["customer_home", "chef_home"] : ["customer_home"],
    homeEnabled: o.home === true,
    dishes: [{ key: "pho", shelf: o.shelf ?? 2 }],
  });
  const cust = await bookingCustomer();
  const r = await bookOk(
    cust,
    bookingBody(chef, {
      days: (o.offsets ?? [3]).map((n) => dayBody(chef, n)),
      useFreeTrial: o.trial === true,
      ...(o.home ? { locationType: "chef_home", address: undefined } : {}),
    }),
  );
  if (!o.requestedOnly) {
    const a = await accept(chef.b, r.id);
    expect(a.status, a.text).toBe(200);
  }
  return { chef, cust, id: r.id };
}

describe("POST /api/bookings/:id/cancel", () => {
  it("customer cancels well before day 1: on_time, dates freed, other party notified, trial released", async () => {
    const { chef, cust, id } = await setup({ offsets: [6, 7], trial: true });
    expect((await claimOf(id))?.state).toBe("held");
    const r = await cancel(cust.b, id, { reason: "Plans changed." });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({
      status: "cancelled",
      cancelledBy: "customer",
      cancellationTiming: "on_time",
      cancelReason: "Plans changed.",
    });
    expect(r.body.cancelledAt).toBeTruthy();
    expect(await activeDates(id)).toEqual([]);
    expect((await claimOf(id))?.state).toBe("released");
    expect((await notesFor(chef.id, "booking_cancelled")).length).toBe(1);
    // The trial is free again: a new free-trial booking works.
    const again = await bookOk(
      cust,
      bookingBody(chef, { days: [dayBody(chef, 9)], useFreeTrial: true }),
    );
    expect(again.body.isFreeTrial).toBe(true);
  });

  it("less than 48 hours before day 1 is recorded as late (nothing else changes)", async () => {
    const { cust, id } = await setup({ offsets: [1] });
    const r = await cancel(cust.b, id);
    expect(r.status, r.text).toBe(200);
    expect(r.body.cancellationTiming).toBe("late");
    expect((await bookingRow(id)).cancellation_timing).toBe("late");
  });

  it("a customer may cancel a request that is still waiting; the chef sees it", async () => {
    const { chef, cust, id } = await setup({ requestedOnly: true });
    const r = await cancel(cust.b, id, undefined);
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ status: "cancelled", cancelReason: null });
    expect((await getBooking(chef.b, id)).body.status).toBe("cancelled");
  });

  it("the chef cancels an accepted booking; a waiting request must be declined instead", async () => {
    const waiting = await setup({ requestedOnly: true });
    const w = await cancel(waiting.chef.b, waiting.id);
    expect(w.status).toBe(409);
    expect(w.body.error).toMatchObject({
      code: "INVALID_STATE",
      reason: "chef_use_decline",
    });
    const { chef, cust, id } = await setup({ trial: true });
    const r = await cancel(chef.b, id);
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({
      status: "cancelled",
      cancelledBy: "chef",
    });
    expect((await claimOf(id))?.state).toBe("released");
    expect((await notesFor(cust.id, "booking_cancelled")).length).toBe(1);
  });

  it("D-26: cancelling after a day was cooked consumes the free trial", async () => {
    const { chef, cust, id } = await setup({ offsets: [3, 4], trial: true });
    await shiftDays(id, 3); // day 1 is today, day 2 tomorrow
    expect((await cooked(chef.b, id, 1)).status).toBe(200);
    const r = await cancel(cust.b, id);
    expect(r.status, r.text).toBe(200);
    expect((await claimOf(id))?.state).toBe("consumed");
    // The uncooked day 2 is free again.
    expect(await activeDates(id)).toEqual([]);
    const second = await bookOk(
      cust,
      bookingBody(chef, { days: [dayBody(chef, 10)] }),
    );
    const blocked = await cust.b.call(
      (await import("@/app/api/bookings/route")).POST,
      {
        body: bookingBody(chef, {
          days: [dayBody(chef, 11)],
          useFreeTrial: true,
        }),
      },
    );
    expect(second.status).toBe(201);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("FREE_TRIAL_USED");
  });

  it("refuses when every remaining visit has passed", async () => {
    const { cust, id } = await setup({ offsets: [3] });
    await shiftDays(id, 5);
    const r = await cancel(cust.b, id);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("nothing_left");
  });

  it("a second cancel is 409 and changes nothing", async () => {
    const { cust, id } = await setup({ trial: true });
    expect((await cancel(cust.b, id)).status).toBe(200);
    const again = await cancel(cust.b, id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_STATE");
    expect((await claimOf(id))?.state).toBe("released");
  });

  it("two parallel cancels: exactly one wins", async () => {
    const { chef, cust, id } = await setup();
    const rs = await Promise.all([cancel(cust.b, id), cancel(chef.b, id)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await notesFor(chef.id, "booking_cancelled")).length +
        (await notesFor(cust.id, "booking_cancelled")).length,
    ).toBe(1);
  });

  it("customer cancel racing the chef's accept ends cancelled, claim released", async () => {
    const { chef, cust, id } = await setup({
      requestedOnly: true,
      trial: true,
    });
    await Promise.all([cancel(cust.b, id), accept(chef.b, id)]);
    expect((await bookingRow(id)).status).toBe("cancelled");
    expect((await claimOf(id))?.state).toBe("released");
  });

  it("reason rules: contact details 422 and nothing saved, too short 422, unknown key 422", async () => {
    const { cust, id } = await setup();
    let r = await cancel(cust.b, id, { reason: "Call me at 416 555 0100" });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("CONTACT_DETAILS_NOT_ALLOWED");
    r = await cancel(cust.b, id, { reason: "ab" });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.reason).toBeTruthy();
    r = await cancel(cust.b, id, { reasn: "typo" });
    expect(r.status).toBe(422);
    expect((await bookingRow(id)).status).toBe("accepted");
  });

  it("authorization: stranger 404, other chef 404, admin 403, anonymous 401, wrong content type 400", async () => {
    const { id } = await setup();
    const stranger = await bookingCustomer();
    const otherChef = await bookableChef();
    const admin = await newAdmin();
    expect((await cancel(stranger.b, id)).status).toBe(404);
    expect((await cancel(otherChef.b, id)).status).toBe(404);
    expect((await cancel(admin.b, id)).status).toBe(403);
    const { Browser } = await import("./harness");
    expect((await cancel(new Browser(), id)).status).toBe(401);
    const { POST } = await import("@/app/api/bookings/[id]/cancel/route");
    const bad = await stranger.b.call(
      (r) => POST(r, { params: Promise.resolve({ id }) }),
      { contentType: "text/plain", raw: "{}" },
    );
    expect(bad.status).toBe(400);
    expect((await cancel(stranger.b, "not-a-uuid")).status).toBe(404);
    expect((await bookingRow(id)).status).toBe("accepted");
  });
});

describe("POST /api/bookings/:id/days/:dayNumber/cooked", () => {
  it("not before the visit date; then marks once and repeats safely", async () => {
    const { chef, cust, id } = await setup({ offsets: [3, 4] });
    let r = await cooked(chef.b, id, 1);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("too_early");
    await shiftDays(id, 3);
    r = await cooked(chef.b, id, 1);
    expect(r.status, r.text).toBe(200);
    const first = r.body.days[0].cookedAt as string;
    expect(first).toBeTruthy();
    expect(r.body.days[1].cookedAt).toBeNull();
    r = await cooked(chef.b, id, 1);
    expect(r.status).toBe(200);
    expect(r.body.days[0].cookedAt).toBe(first);
    expect((await cooked(cust.b, id, 1)).status).toBe(403);
  });

  it("unknown day numbers are 404; another chef's booking is 404", async () => {
    const { chef, id } = await setup();
    for (const d of ["4", "0", "abc", "1.5"])
      expect((await cooked(chef.b, id, d)).status, d).toBe(404);
    const other = await bookableChef();
    expect((await cooked(other.b, id, 1)).status).toBe(404);
  });
});

describe("POST /api/bookings/:id/no-show", () => {
  it("is refused until a visit is due; then the chef reports the customer", async () => {
    const { chef, cust, id } = await setup({ offsets: [3, 4], trial: true });
    const early = await noShow(chef.b, id);
    expect(early.status).toBe(409);
    expect(early.body.error.reason).toBe("no_visit_due");
    await shiftDays(id, 3);
    const r = await noShow(chef.b, id);
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe("no_show_customer");
    expect(r.body.noShow).toMatchObject({ dayNumber: 1, pickupMissed: false });
    expect((await claimOf(id))?.state).toBe("consumed");
    // Day 2 had not happened: its date is free again; day 1 stays on record.
    expect(await activeDates(id)).toEqual([today()]);
    expect((await notesFor(cust.id, "booking_no_show")).length).toBe(1);
    expect((await noShow(chef.b, id)).status).toBe(409);
  });

  it("the customer reports the chef: no_show_chef releases the trial", async () => {
    const { chef, cust, id } = await setup({ trial: true });
    await shiftDays(id, 3);
    const r = await noShow(cust.b, id);
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe("no_show_chef");
    expect((await claimOf(id))?.state).toBe("released");
    expect((await notesFor(chef.id, "booking_no_show")).length).toBe(1);
  });

  it("a cooked day cannot be reported as a no-show", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await cooked(chef.b, id, 1);
    const r = await noShow(cust.b, id);
    expect(r.status).toBe(409);
  });

  it("strangers and admins cannot report", async () => {
    const { id } = await setup();
    await shiftDays(id, 3);
    expect((await noShow((await bookingCustomer()).b, id)).status).toBe(404);
    expect((await noShow((await newAdmin()).b, id)).status).toBe(403);
  });
});

describe("POST /api/bookings/:id/complete and the D-33 auto-completion", () => {
  it("the chef needs every day cooked, then completes: trial consumed", async () => {
    const { chef, cust, id } = await setup({ offsets: [3, 4], trial: true });
    await shiftDays(id, 4);
    let r = await complete(chef.b, id);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("days_not_cooked");
    await cooked(chef.b, id, 1);
    await cooked(chef.b, id, 2);
    r = await complete(chef.b, id);
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe("completed");
    expect(r.body.completedAt).toBeTruthy();
    expect((await claimOf(id))?.state).toBe("consumed");
    expect((await complete(cust.b, id)).status).toBe(403);
    expect((await complete(chef.b, id)).status).toBe(409);
  });

  it("an open problem report stops completion", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await cooked(chef.b, id, 1);
    const rep = await svc.from("reports").insert({
      booking_id: id,
      reporter_id: cust.id,
      description: "Something went wrong.",
    });
    expect(rep.error).toBeNull();
    const r = await complete(chef.b, id);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("problem_reported");
  });

  it("completes by itself once the day after the last day has ended (read triggers it)", async () => {
    const { cust, id } = await setup({ trial: true });
    await shiftDays(id, 5);
    const r = await getBooking(cust.b, id);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("completed");
    expect((await claimOf(id))?.state).toBe("consumed");
  });

  it("does not complete yet on the day after, nor with an open report", async () => {
    const early = await setup();
    await shiftDays(early.id, 4); // last day 1 day ago: due at the end of tomorrow
    expect((await getBooking(early.cust.b, early.id)).body.status).toBe(
      "accepted",
    );
    const held = await setup();
    await shiftDays(held.id, 6);
    await svc.from("reports").insert({
      booking_id: held.id,
      reporter_id: held.cust.id,
      description: "A problem.",
    });
    expect((await getBooking(held.cust.b, held.id)).body.status).toBe(
      "accepted",
    );
  });
});

describe("missed pickup (D-29), chef's-home bookings", () => {
  const later = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString();

  it("is refused for a customer's-home booking", async () => {
    const { chef, cust, id } = await setup();
    await shiftDays(id, 3);
    await cooked(chef.b, id, 1);
    const p = await propose(cust.b, id, 1, { proposedAt: later(1) });
    expect(p.status).toBe(409);
    expect(p.body.error.reason).toBe("not_chef_home");
    expect((await missed(chef.b, id)).body.error.reason).toBe("not_chef_home");
  });

  it("full flow: propose, decline, propose again, accept, window closes, pickup missed", async () => {
    const { chef, cust, id } = await setup({
      home: true,
      offsets: [3, 4],
      trial: true,
    });
    await shiftDays(id, 3);
    await setEatBy(id, 5);
    // Not cooked yet.
    let r = await propose(cust.b, id, 1, { proposedAt: later(1) });
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("day_not_cooked");
    await cooked(chef.b, id, 1);

    // Range errors are 422 with the latest allowed instant.
    r = await propose(cust.b, id, 1, { proposedAt: later(-1) });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.proposedAt).toBeTruthy();
    r = await propose(cust.b, id, 1, { proposedAt: later(30) });
    expect(r.status).toBe(422);
    expect(r.body.error.latest).toBe(
      torontoStartOfDay(addDays(day(5), 1)).toISOString(),
    );
    for (const bad of ["tomorrow", "2026-10-20", 5, null])
      expect((await propose(cust.b, id, 1, { proposedAt: bad })).status).toBe(
        422,
      );
    expect((await propose(cust.b, id, 1, { when: later(1) })).status).toBe(422);

    r = await propose(cust.b, id, 1, { proposedAt: later(1) });
    expect(r.status, r.text).toBe(200);
    expect(r.body.days[0].pickupDeadlineDate).toBe(day(5));
    expect(r.body.days[0].pickups).toHaveLength(1);
    expect(r.body.days[0].pickups[0].status).toBe("proposed");
    expect((await notesFor(chef.id, "pickup_proposed")).length).toBe(1);

    r = await propose(cust.b, id, 1, { proposedAt: later(2) });
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("proposal_open");

    // Only the chef answers; the customer cannot.
    expect((await respond(cust.b, id, 1, { accept: true })).status).toBe(403);
    expect((await respond(chef.b, id, 1, { accept: "yes" })).status).toBe(422);
    r = await respond(chef.b, id, 1, { accept: false });
    expect(r.status, r.text).toBe(200);
    expect(r.body.days[0].pickups[0].status).toBe("declined");

    r = await propose(cust.b, id, 1, { proposedAt: later(2) });
    expect(r.status, r.text).toBe(200);
    r = await respond(chef.b, id, 1, { accept: true });
    expect(r.status, r.text).toBe(200);
    expect(
      r.body.days[0].pickups.map((p: { status: string }) => p.status),
    ).toEqual(["declined", "accepted"]);
    r = await propose(cust.b, id, 1, { proposedAt: later(3) });
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("pickup_agreed");
    expect(
      (await respond(chef.b, id, 1, { accept: true })).body.error.reason,
    ).toBe("no_open_proposal");

    // The meals are still good: the chef cannot close the booking yet.
    r = await missed(chef.b, id);
    expect(r.status).toBe(409);
    expect(r.body.error.reason).toBe("pickup_window_open");

    // The eat-by date passes.
    await setEatBy(id, -1);
    r = await missed(chef.b, id);
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe("no_show_customer");
    expect(r.body.noShow).toMatchObject({ dayNumber: 1, pickupMissed: true });
    expect((await claimOf(id))?.state).toBe("consumed");
    // Day 2 was not cooked: cancelled, its date is free.
    expect(await activeDates(id)).toEqual([today()]);
    expect((await notesFor(cust.id, "booking_pickup_missed")).length).toBe(1);
    expect((await missed(chef.b, id)).status).toBe(409);
  });

  it("a meal with a 0-day shelf life can only be picked up on the cooking day", async () => {
    const { chef, cust, id } = await setup({ home: true, shelf: 0 });
    await shiftDays(id, 3);
    await cooked(chef.b, id, 1);
    const r = await propose(cust.b, id, 1, { proposedAt: later_(2) });
    expect(r.status).toBe(422);
    expect(r.body.error.latest).toBe(
      torontoStartOfDay(addDays(today(), 1)).toISOString(),
    );
  });

  it("strangers get 404 and the wrong role 403", async () => {
    const { chef, cust, id } = await setup({ home: true });
    await shiftDays(id, 3);
    await cooked(chef.b, id, 1);
    const stranger = await bookingCustomer();
    const body = { proposedAt: later_(1) };
    expect((await propose(stranger.b, id, 1, body)).status).toBe(404);
    expect((await propose(chef.b, id, 1, body)).status).toBe(403);
    expect((await respond(cust.b, id, 1, { accept: true })).status).toBe(403);
    expect((await missed(cust.b, id)).status).toBe(403);
    expect((await missed((await bookableChef()).b, id)).status).toBe(404);
    expect((await propose(cust.b, id, 9, body)).status).toBe(404);
  });
});
function later_(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

describe("accept re-checks the chef's home (T-042 finding 2)", () => {
  it("accept is refused once chef's home was switched off; decline still works", async () => {
    const { chef, id } = await setup({ home: true, requestedOnly: true });
    await setChef(chef.id, { chef_home_enabled: false });
    const r = await accept(chef.b, id);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({
      code: "INVALID_STATE",
      reason: "chef_home_not_enabled",
    });
    expect((await bookingRow(id)).status).toBe("requested");
  });
});

describe("D-22: rejecting a chef", () => {
  it("cancels requested bookings (system), flags accepted ones, leaves finished ones", async () => {
    const chef = await bookableChef();
    const c1 = await bookingCustomer();
    const c2 = await bookingCustomer();
    const c3 = await bookingCustomer();
    const reqd = await bookOk(
      c1,
      bookingBody(chef, { days: [dayBody(chef, 5)], useFreeTrial: true }),
    );
    const acc = await bookOk(
      c2,
      bookingBody(chef, { days: [dayBody(chef, 7)] }),
    );
    await accept(chef.b, acc.id);
    const done = await bookOk(
      c3,
      bookingBody(chef, { days: [dayBody(chef, 9)] }),
    );
    await accept(chef.b, done.id);
    await svc
      .from("bookings")
      .update({ status: "completed" })
      .eq("id", done.id);

    const admin = await newAdmin();
    const { POST } = { POST: rejectRoute };
    const r = await admin.b.call(
      (req) => POST(req, { params: Promise.resolve({ id: chef.id }) }),
      { body: { reason: "Documents did not pass." } },
    );
    expect(r.status, r.text).toBe(200);

    const a = await getBooking(c1.b, reqd.id);
    expect(a.body).toMatchObject({
      status: "cancelled",
      cancelledBy: "system",
    });
    expect((await claimOf(reqd.id))?.state).toBe("released");
    expect((await notesFor(c1.id, "booking_cancelled")).length).toBe(1);

    expect((await bookingRow(acc.id)).status).toBe("accepted");
    const flags = await svc.from("booking_flags").select("booking_id, reason");
    expect(flags.error).toBeNull();
    const ids = (flags.data ?? []).map((f) => f.booking_id);
    expect(ids).toContain(acc.id);
    expect(ids).not.toContain(done.id);
    expect(ids).not.toContain(reqd.id);
    expect((await notesFor(c2.id, "booking_flagged")).length).toBe(1);
    expect((await bookingRow(done.id)).status).toBe("completed");
  });
});

describe("N3: the kitchen address while an accepted chef's-home booking exists", () => {
  const kitchen = (line: string) => ({
    kitchenAddress: { line, city: "Mississauga", postalCode: "L5B 1A1" },
  });

  it("is refused with 409 kitchen_in_use, allowed again after the booking is cancelled", async () => {
    const chef = await bookableChef({
      options: ["customer_home", "chef_home"],
      homeEnabled: true,
    });
    const first = await chef.b.call(patchApp, {
      method: "PATCH",
      body: kitchen("1 Kitchen Street"),
    });
    expect(first.status, first.text).toBe(200);
    await setChef(chef.id, { chef_home_enabled: true });
    const cust = await bookingCustomer();
    const b = await bookOk(
      cust,
      bookingBody(chef, {
        locationType: "chef_home",
        address: undefined,
        days: [dayBody(chef, 5)],
      }),
    );
    // Only requested: the address may still change (and switches chef's home off, as before).
    // So accept first, with the address as it is.
    expect((await accept(chef.b, b.id)).status).toBe(200);

    const same = await chef.b.call(patchApp, {
      method: "PATCH",
      body: kitchen("1 Kitchen Street"),
    });
    expect(same.status, same.text).toBe(200);
    const changed = await chef.b.call(patchApp, {
      method: "PATCH",
      body: kitchen("2 Other Street"),
    });
    expect(changed.status).toBe(409);
    expect(changed.body.error).toMatchObject({
      code: "INVALID_STATE",
      reason: "kitchen_in_use",
    });
    const stored = await svc
      .from("chef_private")
      .select("kitchen_address_line")
      .eq("chef_id", chef.id)
      .single();
    expect(stored.data?.kitchen_address_line).toBe("1 Kitchen Street");

    expect((await cancel(chef.b, b.id)).status).toBe(200);
    const ok = await chef.b.call(patchApp, {
      method: "PATCH",
      body: kitchen("2 Other Street"),
    });
    expect(ok.status, ok.text).toBe(200);
  });
});
