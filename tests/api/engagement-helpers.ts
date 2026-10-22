// Shared helpers for the T-048 route tests (reviews, reports, admin lists and decisions).
// LOCAL Supabase only. Bookings are made through the real routes; time is moved by editing rows.
import { expect } from "vitest";
import { GET as adminBookingsRoute } from "@/app/api/admin/bookings/route";
import { GET as adminMessagesRoute } from "@/app/api/admin/bookings/[id]/messages/route";
import { POST as resolveFlagRoute } from "@/app/api/admin/bookings/[id]/resolve-flag/route";
import { GET as adminBlocksRoute } from "@/app/api/admin/free-trial-blocks/route";
import { GET as adminReportsRoute } from "@/app/api/admin/reports/route";
import { POST as dismissRoute } from "@/app/api/admin/reports/[id]/dismiss/route";
import { POST as resolveRoute } from "@/app/api/admin/reports/[id]/resolve/route";
import { GET as adminReviewsRoute } from "@/app/api/admin/reviews/route";
import {
  GET as reportsGet,
  POST as reportsPost,
} from "@/app/api/bookings/[id]/reports/route";
import {
  GET as reviewsGet,
  POST as reviewsPost,
} from "@/app/api/bookings/[id]/reviews/route";
import { GET as chefReviewsRoute } from "@/app/api/chefs/[id]/reviews/route";
import { randomUUID } from "node:crypto";
import type { Browser, Reply } from "./harness";
import {
  accept,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCustomer,
  complete,
  cooked,
  day,
  shiftDays,
  svc,
  type TestChef,
  type TestCustomer,
} from "./booking-helpers";

export { svc };

const withId = (id: string) => ({ params: Promise.resolve({ id }) });
type Chef = { id: string; b: Browser };

export const getReviews = (b: Browser, id: string): Promise<Reply> =>
  b.call((r) => reviewsGet(r, withId(id)), { method: "GET" });
export const postReview = (
  b: Browser,
  id: string,
  body: unknown,
  extra: { contentType?: string | null } = {},
): Promise<Reply> =>
  b.call((r) => reviewsPost(r, withId(id)), { body, ...extra });
export const getReports = (b: Browser, id: string): Promise<Reply> =>
  b.call((r) => reportsGet(r, withId(id)), { method: "GET" });
export const postReport = (
  b: Browser,
  id: string,
  body: unknown,
  extra: { contentType?: string | null } = {},
): Promise<Reply> =>
  b.call((r) => reportsPost(r, withId(id)), { body, ...extra });
export const publicReviews = (
  b: Browser,
  chefId: string,
  qs = "",
): Promise<Reply> =>
  b.call(
    (r) =>
      chefReviewsRoute(
        new Request(`http://localhost/api/chefs/${chefId}/reviews?${qs}`, r),
        withId(chefId),
      ),
    { method: "GET" },
  );

const listWith =
  (route: (r: Request) => Promise<Response> | Response, path: string) =>
  (b: Browser, qs = ""): Promise<Reply> =>
    b.call((r) => route(new Request(`http://localhost${path}?${qs}`, r)), {
      method: "GET",
    });
export const adminBookings = listWith(
  adminBookingsRoute,
  "/api/admin/bookings",
);
export const adminReports = listWith(adminReportsRoute, "/api/admin/reports");
export const adminBlocks = listWith(
  adminBlocksRoute,
  "/api/admin/free-trial-blocks",
);
export const adminReviews = listWith(adminReviewsRoute, "/api/admin/reviews");
export const adminMessages = (
  b: Browser,
  id: string,
  qs = "",
): Promise<Reply> =>
  b.call(
    (r) =>
      adminMessagesRoute(
        new Request(
          `http://localhost/api/admin/bookings/${id}/messages?${qs}`,
          r,
        ),
        withId(id),
      ),
    { method: "GET" },
  );
export const resolveReport = (
  b: Browser,
  id: string,
  body: unknown,
  extra: { contentType?: string | null } = {},
): Promise<Reply> =>
  b.call((r) => resolveRoute(r, withId(id)), { body, ...extra });
export const dismissReport = (
  b: Browser,
  id: string,
  body: unknown,
): Promise<Reply> => b.call((r) => dismissRoute(r, withId(id)), { body });
export const resolveFlag = (
  b: Browser,
  id: string,
  body: unknown,
  extra: { contentType?: string | null } = {},
): Promise<Reply> =>
  b.call((r) => resolveFlagRoute(r, withId(id)), { body, ...extra });

export const newUuid = () => randomUUID();
export const reportBody = (over: Record<string, unknown> = {}) => ({
  clientId: newUuid(),
  category: "other",
  description: "Something went wrong at the visit.",
  ...over,
});

export interface Fixture {
  chef: TestChef;
  cust: TestCustomer;
  id: string;
}

/** A requested booking. `trial` asks for the free first booking. */
export async function requestedBooking(
  o: { trial?: boolean; offsets?: number[]; chef?: TestChef } = {},
): Promise<Fixture> {
  const chef =
    o.chef ?? (await bookableChef({ dishes: [{ key: "pho", shelf: 2 }] }));
  const cust = await bookingCustomer();
  const offsets = o.offsets ?? [3];
  const r = await bookOk(
    cust,
    bookingBody(chef, {
      days: offsets.map((n) => ({
        date: day(n),
        dishes: [{ dishId: chef.dishes.pho, quantity: 1 }],
      })),
      ...(o.trial ? { useFreeTrial: true } : {}),
    }),
  );
  return { chef, cust, id: r.id };
}

export async function acceptedBooking(
  o: { trial?: boolean; offsets?: number[]; chef?: TestChef } = {},
): Promise<Fixture> {
  const f = await requestedBooking(o);
  const a = await accept(f.chef.b, f.id);
  expect(a.status, a.text).toBe(200);
  return f;
}

/** An accepted booking whose visits are due and cooked, completed by the chef. */
export async function completedBooking(
  o: {
    trial?: boolean;
    offsets?: number[];
    chef?: TestChef;
    /** Days to move the visit back (default 3 = today); more puts it in the past. */
    shift?: number;
  } = {},
): Promise<Fixture> {
  const f = await acceptedBooking(o);
  await shiftDays(f.id, o.shift ?? 3);
  const c = await cooked(f.chef.b, f.id, 1);
  expect(c.status, c.text).toBe(200);
  const d = await complete(f.chef.b, f.id);
  expect(d.status, d.text).toBe(200);
  return f;
}

export async function setCompletedAt(id: string, at: Date) {
  const up = await svc
    .from("bookings")
    .update({ completed_at: at.toISOString() })
    .eq("id", id);
  expect(up.error).toBeNull();
}

/** Every key at every depth of a JSON value. */
export function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      allKeys(x, out);
    }
  return out;
}

export type { Chef, Reply };
