import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  clientFor,
  expectDenied,
  expectNoRows,
  expectRows,
  ids,
  serviceClient,
} from "./helpers";

const fx = inject("fx");
const b = fx.bookings;
const svc = serviceClient();

// T-046: sending is API only (the function send_message). The browser has no insert path left;
// the full messaging checks (D-93 to D-96) are in messaging.test.ts.
describe("messages", () => {
  let c1: SupabaseClient;
  let c2: SupabaseClient;
  let h1: SupabaseClient;
  let admin: SupabaseClient;
  beforeAll(async () => {
    [c1, c2, h1, admin] = await Promise.all(
      [fx.c1, fx.c2, fx.h1, fx.admin].map(clientFor),
    );
  });

  it("a party cannot insert a message directly any more, as themselves or as someone else", async () => {
    for (const [client, sender] of [
      [c1, fx.c1.id],
      [h1, fx.h1.id],
      [c1, fx.h1.id],
    ] as const)
      expectDenied(
        await client
          .from("messages")
          .insert({
            booking_id: b.requestedC1H1,
            sender_id: sender,
            body: "direct",
          })
          .select(),
      );
    const { data } = await svc
      .from("messages")
      .select("id")
      .eq("body", "direct");
    expect(data).toEqual([]);
  });

  it("a stranger cannot send into someone else's booking, and anon cannot send at all", async () => {
    expectDenied(
      await c2
        .from("messages")
        .insert({
          booking_id: b.requestedC1H1,
          sender_id: fx.c2.id,
          body: "intrude",
        })
        .select(),
    );
    expectDenied(
      await anonClient()
        .from("messages")
        .insert({ booking_id: b.requestedC1H1, sender_id: fx.c1.id, body: "x" })
        .select(),
    );
    const { data } = await svc
      .from("messages")
      .select("id")
      .eq("body", "intrude");
    expect(data).toEqual([]);
  });

  it("admin can read messages but cannot send", async () => {
    expectRows(
      await admin
        .from("messages")
        .select("id")
        .eq("booking_id", b.requestedC1H1),
    );
    expectDenied(
      await admin
        .from("messages")
        .insert({
          booking_id: b.requestedC1H1,
          sender_id: fx.admin.id,
          body: "admin",
        })
        .select(),
    );
  });

  it("messages cannot be edited or deleted by clients", async () => {
    expectDenied(
      await c1
        .from("messages")
        .update({ body: "edited" })
        .eq("booking_id", b.requestedC1H1)
        .select(),
    );
    expectDenied(
      await c1
        .from("messages")
        .delete()
        .eq("booking_id", b.requestedC1H1)
        .select(),
    );
  });

  it("nobody can send into a declined booking or a completed one directly", async () => {
    for (const booking of [b.declinedC1H1, b.completedC1H1])
      expectDenied(
        await c1
          .from("messages")
          .insert({ booking_id: booking, sender_id: fx.c1.id, body: "x" })
          .select(),
      );
  });
});

describe("reviews (only after a completed booking)", () => {
  let c1: SupabaseClient;
  let c2: SupabaseClient;
  let h1: SupabaseClient;
  beforeAll(async () => {
    [c1, c2, h1] = await Promise.all([fx.c1, fx.c2, fx.h1].map(clientFor));
  });

  const review = (
    booking: string,
    author: string,
    subject: string,
    role: string,
  ) => ({
    booking_id: booking,
    author_id: author,
    subject_id: subject,
    author_role: role,
    rating: 5,
    comment: "great",
  });

  it("no review before the booking is completed", async () => {
    expectDenied(
      await c1
        .from("reviews")
        .insert(review(b.acceptedC1H1, fx.c1.id, fx.h1.id, "customer"))
        .select("id"),
    );
    expectDenied(
      await c1
        .from("reviews")
        .insert(review(b.requestedC1H1, fx.c1.id, fx.h1.id, "customer"))
        .select("id"),
    );
  });

  it("a non-party cannot review; nobody can write as someone else or with the wrong role", async () => {
    expectDenied(
      await c2
        .from("reviews")
        .insert(review(b.completedC1H1, fx.c2.id, fx.h1.id, "customer"))
        .select("id"),
    );
    expectDenied(
      await c2
        .from("reviews")
        .insert(review(b.completedC1H1, fx.c1.id, fx.h1.id, "customer"))
        .select("id"),
    );
    expectDenied(
      await c1
        .from("reviews")
        .insert(review(b.completedC1H1, fx.c1.id, fx.h1.id, "chef"))
        .select("id"),
    );
    expectDenied(
      await c1
        .from("reviews")
        .insert(review(b.completedC1H1, fx.c1.id, fx.h2.id, "customer"))
        .select("id"),
    );
  });

  it("the customer reviews the chef after completion; the cached rating updates; anon can read it", async () => {
    expectRows(
      await c1
        .from("reviews")
        .insert(review(b.completedC1H1, fx.c1.id, fx.h1.id, "customer"))
        .select("id"),
      1,
    );
    const { data } = await svc
      .from("chefs")
      .select("rating_avg,review_count")
      .eq("profile_id", fx.h1.id)
      .single();
    expect(data?.review_count).toBe(1);
    expect(Number(data?.rating_avg)).toBe(5);
    const own = await svc
      .from("reviews")
      .select("id")
      .eq("booking_id", b.completedC1H1)
      .eq("author_id", fx.c1.id)
      .single();
    // T-048 fix round: anon reads by id (it has no grant on booking_id or author_id).
    const pub = await anonClient()
      .from("reviews")
      .select("rating")
      .eq("id", own.data?.id as string);
    expectRows(pub, 1);
    // duplicate review for the same booking is rejected
    const dup = await c1
      .from("reviews")
      .insert(review(b.completedC1H1, fx.c1.id, fx.h1.id, "customer"))
      .select("id");
    expect(dup.error?.code).toBe("23505");
  });

  it("the chef's review of the customer is private: not visible to anon or strangers, visible to its two parties", async () => {
    expectRows(
      await h1
        .from("reviews")
        .insert(review(b.completedC1H1, fx.h1.id, fx.c1.id, "chef"))
        .select("id"),
      1,
    );
    const chefReview = await svc
      .from("reviews")
      .select("id")
      .eq("author_id", fx.h1.id)
      .eq("author_role", "chef")
      .single();
    expectNoRows(
      await anonClient()
        .from("reviews")
        .select("id")
        .eq("id", chefReview.data?.id as string),
    );
    // Round 3: browser roles cannot filter on author_id, so rows are found by id.
    const rid = chefReview.data?.id as string;
    expectNoRows(await c2.from("reviews").select("id").eq("id", rid));
    expectRows(await c1.from("reviews").select("id").eq("id", rid), 1);
    expectRows(await h1.from("reviews").select("id").eq("id", rid), 1);
  });

  it("reviews cannot be edited or deleted by clients", async () => {
    expectDenied(
      await c1
        .from("reviews")
        .update({ rating: 1 })
        .eq("author_id", fx.c1.id)
        .select(),
    );
    expectDenied(
      await c1.from("reviews").delete().eq("author_id", fx.c1.id).select(),
    );
  });
});

describe("reports (report-a-problem)", () => {
  let c1: SupabaseClient;
  let c2: SupabaseClient;
  let h1: SupabaseClient;
  let admin: SupabaseClient;
  let reportId: string;
  beforeAll(async () => {
    [c1, c2, h1, admin] = await Promise.all(
      [fx.c1, fx.c2, fx.h1, fx.admin].map(clientFor),
    );
  });

  it("a party can file a report on their booking; a stranger cannot", async () => {
    const ok = await c1
      .from("reports")
      .insert({
        booking_id: b.acceptedC1H1,
        reporter_id: fx.c1.id,
        description: "chef was late",
      })
      .select("id");
    expectRows(ok, 1);
    reportId = (ok.data as { id: string }[])[0].id;
    expectDenied(
      await c2
        .from("reports")
        .insert({
          booking_id: b.acceptedC1H1,
          reporter_id: fx.c2.id,
          description: "x",
        })
        .select(),
    );
    expectDenied(
      await c1
        .from("reports")
        .insert({
          booking_id: b.acceptedC1H1,
          reporter_id: fx.c2.id,
          description: "forged reporter",
        })
        .select(),
    );
  });

  it("a reporter cannot pre-resolve or add an admin note on insert", async () => {
    expectDenied(
      await c1
        .from("reports")
        .insert({
          booking_id: b.acceptedC1H1,
          reporter_id: fx.c1.id,
          description: "x",
          status: "resolved",
        })
        .select(),
    );
    expectDenied(
      await c1
        .from("reports")
        .insert({
          booking_id: b.acceptedC1H1,
          reporter_id: fx.c1.id,
          description: "x",
          admin_note: "fine",
        })
        .select(),
    );
  });

  it("only the reporter and admin can read it; the other party and strangers cannot", async () => {
    expectRows(await c1.from("reports").select("id").eq("id", reportId), 1);
    expectRows(await admin.from("reports").select("id").eq("id", reportId), 1);
    expectNoRows(await h1.from("reports").select("id").eq("id", reportId));
    expectNoRows(await c2.from("reports").select("id").eq("id", reportId));
    expectNoRows(await anonClient().from("reports").select("id"));
  });

  it("nobody can update a report from a browser (T-048: the admin decides through admin_decide_booking)", async () => {
    expectDenied(
      await c1
        .from("reports")
        .update({ status: "resolved" })
        .eq("id", reportId)
        .select(),
    );
    expectDenied(
      await admin
        .from("reports")
        .update({ status: "reviewing", admin_note: "looking" })
        .eq("id", reportId)
        .select(),
    );
    const { data } = await svc
      .from("reports")
      .select("status")
      .eq("id", reportId)
      .single();
    expect(data?.status).toBe("open");
    expect(ids(await admin.from("reports").select("id"))).toContain(reportId);
  });
});
