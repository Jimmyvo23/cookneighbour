// Server side of the review routes (T-048, contract section 7D).
//
// Authorization (contract section 2): the role comes from profiles.role (requireBookingParty:
// customers and chefs only; the admin reads reviews through GET /api/admin/reviews). The booking is
// matched against the caller's OWN rows. Reads and the insert use the caller's user-scoped client,
// so row-level security is a second line of defence: the select policies decide who reads what (a
// chef's review of a customer is visible to that customer and the admin only), and the insert policy
// repeats "completed booking, inside the window, as myself, about the other party".
// A posted review is final: there is no update or delete anywhere.
// Retry (T-075): the unique key (booking, author) is the guard; the same content again returns the
// first review.
import "server-only";
import { ApiFailure, validationFailed } from "@/lib/api/errors";
import type {
  BookingReviews,
  PublicReview,
  PublicReviewList,
  ReviewView,
} from "@/lib/api/types";
import { isUuid } from "@/lib/domain/admin-chefs";
import {
  REVIEW_REFUSALS,
  firstNameOf,
  parseReviewBody,
  reviewAllowance,
} from "@/lib/domain/reviews";
import { encodeListCursor } from "@/lib/server/booking-views";
import type { BookingCaller } from "@/lib/server/bookings";
import { loadPartyBooking } from "@/lib/server/booking-party";
import { parseListParams } from "@/lib/server/paging";
import { getChefDetail } from "@/lib/server/search";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

const COLS =
  "id, booking_id, author_id, subject_id, author_role, author_display_name, rating, comment, created_at";

function view(r: Row, userId: string): ReviewView {
  return {
    id: r.id as string,
    bookingId: r.booking_id as string,
    authorRole: r.author_role as ReviewView["authorRole"],
    authorDisplayName: r.author_display_name as string,
    rating: r.rating as number,
    comment: (r.comment as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
    mine: r.author_id === userId,
  };
}

const refusal = (reason: keyof typeof REVIEW_REFUSALS) =>
  new ApiFailure("INVALID_STATE", REVIEW_REFUSALS[reason], { reason });

/** The two reviews of a booking the caller may read (their own and the one about them). */
async function readPair(caller: BookingCaller, bookingId: string) {
  const r = await caller.supabase
    .from("reviews")
    .select(COLS)
    .eq("booking_id", bookingId)
    .or(`author_id.eq.${caller.userId},subject_id.eq.${caller.userId}`);
  if (r.error) throw new Error("reviews read failed");
  const rows = (r.data ?? []) as Row[];
  const mine = rows.find((x) => x.author_id === caller.userId);
  const other = rows.find((x) => x.subject_id === caller.userId);
  return {
    mine: mine ? view(mine, caller.userId) : null,
    other: other ? view(other, caller.userId) : null,
  };
}

// GET /api/bookings/:id/reviews
export async function getBookingReviews(
  caller: BookingCaller,
  id: string,
): Promise<BookingReviews> {
  const b = await loadPartyBooking(caller, id);
  const { mine, other } = await readPair(caller, b.id);
  return {
    bookingId: b.id,
    allowance: reviewAllowance({
      status: b.status,
      completedAt: b.completedAt,
      now: new Date(),
      alreadyReviewed: mine !== null,
    }),
    mine,
    other,
  };
}

// POST /api/bookings/:id/reviews
export async function createReview(
  caller: BookingCaller,
  id: string,
  readBody: () => Promise<Record<string, unknown>>,
): Promise<{ review: ReviewView; duplicate: boolean }> {
  const b = await loadPartyBooking(caller, id);
  const parsed = parseReviewBody(await readBody());
  if (!parsed.ok) throw validationFailed(parsed.fields);

  // A review the caller already wrote: the same content is a retry (200), anything else is final.
  const same = (m: ReviewView) =>
    m.rating === parsed.rating && m.comment === parsed.comment;
  const existing = (await readPair(caller, b.id)).mine;
  if (existing) {
    if (same(existing)) return { review: existing, duplicate: true };
    throw refusal("already_reviewed");
  }
  const allowance = reviewAllowance({
    status: b.status,
    completedAt: b.completedAt,
    now: new Date(),
  });
  if (!allowance.allowed && allowance.reason) throw refusal(allowance.reason);

  const ins = await caller.supabase
    .from("reviews")
    .insert({
      booking_id: b.id,
      author_id: caller.userId,
      subject_id: b.otherId,
      author_role: caller.role,
      rating: parsed.rating,
      comment: parsed.comment,
    })
    .select(COLS)
    .single();
  if (ins.error) {
    if (ins.error.code === "23505") {
      // Lost a race with our own retry: judge the stored review the same way.
      const now = (await readPair(caller, b.id)).mine;
      if (now && same(now)) return { review: now, duplicate: true };
      throw refusal("already_reviewed");
    }
    // The policy refused although the route allowed it: the window closed in between.
    if (ins.error.code === "42501") throw refusal("window_closed");
    throw new Error(`review insert failed: ${ins.error.code}`);
  }
  return { review: view(ins.data as Row, caller.userId), duplicate: false };
}

// GET /api/chefs/:id/reviews (public). Same 404 as the chef page for every hidden chef.
export async function listPublicReviews(
  id: string,
  params: URLSearchParams,
): Promise<PublicReviewList> {
  const notFound = () => new ApiFailure("NOT_FOUND", "Chef not found.");
  if (!isUuid(id)) throw notFound();
  const q = parseListParams(params);
  await getChefDetail(id); // throws the identical 404 for a chef the public must not see
  const db = await createClient();
  let req = db
    .from("reviews")
    .select("id, author_display_name, rating, comment, created_at")
    .eq("subject_id", id)
    .eq("author_role", "customer");
  if (q.cursor)
    req = req.or(
      `created_at.lt."${q.cursor.c}",and(created_at.eq."${q.cursor.c}",id.lt.${q.cursor.i})`,
    );
  const res = await req
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1);
  if (res.error) throw new Error("public reviews read failed");
  const rows = (res.data ?? []) as Row[];
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r): PublicReview => ({
      id: r.id as string,
      authorFirstName: firstNameOf(r.author_display_name as string),
      rating: r.rating as number,
      comment: (r.comment as string | null) ?? null,
      createdAt: new Date(r.created_at as string).toISOString(),
    })),
    nextCursor:
      rows.length > q.limit && last
        ? encodeListCursor(last.created_at as string, last.id as string)
        : null,
  };
}
