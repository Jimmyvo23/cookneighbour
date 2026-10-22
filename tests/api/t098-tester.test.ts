// T-098 Tester (WO-T098-tester): the database no longer checks that the author or reporter is the
// signed-in user, so the routes must. No body field may set who wrote a review or a report; the
// stored author, subject, role and reporter always come from the session and the booking.
// LOCAL Supabase (CI).
import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import {
  acceptedBooking,
  completedBooking,
  postReport,
  postReview,
  svc,
} from "./engagement-helpers";
import { randomUUID } from "node:crypto";

beforeEach(() => freshLimits());

describe("T-098: the review author comes from the session, never from the body", () => {
  it("authorId, subjectId, authorRole and snake_case twins in the body are 422 and nothing is written", async () => {
    const f = await completedBooking();
    for (const extra of [
      { authorId: f.chef.id },
      { subjectId: f.cust.id },
      { authorRole: "chef" },
      { author_id: f.chef.id },
      { subject_id: f.cust.id },
      { author_role: "chef" },
      { bookingId: randomUUID() },
      { booking_id: randomUUID() },
      { authorDisplayName: "Someone Else" },
      { author_display_name: "Someone Else" },
      { createdAt: "2001-01-01T00:00:00Z" },
      { id: randomUUID() },
    ]) {
      const r = await postReview(f.cust.b, f.id, { rating: 5, ...extra });
      expect(r.status, JSON.stringify(extra) + r.text).toBe(422);
      expect(r.body.error.code).toBe("VALIDATION_FAILED");
    }
    const rows = await svc.from("reviews").select("id").eq("booking_id", f.id);
    expect(rows.data).toEqual([]);
  });

  it("the stored row has the session user as author, the other party as subject and the matching role (both parties)", async () => {
    const f = await completedBooking();
    const a = await postReview(f.cust.b, f.id, {
      rating: 5,
      comment: "Lovely",
    });
    expect(a.status, a.text).toBe(201);
    const b = await postReview(f.chef.b, f.id, { rating: 4 });
    expect(b.status, b.text).toBe(201);
    const rows = await svc
      .from("reviews")
      .select("author_id, subject_id, author_role, booking_id")
      .eq("booking_id", f.id)
      .order("author_role");
    expect(rows.error).toBeNull();
    expect(rows.data).toEqual([
      {
        author_id: f.chef.id,
        subject_id: f.cust.id,
        author_role: "chef",
        booking_id: f.id,
      },
      {
        author_id: f.cust.id,
        subject_id: f.chef.id,
        author_role: "customer",
        booking_id: f.id,
      },
    ]);
  });
});

describe("T-098: the report reporter comes from the session, never from the body", () => {
  it("reporterId, reporter_id, status and resolved_at in the body are 422; the stored reporter is the session user", async () => {
    const f = await acceptedBooking();
    const base = {
      clientId: randomUUID(),
      category: "other",
      description: "Something went wrong",
    };
    for (const extra of [
      { reporterId: f.chef.id },
      { reporter_id: f.chef.id },
      { status: "resolved" },
      { resolved_at: "2001-01-01T00:00:00Z" },
      { resolvedAt: "2001-01-01T00:00:00Z" },
      { bookingId: randomUUID() },
      { booking_id: randomUUID() },
    ]) {
      const r = await postReport(f.cust.b, f.id, { ...base, ...extra });
      expect(r.status, JSON.stringify(extra) + r.text).toBe(422);
    }
    expect(
      (await svc.from("reports").select("id").eq("booking_id", f.id)).data,
    ).toEqual([]);
    const ok = await postReport(f.chef.b, f.id, base);
    expect(ok.status, ok.text).toBe(201);
    const row = await svc
      .from("reports")
      .select("reporter_id, status, resolved_at, booking_id")
      .eq("booking_id", f.id)
      .single();
    expect(row.data).toEqual({
      reporter_id: f.chef.id,
      status: "open",
      resolved_at: null,
      booking_id: f.id,
    });
  });
});
