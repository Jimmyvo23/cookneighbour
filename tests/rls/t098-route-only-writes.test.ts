// T-098 (WO-T098, T-053 MED-1 and LOW-1): reviews and reports have no browser write path. A valid
// payload sent straight to PostgREST by a customer, the chef, an admin or an anonymous visitor is
// refused with 42501 and nothing is written; update and delete are refused too. The rules the old
// insert policies held (party, status, window, open report) now live in triggers that bind the
// service role as well, so the route is not the only guard.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  clientFor,
  dayPlus,
  expectCode,
  expectDenied,
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
let chef: Person;
let stranger: Person;
let browsers: [string, SupabaseClient][];
let n = 0;

beforeAll(async () => {
  cust = await makeCustomer(svc, "t98-customer");
  stranger = await makeCustomer(svc, "t98-stranger");
  chef = await makeChef(svc, "t98-chef", { status: "approved" });
  const [cC, cH, cA, cS] = await Promise.all(
    [cust, chef, fx.admin, stranger].map(clientFor),
  );
  browsers = [
    ["customer", cC],
    ["chef", cH],
    ["admin", cA],
    ["stranger", cS],
    ["anon", anonClient()],
  ];
});

async function booking(status: string, ago = 1000): Promise<string> {
  n += 1;
  const b = await makeBooking(svc, {
    customer: cust,
    chef,
    dates: [dayPlus(fx.baseDay, 1100 + n)],
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

describe("T-098: no browser insert, update or delete on reviews and reports", () => {
  it("a valid review and a valid report sent directly are refused for every browser role", async () => {
    const done = await booking("completed");
    const open = await booking("accepted");
    for (const [who, c] of browsers) {
      for (const [author, subject, role] of [
        [cust, chef, "customer"],
        [chef, cust, "chef"],
      ] as const)
        expectCode(
          await c
            .from("reviews")
            .insert({
              booking_id: done,
              author_id: author.id,
              subject_id: subject.id,
              author_role: role,
              rating: 5,
              comment: `direct ${who} Book me direct 416 555 0199`,
            })
            .select("id"),
          "42501",
        );
      for (const reporter of [cust, chef])
        expectCode(
          await c
            .from("reports")
            .insert({
              booking_id: open,
              reporter_id: reporter.id,
              description: `direct ${who}`,
            })
            .select("id"),
          "42501",
        );
      // Without returning too (the old route path).
      expectCode(
        await c.from("reports").insert({
          booking_id: open,
          reporter_id: cust.id,
          description: "no returning",
        }),
        "42501",
      );
      expectCode(
        await c.from("reports").insert({
          booking_id: open,
          reporter_id: cust.id,
          description: "retry key",
          client_id: randomUUID(),
        }),
        "42501",
      );
    }
    const r1 = await svc.from("reviews").select("id").eq("booking_id", done);
    const r2 = await svc.from("reports").select("id").eq("booking_id", open);
    expect(r1.data).toEqual([]);
    expect(r2.data).toEqual([]);
  });

  it("nobody updates or deletes a review or a report from a browser", async () => {
    const done = await booking("completed");
    const rv = await svc
      .from("reviews")
      .insert({
        booking_id: done,
        author_id: cust.id,
        subject_id: chef.id,
        author_role: "customer",
        rating: 5,
        comment: "fine",
      })
      .select("id")
      .single();
    expect(rv.error).toBeNull();
    const rp = await svc
      .from("reports")
      .insert({ booking_id: done, reporter_id: cust.id, description: "x" })
      .select("id")
      .single();
    expect(rp.error).toBeNull();
    for (const [, c] of browsers) {
      expectDenied(
        await c
          .from("reviews")
          .update({ rating: 1 })
          .eq("id", rv.data?.id)
          .select(),
      );
      expectDenied(
        await c.from("reviews").delete().eq("id", rv.data?.id).select(),
      );
      expectDenied(
        await c
          .from("reports")
          .update({ status: "resolved", description: "edited" })
          .eq("id", rp.data?.id)
          .select(),
      );
      expectDenied(
        await c.from("reports").delete().eq("id", rp.data?.id).select(),
      );
    }
    const rv2 = await svc
      .from("reviews")
      .select("rating")
      .eq("id", rv.data?.id)
      .single();
    expect(rv2.data?.rating).toBe(5);
    const rp2 = await svc
      .from("reports")
      .select("status, description")
      .eq("id", rp.data?.id)
      .single();
    expect(rp2.data).toEqual({ status: "open", description: "x" });
  });
});

describe("T-098: the database keeps the rules for the service role too", () => {
  const review = (id: string, over: Record<string, unknown> = {}) => ({
    booking_id: id,
    author_id: cust.id,
    subject_id: chef.id,
    author_role: "customer",
    rating: 4,
    comment: "ok",
    ...over,
  });

  it("a review needs a completed booking, inside the window, from a party, with the right role", async () => {
    const inside = await booking("completed", 14 * DAY - 3_600_000);
    expectRows(
      await svc.from("reviews").insert(review(inside)).select("id"),
      1,
    );
    const late = await booking("completed", 14 * DAY + 3_600_000);
    expectCode(
      await svc.from("reviews").insert(review(late)).select("id"),
      "42501",
    );
    const accepted = await booking("accepted");
    expectCode(
      await svc.from("reviews").insert(review(accepted)).select("id"),
      "42501",
    );
    const done = await booking("completed");
    for (const over of [
      { author_id: stranger.id },
      { subject_id: stranger.id },
      { author_role: "chef" },
      { booking_id: randomUUID() },
    ])
      expectCode(
        await svc.from("reviews").insert(review(done, over)).select("id"),
        "42501",
      );
    const rows = await svc.from("reviews").select("id").eq("booking_id", done);
    expect(rows.data).toEqual([]);
  });

  it("a report needs a party of the booking as reporter, and is born open", async () => {
    const id = await booking("accepted");
    const rep = (over: Record<string, unknown> = {}) => ({
      booking_id: id,
      reporter_id: cust.id,
      description: "x",
      ...over,
    });
    for (const over of [
      { reporter_id: stranger.id },
      { status: "resolved" },
      { resolved_at: new Date().toISOString() },
      { booking_id: randomUUID() },
    ])
      expectCode(
        await svc.from("reports").insert(rep(over)).select("id"),
        "42501",
      );
    expectRows(await svc.from("reports").insert(rep()).select("id"), 1);
    expectRows(
      await svc
        .from("reports")
        .insert(rep({ reporter_id: chef.id }))
        .select("id"),
      1,
    );
  });
});
