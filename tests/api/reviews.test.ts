// T-048: reviews through the real routes (contract 7D). LOCAL Supabase (CI).
import { beforeEach, describe, expect, it } from "vitest";
import * as reviewsModule from "@/app/api/bookings/[id]/reviews/route";
import { REVIEW_WINDOW_DAYS } from "@/lib/domain/config";
import { Browser, freshLimits } from "./harness";
import { bookingCustomer, getBooking } from "./booking-helpers";
import { newAdmin, newCustomer } from "./chef-helpers";
import {
  acceptedBooking,
  adminReviews,
  allKeys,
  completedBooking,
  getReviews,
  postReview,
  publicReviews,
  requestedBooking,
  setCompletedAt,
  svc,
} from "./engagement-helpers";

beforeEach(() => freshLimits());

const DAY = 24 * 3_600_000;

describe("who can review, and when", () => {
  it("the customer reviews the chef after completion; the reply has no ids of people", async () => {
    const f = await completedBooking();
    const g0 = await getReviews(f.cust.b, f.id);
    expect(g0.status, g0.text).toBe(200);
    expect(g0.body.allowance).toMatchObject({ allowed: true, reason: null });
    expect(g0.body.mine).toBeNull();
    expect(g0.body.other).toBeNull();

    const r = await postReview(f.cust.b, f.id, {
      rating: 5,
      comment: "  Wonderful pho.  ",
    });
    expect(r.status, r.text).toBe(201);
    expect(r.body).toMatchObject({
      bookingId: f.id,
      authorRole: "customer",
      rating: 5,
      comment: "Wonderful pho.",
      mine: true,
    });
    const keys = allKeys(r.body);
    for (const k of ["authorId", "subjectId", "author_id", "subject_id"])
      expect(keys.has(k)).toBe(false);

    const g1 = await getReviews(f.cust.b, f.id);
    expect(g1.body.allowance).toMatchObject({
      allowed: false,
      reason: "already_reviewed",
    });
    expect(g1.body.mine.id).toBe(r.body.id);
    // The chef sees it as the review about them, not as their own.
    const gc = await getReviews(f.chef.b, f.id);
    expect(gc.body.other).toMatchObject({ id: r.body.id, mine: false });
    expect(gc.body.mine).toBeNull();
    expect(gc.body.allowance.allowed).toBe(true);
  });

  it("the chef reviews the customer; only the customer (and the admin) can read it", async () => {
    const f = await completedBooking();
    const r = await postReview(f.chef.b, f.id, { rating: 4 });
    expect(r.status, r.text).toBe(201);
    expect(r.body).toMatchObject({ authorRole: "chef", comment: null });
    const gc = await getReviews(f.cust.b, f.id);
    expect(gc.body.other).toMatchObject({ id: r.body.id, authorRole: "chef" });
    // Not public: the chef's public list never holds it, and a stranger's booking route is 404.
    const pub = await publicReviews(new Browser(), f.chef.id);
    expect(pub.status, pub.text).toBe(200);
    expect(pub.body.items.map((x: { id: string }) => x.id)).not.toContain(
      r.body.id,
    );
    const stranger = await bookingCustomer();
    expect((await getReviews(stranger.b, f.id)).status).toBe(404);
    // The cached rating counts customer reviews only.
    const chefRow = await svc
      .from("chefs")
      .select("review_count")
      .eq("profile_id", f.chef.id)
      .single();
    expect(chefRow.data?.review_count).toBe(0);
    // The admin reads it through the admin list.
    const admin = await newAdmin();
    const list = await adminReviews(admin.b, "authorRole=chef&limit=50");
    expect(list.status, list.text).toBe(200);
    expect(list.body.items.map((x: { id: string }) => x.id)).toContain(
      r.body.id,
    );
  });

  it("a customer's review is public, with no author id and no booking id, and updates the chef's rating", async () => {
    const f = await completedBooking();
    const r = await postReview(f.cust.b, f.id, { rating: 4, comment: "Good" });
    expect(r.status).toBe(201);
    const pub = await publicReviews(new Browser(), f.chef.id);
    expect(pub.status, pub.text).toBe(200);
    const item = pub.body.items.find((x: { id: string }) => x.id === r.body.id);
    expect(item).toMatchObject({ rating: 4, comment: "Good" });
    expect(Object.keys(item).sort()).toEqual([
      "authorFirstName",
      "comment",
      "createdAt",
      "id",
      "rating",
    ]);
    const chefRow = await svc
      .from("chefs")
      .select("review_count, rating_avg")
      .eq("profile_id", f.chef.id)
      .single();
    expect(chefRow.data?.review_count).toBe(1);
    expect(Number(chefRow.data?.rating_avg)).toBe(4);
  });

  it("the public list shows the first word of the name only; the parties still see the whole name", async () => {
    const f = await completedBooking();
    const up = await svc
      .from("profiles")
      .update({ display_name: "  Mei Ling Chen " })
      .eq("id", f.cust.id);
    expect(up.error).toBeNull();
    const r = await postReview(f.cust.b, f.id, { rating: 5 });
    expect(r.status, r.text).toBe(201);
    expect(r.body.authorDisplayName).toBe("Mei Ling Chen");
    const pub = await publicReviews(new Browser(), f.chef.id);
    const item = pub.body.items.find((x: { id: string }) => x.id === r.body.id);
    expect(item.authorFirstName).toBe("Mei");
    expect(pub.text).not.toContain("Ling");
    expect(pub.text).not.toContain("authorDisplayName");
  });

  it("a booking that is not completed cannot be reviewed", async () => {
    const requested = await requestedBooking();
    const accepted = await acceptedBooking();
    for (const f of [requested, accepted]) {
      const g = await getReviews(f.cust.b, f.id);
      expect(g.body.allowance).toEqual({
        allowed: false,
        reason: "not_completed",
        closesAt: null,
      });
      for (const who of [f.cust, f.chef]) {
        const r = await postReview(who.b, f.id, { rating: 5 });
        expect(r.status, r.text).toBe(409);
        expect(r.body.error).toMatchObject({
          code: "INVALID_STATE",
          reason: "not_completed",
        });
      }
    }
    const rows = await svc
      .from("reviews")
      .select("id")
      .in("booking_id", [requested.id, accepted.id]);
    expect(rows.data).toEqual([]);
  });

  it("the window: day 14 still works, day 15 is closed (allowance, route)", async () => {
    const open = await completedBooking();
    const closed = await completedBooking();
    // The review window is 14 days (configurable constant), exactly 14 x 24 hours.
    expect(REVIEW_WINDOW_DAYS).toBe(14);
    await setCompletedAt(open.id, new Date(Date.now() - 14 * DAY + 5 * 60_000));
    await setCompletedAt(
      closed.id,
      new Date(Date.now() - 14 * DAY - 5 * 60_000),
    );

    const go = await getReviews(open.cust.b, open.id);
    expect(go.body.allowance.allowed).toBe(true);
    expect(go.body.allowance.closesAt).toBeTruthy();
    const ro = await postReview(open.cust.b, open.id, { rating: 5 });
    expect(ro.status, ro.text).toBe(201);

    const gc = await getReviews(closed.cust.b, closed.id);
    expect(gc.body.allowance).toMatchObject({
      allowed: false,
      reason: "window_closed",
    });
    for (const who of [closed.cust, closed.chef]) {
      const rc = await postReview(who.b, closed.id, { rating: 5 });
      expect(rc.status, rc.text).toBe(409);
      expect(rc.body.error.reason).toBe("window_closed");
    }
    const none = await svc
      .from("reviews")
      .select("id")
      .eq("booking_id", closed.id);
    expect(none.data).toEqual([]);
  });
});

describe("a posted review is final, and one per author", () => {
  it("the same content again is a retry (200, the first review); other content is 409 already_reviewed", async () => {
    const f = await completedBooking();
    const body = { rating: 3, comment: "Fine." };
    const first = await postReview(f.cust.b, f.id, body);
    expect(first.status).toBe(201);
    const again = await postReview(f.cust.b, f.id, body);
    expect(again.status, again.text).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    const edit = await postReview(f.cust.b, f.id, {
      rating: 1,
      comment: "Bad",
    });
    expect(edit.status, edit.text).toBe(409);
    expect(edit.body.error).toMatchObject({
      code: "INVALID_STATE",
      reason: "already_reviewed",
    });
    const rows = await svc
      .from("reviews")
      .select("rating")
      .eq("booking_id", f.id);
    expect(rows.data).toEqual([{ rating: 3 }]);
  });

  it("a retry still works after the window closed (the first review is returned, nothing is written)", async () => {
    const f = await completedBooking();
    const first = await postReview(f.cust.b, f.id, { rating: 2 });
    expect(first.status).toBe(201);
    await setCompletedAt(f.id, new Date(Date.now() - 30 * DAY));
    const again = await postReview(f.cust.b, f.id, { rating: 2 });
    expect(again.status, again.text).toBe(200);
    expect(again.body.id).toBe(first.body.id);
  });

  it("two parallel posts of the same review write exactly one row", async () => {
    const f = await completedBooking();
    const both = await Promise.all([
      postReview(f.cust.b, f.id, { rating: 5, comment: "Parallel" }),
      postReview(f.cust.b, f.id, { rating: 5, comment: "Parallel" }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(both[0].body.id).toBe(both[1].body.id);
    const rows = await svc.from("reviews").select("id").eq("booking_id", f.id);
    expect(rows.data?.length).toBe(1);
  });

  it("there is no way to edit or delete: the module has only GET and POST", () => {
    expect(Object.keys(reviewsModule).sort()).toEqual(["GET", "POST"]);
  });

  it("each party writes their own review of the booking", async () => {
    const f = await completedBooking();
    expect((await postReview(f.cust.b, f.id, { rating: 5 })).status).toBe(201);
    expect((await postReview(f.chef.b, f.id, { rating: 4 })).status).toBe(201);
    const rows = await svc
      .from("reviews")
      .select("author_role")
      .eq("booking_id", f.id);
    expect(rows.data?.map((r) => r.author_role).sort()).toEqual([
      "chef",
      "customer",
    ]);
  });
});

describe("access and validation", () => {
  it("anon 401, admin 403, a stranger 404 (also for an unknown id), for GET and POST", async () => {
    const f = await completedBooking();
    const admin = await newAdmin();
    const stranger = await bookingCustomer();
    const anon = new Browser();
    const unknown = "00000000-0000-4000-8000-000000000000";
    for (const call of [
      (b: Browser, id: string) => getReviews(b, id),
      (b: Browser, id: string) => postReview(b, id, { rating: 5 }),
    ]) {
      expect((await call(anon, f.id)).status).toBe(401);
      expect((await call(admin.b, f.id)).status).toBe(403);
      expect((await call(admin.b, unknown)).status).toBe(403);
      expect((await call(stranger.b, f.id)).status).toBe(404);
      expect((await call(f.cust.b, unknown)).status).toBe(404);
      expect((await call(f.cust.b, "not-a-uuid")).status).toBe(404);
    }
    const rows = await svc.from("reviews").select("id").eq("booking_id", f.id);
    expect(rows.data).toEqual([]);
  });

  it("a customer who is not a party cannot review (another customer's completed booking)", async () => {
    const f = await completedBooking();
    const other = await newCustomer("Nosy");
    const r = await postReview(other.b, f.id, { rating: 5 });
    expect(r.status).toBe(404);
  });

  it("content type is checked first (400), then the booking (404), then the body (422)", async () => {
    const f = await completedBooking();
    const noType = await postReview(
      f.cust.b,
      f.id,
      { rating: 5 },
      { contentType: "text/plain" },
    );
    expect(noType.status).toBe(400);
    const unknownBooking = await postReview(
      f.cust.b,
      "00000000-0000-4000-8000-000000000000",
      { rating: 99 },
    );
    expect(unknownBooking.status).toBe(404);
    const bad = await postReview(f.cust.b, f.id, { rating: 99 });
    expect(bad.status).toBe(422);
  });

  it("rating, comment and unknown keys are validated, all at once; nothing is written", async () => {
    const f = await completedBooking();
    for (const body of [
      { rating: 0 },
      { rating: 6 },
      { rating: 2.5 },
      { rating: "5" },
      {},
      { rating: 5, comment: "x".repeat(1001) },
      { rating: 5, comment: "bad\u0000text" },
      { rating: 5, comment: 12 },
    ]) {
      const r = await postReview(f.cust.b, f.id, body);
      expect(r.status, JSON.stringify(body)).toBe(422);
      expect(r.body.error.code).toBe("VALIDATION_FAILED");
    }
    const multi = await postReview(f.cust.b, f.id, {
      rating: 9,
      authorId: "x",
      subjectId: "y",
      comment: "x".repeat(1001),
    });
    expect(Object.keys(multi.body.error.fields).sort()).toEqual([
      "authorId",
      "comment",
      "rating",
      "subjectId",
    ]);
    const rows = await svc.from("reviews").select("id").eq("booking_id", f.id);
    expect(rows.data).toEqual([]);
    expect((await getBooking(f.cust.b, f.id)).body.status).toBe("completed");
  });

  it("a comment of exactly 1000 characters with line breaks is accepted", async () => {
    const f = await completedBooking();
    const comment = "a\n".repeat(499) + "ab";
    expect(comment.length).toBe(1000);
    const r = await postReview(f.cust.b, f.id, { rating: 5, comment });
    expect(r.status, r.text).toBe(201);
    expect(r.body.comment).toBe(comment);
  });
});

describe("GET /api/chefs/:id/reviews (public)", () => {
  it("is newest first, pages without gaps or repeats, and refuses bad queries", async () => {
    const f1 = await completedBooking();
    // One chef, three reviews: each customer needs a completed booking with this chef. Reuse the
    // chef's bookings by making further bookings is heavy; one chef per review is enough for paging
    // when the reviews are written by direct inserts for the same subject.
    const ids: string[] = [];
    const first = await postReview(f1.cust.b, f1.id, {
      rating: 5,
      comment: "one",
    });
    ids.push(first.body.id);
    for (let i = 0; i < 2; i++) {
      const ins = await svc
        .from("reviews")
        .insert({
          booking_id: f1.id,
          author_id: (await bookingCustomer()).id,
          subject_id: f1.chef.id,
          author_role: "customer",
          rating: 3 + i,
          comment: `extra ${i}`,
        })
        .select("id")
        .single();
      // The unique key is (booking, author), so a new author is allowed for the same booking.
      expect(ins.error).toBeNull();
      ids.push(ins.data?.id as string);
    }
    const anon = new Browser();
    const p1 = await publicReviews(anon, f1.chef.id, "limit=2");
    expect(p1.status, p1.text).toBe(200);
    expect(p1.body.items.length).toBe(2);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await publicReviews(
      anon,
      f1.chef.id,
      `limit=2&cursor=${p1.body.nextCursor}`,
    );
    expect(p2.body.items.length).toBe(1);
    expect(p2.body.nextCursor).toBeNull();
    const seen = [...p1.body.items, ...p2.body.items].map(
      (x: { id: string }) => x.id,
    );
    expect(new Set(seen).size).toBe(3);
    expect(seen.sort()).toEqual([...ids].sort());
    const times = [...p1.body.items, ...p2.body.items].map(
      (x: { createdAt: string }) => x.createdAt,
    );
    expect(times).toEqual([...times].sort().reverse());

    for (const qs of [
      "limit=0",
      "limit=51",
      "limit=x",
      "cursor=nope",
      "foo=1",
      "limit=1&limit=2",
    ]) {
      const bad = await publicReviews(anon, f1.chef.id, qs);
      expect(bad.status, qs).toBe(422);
    }
  });

  it("is 404 for an unknown chef, a customer id, and a chef the public cannot see", async () => {
    const f = await completedBooking();
    const anon = new Browser();
    expect(
      (await publicReviews(anon, "00000000-0000-4000-8000-000000000000"))
        .status,
    ).toBe(404);
    expect((await publicReviews(anon, "not-a-uuid")).status).toBe(404);
    expect((await publicReviews(anon, f.cust.id)).status).toBe(404);
    const up = await svc
      .from("chefs")
      .update({ status: "rejected" })
      .eq("profile_id", f.chef.id);
    expect(up.error).toBeNull();
    expect((await publicReviews(anon, f.chef.id)).status).toBe(404);
  });
});
