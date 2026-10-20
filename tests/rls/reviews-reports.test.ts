// T-048 (WO-5c): row-level security for reviews, reports and the admin decision function, on the
// real stack. The review window (14 days, Jimmy 2026-10-20) is enforced by the insert policy, so a
// direct browser insert is refused too. Own customers, chef and bookings: no shared fixtures.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  clientFor,
  dayPlus,
  expectDenied,
  expectNoRows,
  expectRows,
  makeBooking,
  makeChef,
  makeCustomer,
  serviceClient,
  type Person,
} from "./helpers";

const fx = inject("fx");
const svc = serviceClient();
const DAY = 24 * 3_600_000;

let cust: Person;
let other: Person;
let chef: Person;
let cC: SupabaseClient;
let cO: SupabaseClient;
let cH: SupabaseClient;
let cAdmin: SupabaseClient;
let n = 0;

beforeAll(async () => {
  cust = await makeCustomer(svc, "rv-customer");
  other = await makeCustomer(svc, "rv-other");
  chef = await makeChef(svc, "rv-chef", { status: "approved" });
  [cC, cO, cH, cAdmin] = await Promise.all(
    [cust, other, chef, fx.admin].map(clientFor),
  );
});

/** A booking of cust with chef in `status`, completed `ago` ms ago when completed. */
async function booking(status: string, ago = 0): Promise<string> {
  n += 1;
  const b = await makeBooking(svc, {
    customer: cust,
    chef,
    dates: [dayPlus(fx.baseDay, 700 + n)],
    status: status as "requested",
  });
  if (status === "completed") {
    const up = await svc
      .from("bookings")
      .update({ completed_at: new Date(Date.now() - ago).toISOString() })
      .eq("id", b.id);
    expect(up.error).toBeNull();
  }
  return b.id;
}

const review = (
  booking_id: string,
  author: Person,
  subject: Person,
  author_role: "customer" | "chef",
) => ({
  booking_id,
  author_id: author.id,
  subject_id: subject.id,
  author_role,
  rating: 5,
  comment: "ok",
});

describe("review window (insert policy)", () => {
  it("13 days 23 hours after completion: allowed, for the customer and for the chef", async () => {
    const id = await booking("completed", 14 * DAY - 3_600_000);
    expectRows(
      await cC
        .from("reviews")
        .insert(review(id, cust, chef, "customer"))
        .select(),
      1,
    );
    expectRows(
      await cH
        .from("reviews")
        .insert(review(id, chef, cust, "chef"))
        .select(),
      1,
    );
  });

  it("14 days and 1 hour after completion: refused for both, nothing is written", async () => {
    const id = await booking("completed", 14 * DAY + 3_600_000);
    expectDenied(
      await cC
        .from("reviews")
        .insert(review(id, cust, chef, "customer"))
        .select(),
    );
    expectDenied(
      await cH
        .from("reviews")
        .insert(review(id, chef, cust, "chef"))
        .select(),
    );
    const rows = await svc.from("reviews").select("id").eq("booking_id", id);
    expect(rows.data).toEqual([]);
  });

  it("a booking that is not completed cannot be reviewed", async () => {
    for (const status of ["requested", "accepted", "declined", "cancelled"]) {
      const id = await booking(status);
      expectDenied(
        await cC
          .from("reviews")
          .insert(review(id, cust, chef, "customer"))
          .select(),
      );
    }
  });

  it("a non-party cannot review, nobody writes as someone else, the role must match", async () => {
    const id = await booking("completed", 1000);
    expectDenied(
      await cO
        .from("reviews")
        .insert(review(id, other, chef, "customer"))
        .select(),
    );
    expectDenied(
      await cO
        .from("reviews")
        .insert(review(id, cust, chef, "customer"))
        .select(),
    );
    expectDenied(
      await cC
        .from("reviews")
        .insert(review(id, cust, chef, "chef"))
        .select(),
    );
  });

  it("one review per author per booking (unique key), and a posted review is final", async () => {
    const id = await booking("completed", 1000);
    expectRows(
      await cC
        .from("reviews")
        .insert(review(id, cust, chef, "customer"))
        .select(),
      1,
    );
    const dup = await cC
      .from("reviews")
      .insert(review(id, cust, chef, "customer"))
      .select();
    expect(dup.error?.code).toBe("23505");
    expectDenied(
      await cC
        .from("reviews")
        .update({ rating: 1 })
        .eq("booking_id", id)
        .select(),
    );
    expectDenied(
      await cC.from("reviews").delete().eq("booking_id", id).select(),
    );
    expectDenied(
      await cAdmin
        .from("reviews")
        .update({ rating: 1 })
        .eq("booking_id", id)
        .select(),
    );
    expectDenied(
      await cAdmin.from("reviews").delete().eq("booking_id", id).select(),
    );
    const row = await svc.from("reviews").select("rating").eq("booking_id", id);
    expect(row.data).toEqual([{ rating: 5 }]);
  });
});

describe("who can read a review", () => {
  it("a customer's review of an approved chef is public; a chef's review of a customer is customer + admin only", async () => {
    const id = await booking("completed", 1000);
    expectRows(
      await cC
        .from("reviews")
        .insert(review(id, cust, chef, "customer"))
        .select(),
      1,
    );
    expectRows(
      await cH
        .from("reviews")
        .insert(review(id, chef, cust, "chef"))
        .select(),
      1,
    );
    const anon = anonClient();
    // Public: the customer's review (by subject, the way the public route reads it).
    expectRows(
      await anon
        .from("reviews")
        .select("id, rating")
        .eq("booking_id", id)
        .eq("subject_id", chef.id)
        .eq("author_role", "customer"),
    );
    // Private: nobody outside the two parties and the admin sees the chef's review.
    expectNoRows(
      await anon
        .from("reviews")
        .select("id")
        .eq("subject_id", cust.id)
        .eq("author_role", "chef"),
    );
    expectNoRows(
      await cO
        .from("reviews")
        .select("id")
        .eq("subject_id", cust.id)
        .eq("author_role", "chef"),
    );
    expectRows(
      await cC
        .from("reviews")
        .select("id")
        .eq("subject_id", cust.id)
        .eq("author_role", "chef"),
      1,
    );
    expectRows(
      await cH
        .from("reviews")
        .select("id")
        .eq("author_id", chef.id)
        .eq("author_role", "chef"),
      1,
    );
    expectRows(
      await cAdmin
        .from("reviews")
        .select("id")
        .eq("subject_id", cust.id)
        .eq("author_role", "chef"),
    );
  });

  it("when the chef stops being approved, customers' reviews of them leave the public list", async () => {
    const c2 = await makeChef(svc, "rv-chef-later-pending", {
      status: "approved",
    });
    const b = await makeBooking(svc, {
      customer: cust,
      chef: c2,
      dates: [dayPlus(fx.baseDay, 800)],
      status: "completed",
    });
    const ins = await svc
      .from("reviews")
      .insert(review(b.id, cust, c2, "customer"))
      .select("id");
    expect(ins.error).toBeNull();
    expectRows(
      await anonClient().from("reviews").select("id").eq("subject_id", c2.id),
      1,
    );
    const off = await svc
      .from("chefs")
      .update({ status: "rejected" })
      .eq("profile_id", c2.id);
    expect(off.error).toBeNull();
    expectNoRows(
      await anonClient().from("reviews").select("id").eq("subject_id", c2.id),
    );
  });
});

describe("reports", () => {
  it("one open report per reporter per booking, also through a direct insert; the other party may report", async () => {
    const id = await booking("accepted");
    const mine = {
      booking_id: id,
      reporter_id: cust.id,
      description: "first",
    };
    const first = await cC.from("reports").insert(mine).select("id");
    expectRows(first, 1);
    const second = await cC.from("reports").insert(mine).select("id");
    expect(second.error?.code).toBe("23505");
    expect(second.error?.message).toContain("reports_one_open_per_reporter");
    expectRows(
      await cH
        .from("reports")
        .insert({
          booking_id: id,
          reporter_id: chef.id,
          description: "theirs",
        })
        .select("id"),
      1,
    );
    // Once the report is closed the same reporter can file another.
    const rid = (first.data as { id: string }[])[0].id;
    const close = await svc
      .from("reports")
      .update({ status: "dismissed" })
      .eq("id", rid)
      .select();
    expect(close.error).toBeNull();
    expectRows(await cC.from("reports").insert(mine).select("id"), 1);
  });

  it("the other party and strangers cannot read a report; the reporter and admin can", async () => {
    const id = await booking("accepted");
    const ins = await cC
      .from("reports")
      .insert({ booking_id: id, reporter_id: cust.id, description: "x" })
      .select("id");
    const rid = (ins.data as { id: string }[])[0].id;
    expectNoRows(await cH.from("reports").select("id").eq("id", rid));
    expectNoRows(await cO.from("reports").select("id").eq("id", rid));
    expectNoRows(await anonClient().from("reports").select("id").eq("id", rid));
    expectRows(await cC.from("reports").select("id").eq("id", rid), 1);
    expectRows(await cAdmin.from("reports").select("id").eq("id", rid), 1);
  });

  it("nobody updates a report from a browser, the reporter or the admin; client_id is not a browser column", async () => {
    const id = await booking("accepted");
    const ins = await cC
      .from("reports")
      .insert({ booking_id: id, reporter_id: cust.id, description: "x" })
      .select("id");
    const rid = (ins.data as { id: string }[])[0].id;
    for (const c of [cC, cAdmin])
      expectDenied(
        await c
          .from("reports")
          .update({ status: "resolved" })
          .eq("id", rid)
          .select(),
      );
    const withKey = await cC
      .from("reports")
      .insert({
        booking_id: await booking("accepted"),
        reporter_id: cust.id,
        description: "x",
        client_id: randomUUID(),
      })
      .select();
    expect(withKey.error?.code).toBe("42501");
  });
});

describe("admin_decisions and admin_decide_booking are not reachable from a browser", () => {
  it("no client can read or write the audit table", async () => {
    for (const c of [cC, cH, cAdmin, anonClient()]) {
      expectNoRows(await c.from("admin_decisions").select("id"));
      expectDenied(
        await c
          .from("admin_decisions")
          .insert({
            kind: "report_dismissed",
            booking_id: await booking("accepted"),
            admin_id: fx.admin.id,
            note: "forged",
          })
          .select(),
      );
    }
  });

  it("the decision function is service role only", async () => {
    const id = await booking("accepted");
    const rep = await svc
      .from("reports")
      .insert({ booking_id: id, reporter_id: cust.id, description: "x" })
      .select("id")
      .single();
    expect(rep.error).toBeNull();
    const args = {
      p_admin: fx.admin.id,
      p_kind: "report_dismiss",
      p_booking: null,
      p_report: rep.data?.id,
      p_final: null,
      p_note: "from a browser",
    };
    for (const c of [cC, cH, cAdmin, anonClient()]) {
      const r = await c.rpc("admin_decide_booking", args);
      expect(r.error?.code, r.error?.message).toBe("42501");
    }
    const still = await svc
      .from("reports")
      .select("status")
      .eq("id", rep.data?.id)
      .single();
    expect(still.data?.status).toBe("open");
    // The service role can, and a non-admin id is refused inside the function (second line).
    const asCust = await svc.rpc("admin_decide_booking", {
      ...args,
      p_admin: cust.id,
    });
    expect(asCust.error).not.toBeNull();
    const ok = await svc.rpc("admin_decide_booking", args);
    expect(ok.error, ok.error?.message).toBeNull();
    expect(ok.data).toMatchObject({ result: "ok", changed: false });
  });

  it("the window helper can be called by a signed-in user and says 14", async () => {
    const r = await cC.rpc("review_window_days");
    expect(r.error).toBeNull();
    expect(r.data).toBe(14);
  });
});
