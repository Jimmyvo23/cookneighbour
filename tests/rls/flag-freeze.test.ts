// T-064: database side of the D-53 freeze and D-57 (migration 20261017100000).
// - an open flag other than no_day_cooked freezes the booking: change_booking refuses every action,
//   the sweep never completes it, the chef cannot add a receipt;
// - a no_day_cooked flag does not freeze, and completing the booking resolves it;
// - admin_reject_chef upgrades an open no_day_cooked flag, so the booking freezes;
// - get_booking_frozen tells the two parties (only) whether the booking is frozen;
// - T-074 review L1: a blank kitchen address part counts as missing.
// Test data is scoped to its own chefs and customers; the sweep is always called for one user.
import { describe, expect, inject, it } from "vitest";
import {
  anonClient,
  clientFor,
  dayPlus,
  expectDenied,
  makeBooking,
  makeChef,
  makeCustomer,
  rand,
  serviceClient,
  type Person,
} from "./helpers";

const fx = inject("fx");
const svc = serviceClient();
const todayTo = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
}).format(new Date());
// A date no other file uses (only chef-and-date clashes matter, and every chef here is new).
const future = () => dayPlus(todayTo, 420 + Math.floor(Math.random() * 200));

interface Setup {
  chef: Person;
  cust: Person;
  id: string;
}

/** An accepted booking whose only visit was `daysAgo` days ago (the insert trigger forbids a past date, an update is allowed). */
async function accepted(
  name: string,
  o: {
    daysAgo?: number;
    cooked?: boolean;
    location?: "customer_home" | "chef_home";
  } = {},
): Promise<Setup> {
  const chef = await makeChef(svc, `${name}-chef`, {
    options: ["customer_home", "chef_home"],
    chefHomeEnabled: true,
  });
  const cust = await makeCustomer(svc, `${name}-cust`);
  const b = await makeBooking(svc, {
    customer: cust,
    chef,
    dates: [future()],
    status: "accepted",
    location: o.location ?? "customer_home",
  });
  if (o.daysAgo !== undefined) {
    const mv = await svc
      .from("booking_days")
      .update({ visit_date: dayPlus(todayTo, -o.daysAgo) })
      .eq("booking_id", b.id);
    expect(mv.error).toBeNull();
  }
  if (o.cooked) {
    const up = await svc
      .from("booking_days")
      .update({ cooked_at: new Date().toISOString() })
      .eq("booking_id", b.id);
    expect(up.error).toBeNull();
  }
  return { chef, cust, id: b.id };
}

const flag = async (id: string, reason: "chef_rejected" | "no_day_cooked") => {
  const r = await svc.from("booking_flags").insert({ booking_id: id, reason });
  expect(r.error).toBeNull();
};
const flagRow = async (id: string) => {
  const r = await svc
    .from("booking_flags")
    .select("reason, resolved_at")
    .eq("booking_id", id)
    .maybeSingle();
  expect(r.error).toBeNull();
  return r.data;
};
const change = (
  s: Setup,
  actor: Person,
  action: string,
  args: Record<string, unknown> = {},
) =>
  svc.rpc("change_booking", {
    p_booking: s.id,
    p_actor: actor.id,
    p_action: action,
    p_args: args,
  });
const sweep = (user: string) =>
  svc.rpc("sweep_booking_changes", { p_user: user });
const status = async (id: string) =>
  (await svc.from("bookings").select("status").eq("id", id).single()).data
    ?.status;

describe("D-53: an open chef_rejected flag freezes the booking", () => {
  it("change_booking refuses every action, for the right side, with reason frozen", async () => {
    const s = await accepted("ff-all", { daysAgo: 1, location: "chef_home" });
    await flag(s.id, "chef_rejected");
    const tries: [Person, string, Record<string, unknown>][] = [
      [s.cust, "cancel", { free_hours: 48, reason: "Plans changed" }],
      [s.chef, "cancel", { free_hours: 48, reason: "Ill" }],
      [s.chef, "cooked", { day_number: 1 }],
      [s.chef, "no_show", {}],
      [s.cust, "no_show", {}],
      [s.chef, "complete", {}],
      [
        s.cust,
        "pickup_propose",
        {
          day_number: 1,
          proposed_at: new Date(Date.now() + 3600_000).toISOString(),
        },
      ],
      [s.chef, "pickup_respond", { day_number: 1, accept: true }],
      [s.chef, "pickup_missed", {}],
    ];
    for (const [who, action, args] of tries) {
      const r = await change(s, who, action, args);
      expect(r.error, action).toBeNull();
      expect(r.data, action).toEqual({
        result: "invalid_state",
        reason: "frozen",
      });
    }
    expect(await status(s.id)).toBe("accepted");
    const day = await svc
      .from("booking_days")
      .select("cooked_at, is_active")
      .eq("booking_id", s.id)
      .single();
    expect(day.data).toMatchObject({ cooked_at: null, is_active: true });
  });

  it("a wrong-side or stranger call still looks like not_found, not frozen", async () => {
    const s = await accepted("ff-side", { daysAgo: 1 });
    await flag(s.id, "chef_rejected");
    const stranger = await makeCustomer(svc, "ff-side-stranger");
    expect(
      (await change(s, stranger, "cancel", { free_hours: 48 })).data,
    ).toEqual({ result: "not_found" });
    expect((await change(s, s.cust, "complete")).data).toEqual({
      result: "not_found",
    });
  });

  it("once the flag is resolved the booking works again", async () => {
    const s = await accepted("ff-resolved", { daysAgo: 1, cooked: true });
    await flag(s.id, "chef_rejected");
    expect((await change(s, s.chef, "complete")).data).toMatchObject({
      reason: "frozen",
    });
    const up = await svc
      .from("booking_flags")
      .update({ resolved_at: new Date().toISOString() })
      .eq("booking_id", s.id);
    expect(up.error).toBeNull();
    expect((await change(s, s.chef, "complete")).data).toMatchObject({
      result: "ok",
      status: "completed",
    });
  });

  it("the sweep never completes a frozen booking, then completes it once the flag is resolved", async () => {
    const s = await accepted("ff-sweep", { daysAgo: 5, cooked: true });
    await flag(s.id, "chef_rejected");
    const first = await sweep(s.cust.id);
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ completed: 0, flagged: 0 });
    expect(await status(s.id)).toBe("accepted");
    expect(await flagRow(s.id)).toMatchObject({
      reason: "chef_rejected",
      resolved_at: null,
    });
    await svc
      .from("booking_flags")
      .update({ resolved_at: new Date().toISOString() })
      .eq("booking_id", s.id);
    expect((await sweep(s.cust.id)).data).toMatchObject({ completed: 1 });
    expect(await status(s.id)).toBe("completed");
  });

  it("a frozen booking with no cooked day keeps its chef_rejected flag (no second flag, no notice)", async () => {
    const s = await accepted("ff-nocook", { daysAgo: 5 });
    await flag(s.id, "chef_rejected");
    expect((await sweep(s.cust.id)).data).toMatchObject({
      completed: 0,
      flagged: 0,
    });
    expect(await flagRow(s.id)).toMatchObject({ reason: "chef_rejected" });
    const n = await svc
      .from("notifications")
      .select("id")
      .eq("booking_id", s.id)
      .eq("type", "booking_flagged");
    expect(n.data).toEqual([]);
  });
});

describe("D-57: a no_day_cooked flag does not freeze, and completing resolves it", () => {
  it("the sweep flags a booking with no cooked day; the chef may still mark it cooked and complete it", async () => {
    const s = await accepted("ff-d57", { daysAgo: 5 });
    expect((await sweep(s.cust.id)).data).toMatchObject({
      completed: 0,
      flagged: 1,
    });
    expect(await flagRow(s.id)).toMatchObject({
      reason: "no_day_cooked",
      resolved_at: null,
    });
    expect(
      (await change(s, s.chef, "cooked", { day_number: 1 })).data,
    ).toMatchObject({ result: "ok" });
    const done = await change(s, s.chef, "complete");
    expect(done.data).toMatchObject({ result: "ok", status: "completed" });
    const f = await flagRow(s.id);
    expect(f?.reason).toBe("no_day_cooked");
    expect(f?.resolved_at).not.toBeNull();
  });

  it("the automatic completion resolves the flag too", async () => {
    const s = await accepted("ff-d57b", { daysAgo: 5 });
    await sweep(s.cust.id);
    await svc
      .from("booking_days")
      .update({ cooked_at: new Date().toISOString() })
      .eq("booking_id", s.id);
    expect((await sweep(s.cust.id)).data).toMatchObject({ completed: 1 });
    expect(await status(s.id)).toBe("completed");
    expect((await flagRow(s.id))?.resolved_at).not.toBeNull();
  });

  it("a flagged booking can still be cancelled by the customer (it is not frozen)", async () => {
    const s = await accepted("ff-d57c", { daysAgo: 5 });
    await sweep(s.cust.id);
    // Every visit is past, so the cancel is refused for that reason, not because of a freeze.
    expect(
      (await change(s, s.cust, "cancel", { free_hours: 48 })).data,
    ).toEqual({
      result: "invalid_state",
      reason: "nothing_left",
    });
  });
});

describe("D-22 + D-53: rejecting a chef freezes their accepted bookings", () => {
  it("an open no_day_cooked flag is upgraded to chef_rejected and the customer is told", async () => {
    const s = await accepted("ff-up", { daysAgo: 5 });
    await sweep(s.cust.id);
    expect((await flagRow(s.id))?.reason).toBe("no_day_cooked");
    const r = await svc.rpc("admin_reject_chef", {
      p_chef_id: s.chef.id,
      p_reason: "Documents did not pass.",
    });
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ result: "ok", flagged: [s.id] });
    expect(await flagRow(s.id)).toMatchObject({
      reason: "chef_rejected",
      resolved_at: null,
    });
    expect(
      (await change(s, s.chef, "cooked", { day_number: 1 })).data,
    ).toMatchObject({ reason: "frozen" });
    const n = await svc
      .from("notifications")
      .select("user_id")
      .eq("booking_id", s.id)
      .eq("type", "booking_flagged")
      .eq("user_id", s.cust.id);
    expect(n.data?.length).toBeGreaterThanOrEqual(1);
  });

  it("a plain accepted booking gets a chef_rejected flag; a completed one does not", async () => {
    const s = await accepted("ff-rej", { daysAgo: 1, cooked: true });
    const done = await makeBooking(svc, {
      customer: s.cust,
      chef: s.chef,
      dates: [future()],
      status: "completed",
    });
    const r = await svc.rpc("admin_reject_chef", {
      p_chef_id: s.chef.id,
      p_reason: "No.",
    });
    expect(r.data).toMatchObject({ result: "ok", flagged: [s.id] });
    expect(await flagRow(done.id)).toBeNull();
    expect((await change(s, s.chef, "complete")).data).toMatchObject({
      reason: "frozen",
    });
  });

  it("an already resolved flag is not reopened", async () => {
    const s = await accepted("ff-keep", { daysAgo: 1 });
    await flag(s.id, "no_day_cooked");
    await svc
      .from("booking_flags")
      .update({ resolved_at: new Date().toISOString() })
      .eq("booking_id", s.id);
    await svc.rpc("admin_reject_chef", {
      p_chef_id: s.chef.id,
      p_reason: "No.",
    });
    expect(await flagRow(s.id)).toMatchObject({ reason: "no_day_cooked" });
  });
});

describe("get_booking_frozen and booking_is_frozen", () => {
  it("only the two parties get an answer; nobody else, not even an admin", async () => {
    const s = await accepted("ff-fn", { daysAgo: 1 });
    const stranger = await makeCustomer(svc, "ff-fn-stranger");
    const ask = async (c: ReturnType<typeof anonClient>) =>
      c.rpc("get_booking_frozen", { p_booking: s.id });

    await flag(s.id, "chef_rejected");
    expect((await ask(await clientFor(s.cust))).data).toBe(true);
    expect((await ask(await clientFor(s.chef))).data).toBe(true);
    for (const c of [await clientFor(stranger), await clientFor(fx.admin)]) {
      const r = await ask(c);
      expect(r.error).toBeNull();
      expect(r.data).toBeNull();
    }
    expectDenied(await ask(anonClient()));
  });

  it("false for an unflagged booking and for a no_day_cooked flag", async () => {
    const a = await accepted("ff-fn2", { daysAgo: 1 });
    const c = await clientFor(a.cust);
    expect((await c.rpc("get_booking_frozen", { p_booking: a.id })).data).toBe(
      false,
    );
    await flag(a.id, "no_day_cooked");
    expect((await c.rpc("get_booking_frozen", { p_booking: a.id })).data).toBe(
      false,
    );
  });

  it("T-082: get_bookings_frozen returns only the frozen bookings of the caller, for a batch", async () => {
    const a = await accepted("ff-batch-a", { daysAgo: 1 });
    const b = await accepted("ff-batch-b", { daysAgo: 1 });
    await flag(a.id, "chef_rejected");
    const ask = async (c: ReturnType<typeof anonClient>, ids: string[]) =>
      c.rpc("get_bookings_frozen", { p_bookings: ids });
    // The customer of a asks about a and b: only a is theirs, and frozen.
    const mine = await ask(await clientFor(a.cust), [a.id, b.id]);
    expect(mine.error).toBeNull();
    expect(mine.data).toEqual([a.id]);
    // The chef of a sees it too; the chef of b sees nothing about a.
    expect((await ask(await clientFor(a.chef), [a.id])).data).toEqual([a.id]);
    expect((await ask(await clientFor(b.chef), [a.id, b.id])).data).toEqual([]);
    // A stranger and an admin get an empty set, not an error.
    const stranger = await makeCustomer(svc, "ff-batch-stranger");
    for (const c of [await clientFor(stranger), await clientFor(fx.admin)]) {
      const r = await ask(c, [a.id]);
      expect(r.error).toBeNull();
      expect(r.data).toEqual([]);
    }
    // An empty batch is fine; a signed-out caller is refused.
    expect((await ask(await clientFor(a.cust), [])).data).toEqual([]);
    expectDenied(await ask(anonClient(), [a.id]));
    // no_day_cooked does not freeze (D-57).
    await flag(b.id, "no_day_cooked");
    expect((await ask(await clientFor(b.cust), [b.id])).data).toEqual([]);
  });

  it("booking_is_frozen is server-only", async () => {
    const s = await accepted("ff-fn3", { daysAgo: 1 });
    for (const c of [
      anonClient(),
      await clientFor(s.cust),
      await clientFor(s.chef),
      await clientFor(fx.admin),
    ]) {
      const r = await c.rpc("booking_is_frozen", { p_booking: s.id });
      expectDenied(r);
      expect(r.data).toBeFalsy();
    }
    expect((await svc.rpc("booking_is_frozen", { p_booking: s.id })).data).toBe(
      false,
    );
  });

  it("the flag table stays admin-only: the parties cannot read the reason", async () => {
    const s = await accepted("ff-fn4", { daysAgo: 1 });
    await flag(s.id, "chef_rejected");
    for (const who of [s.cust, s.chef]) {
      const r = await (
        await clientFor(who)
      )
        .from("booking_flags")
        .select("reason")
        .eq("booking_id", s.id);
      expect(r.data ?? []).toEqual([]);
    }
  });
});

describe("receipts on a frozen booking (chef action)", () => {
  it("submit_receipt and the upload policy helper refuse; they work when not frozen", async () => {
    const s = await accepted("ff-rcpt", { daysAgo: 0, cooked: true });
    await svc
      .from("bookings")
      .update({ grocery_option: "chef_shops" })
      .eq("id", s.id);
    const chefClient = await clientFor(s.chef);
    expect(
      (await chefClient.rpc("booking_accepts_receipts", { p_booking: s.id }))
        .data,
    ).toBe(true);

    await flag(s.id, "chef_rejected");
    expect(
      (await chefClient.rpc("booking_accepts_receipts", { p_booking: s.id }))
        .data,
    ).toBe(false);
    const submit = (path: string) =>
      svc.rpc("submit_receipt", {
        p_booking: s.id,
        p_chef: s.chef.id,
        p_path: path,
        p_amount: 4000,
        p_mismatch: false,
      });
    expect((await submit(`${s.id}/r-${rand(6)}.jpg`)).data).toEqual({
      result: "invalid_state",
      reason: "frozen",
    });
    const none = await svc.from("receipts").select("id").eq("booking_id", s.id);
    expect(none.data).toEqual([]);

    await svc
      .from("booking_flags")
      .update({ resolved_at: new Date().toISOString() })
      .eq("booking_id", s.id);
    expect(
      (await chefClient.rpc("booking_accepts_receipts", { p_booking: s.id }))
        .data,
    ).toBe(true);
    expect((await submit(`${s.id}/r-${rand(6)}.jpg`)).data).toMatchObject({
      result: "ok",
    });
  });
});

describe("T-074 review L1: a blank kitchen address part counts as missing", () => {
  it.each([
    ["spaces in the line", { kitchen_address_line: "   " }],
    ["spaces in the city", { kitchen_city: "  " }],
    ["empty city", { kitchen_city: "" }],
    ["empty line", { kitchen_address_line: "" }],
  ])(
    "%s: accept is refused, the booking stays requested",
    async (_label, patch) => {
      const chef = await makeChef(svc, `ff-blank-${rand(4)}`, {
        options: ["customer_home", "chef_home"],
        chefHomeEnabled: true,
      });
      const cust = await makeCustomer(svc, `ff-blank-cust-${rand(4)}`);
      const b = await makeBooking(svc, {
        customer: cust,
        chef,
        dates: [future()],
        location: "chef_home",
      });
      expect(
        (await svc.from("chef_private").update(patch).eq("chef_id", chef.id))
          .error,
      ).toBeNull();
      const r = await svc.rpc("answer_booking", {
        p_booking: b.id,
        p_chef: chef.id,
        p_action: "accept",
        p_reason: null,
      });
      expect(r.data).toEqual({ result: "kitchen_address_missing" });
      expect(await status(b.id)).toBe("requested");
      const snap = await svc
        .from("booking_kitchen_addresses")
        .select("booking_id")
        .eq("booking_id", b.id);
      expect(snap.data).toEqual([]);
    },
  );
});
