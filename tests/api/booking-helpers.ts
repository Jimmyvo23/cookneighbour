// Shared helpers for the booking route tests (T-042). LOCAL Supabase only.
// A chef is made through the real sign-up route and then set up the way an admin would (service
// role), like tests/api/search.test.ts. A customer goes through the real phone and address routes.
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { PUT as addressRoute } from "@/app/api/me/address/route";
import {
  GET as listRoute,
  POST as createRoute,
} from "@/app/api/bookings/route";
import { POST as estimateRoute } from "@/app/api/bookings/estimate/route";
import { GET as detailRoute } from "@/app/api/bookings/[id]/route";
import { POST as acceptRoute } from "@/app/api/bookings/[id]/accept/route";
import { POST as declineRoute } from "@/app/api/bookings/[id]/decline/route";
import { POST as cancelRoute } from "@/app/api/bookings/[id]/cancel/route";
import { POST as noShowRoute } from "@/app/api/bookings/[id]/no-show/route";
import { POST as completeRoute } from "@/app/api/bookings/[id]/complete/route";
import { POST as cookedRoute } from "@/app/api/bookings/[id]/days/[dayNumber]/cooked/route";
import { POST as proposeRoute } from "@/app/api/bookings/[id]/days/[dayNumber]/pickup/propose/route";
import { POST as respondRoute } from "@/app/api/bookings/[id]/days/[dayNumber]/pickup/respond/route";
import { POST as confirmRoute } from "@/app/api/bookings/[id]/days/[dayNumber]/pickup/confirm/route";
import { POST as missedRoute } from "@/app/api/bookings/[id]/pickup/missed/route";
import { GET as chefDetailRoute } from "@/app/api/chefs/[id]/route";
import { GET as searchRoute } from "@/app/api/chefs/route";
import { addDays, torontoToday } from "@/lib/domain/dishes";
import { rand, type Browser, type Reply } from "./harness";
import {
  newChef,
  newCustomer,
  phone as phoneRoute,
  setChef,
  setPriv,
  svc,
  uniquePhone,
  verify as verifyRoute,
  type Chef,
} from "./chef-helpers";
import { createDish, putDays } from "./dish-helpers";

export { addDays, svc, torontoToday };
export const today = () => torontoToday();
export const day = (n: number) => addDays(torontoToday(), n);

export interface TestChef extends Chef {
  dishes: Record<string, string>;
  /** Days (offsets from today) the chef ticked. */
  ticked: number[];
}

export interface ChefOpts {
  name?: string;
  options?: string[];
  homeEnabled?: boolean;
  /** D-59: leave the kitchen address empty although chef's home is on (default: an address is saved). */
  noKitchenAddress?: boolean;
  radius?: number;
  rate?: number;
  /** Cuisine of the chef (default: a random unique tag); a shared tag lets a search find several chefs. */
  cuisine?: string;
  prefix?: string;
  status?: "pending" | "approved" | "rejected";
  bio?: string | null;
  /** Days ahead (from today) to tick. Default 1 to 25. */
  ticked?: number[];
  dishes?: {
    key: string;
    name?: string;
    minutes?: number;
    cost?: number;
    allergens?: string[];
    shelf?: number;
    servings?: number;
  }[];
}

let n = 0;
export async function bookableChef(o: ChefOpts = {}): Promise<TestChef> {
  n += 1;
  const chef = await newChef(o.name ?? `Booking Chef ${n}`);
  await setChef(chef.id, {
    status: o.status ?? "approved",
    bio: o.bio === undefined ? "A friendly home cook." : o.bio,
    photo_path: `${chef.id}/photo-${randomUUID()}.png`,
    // A unique cuisine per chef keeps these many chefs out of other tests' searches
    // (search.test.ts filters on "vietnamese" and lists only the first page).
    cuisines: [o.cuisine ?? `Bk${rand(4)}`],
    languages: ["English"],
    hourly_rate_cents: o.rate ?? 3000,
    service_postal_prefix: o.prefix ?? "L5B",
    service_radius_km: o.radius ?? 20,
    location_options: o.options ?? ["customer_home"],
    chef_home_enabled: o.homeEnabled ?? false,
  });
  // D-59: a chef with chef's home on has a saved kitchen address, or accepting is refused.
  if (o.homeEnabled && !o.noKitchenAddress) {
    await setPriv(chef.id, {
      kitchen_address_line: "12 Fixture Lane",
      kitchen_city: "Mississauga",
      kitchen_postal_code: "L5B1A1",
    });
  }
  // The chef's phone number is shown to the customer once a booking is accepted.
  const ph = await svc
    .from("profile_private")
    .update({ phone_e164: uniquePhone() })
    .eq("profile_id", chef.id);
  expect(ph.error).toBeNull();
  const dishes: Record<string, string> = {};
  for (const d of o.dishes ?? [{ key: "pho" }]) {
    const made = await createDish(chef, {
      name: d.name ?? "Pho bo",
      cuisine: "Vietnamese",
      cookMinutes: d.minutes ?? 120,
      ingredientCostCents: d.cost ?? 0,
      allergens: d.allergens ?? [],
      shelfLifeDays: d.shelf ?? 2,
      servings: d.servings ?? 4,
    });
    dishes[d.key] = made.id;
  }
  const ticked = o.ticked ?? Array.from({ length: 25 }, (_, i) => i + 1);
  await putDays(chef, { add: ticked.map(day) });
  return { ...chef, dishes, ticked };
}

export interface TestCustomer extends Chef {
  phone: string;
  line: string;
}

/** A customer with a MOCK-verified phone and a home address, through the real routes. */
export async function bookingCustomer(
  o: { verified?: boolean; phone?: boolean; address?: boolean } = {},
): Promise<TestCustomer> {
  const c = await newCustomer("Booking Customer");
  const number = uniquePhone();
  const line = `${100 + Math.floor(Math.random() * 800)} Bk${rand(3)} Street`;
  if (o.phone !== false) {
    let r = await c.b.call(phoneRoute, { body: { phone: number } });
    expect(r.status, r.text).toBe(200);
    if (o.verified !== false) {
      r = await c.b.call(verifyRoute, { body: { code: "123456" } });
      expect(r.status, r.text).toBe(200);
    }
  }
  if (o.address !== false) {
    const r = await c.b.call(addressRoute, {
      method: "PUT",
      body: { line, city: "Mississauga", postalCode: "L5B 1A1" },
    });
    expect(r.status, r.text).toBe(200);
  }
  return { ...c, phone: number, line };
}

export const NONE = { noAllergies: true, noDietaryNeeds: true };

/**
 * The default visit day: at least 3 days ahead when the chef ticked one, so the 72 hour expiry
 * (not midnight tomorrow) applies and a slow CI run near midnight cannot expire a fresh request.
 */
const defaultOffset = (chef: TestChef) =>
  chef.ticked.find((t) => t >= 3) ?? chef.ticked[0] ?? 3;

/** A valid create body: one day at the customer's home, the chef's first dish. */
export function bookingBody(
  chef: TestChef,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    chefId: chef.id,
    locationType: "customer_home",
    address: {
      line: "100 Cooking Street",
      city: "Mississauga",
      postalCode: "L5B 1A1",
    },
    days: [
      {
        date: day(defaultOffset(chef)),
        dishes: [{ dishId: Object.values(chef.dishes)[0], quantity: 1 }],
      },
    ],
    groceryOption: "customer_buys",
    intake: NONE,
    ...over,
  };
}

export const book = (c: Chef, body: Record<string, unknown>): Promise<Reply> =>
  c.b.call(createRoute, { body });
export const estimate = (
  c: Chef,
  body: Record<string, unknown>,
): Promise<Reply> => c.b.call(estimateRoute, { body });

const withId = (id: string) => ({ params: Promise.resolve({ id }) });
export const getBooking = (b: Browser, id: string): Promise<Reply> =>
  b.call(
    (r) =>
      detailRoute(
        new Request(`http://localhost/api/bookings/${id}`, r),
        withId(id),
      ),
    { method: "GET" },
  );
export const listBookings = (b: Browser, qs = ""): Promise<Reply> =>
  b.call(
    (r) => listRoute(new Request(`http://localhost/api/bookings?${qs}`, r)),
    {
      method: "GET",
    },
  );
export const accept = (b: Browser, id: string): Promise<Reply> =>
  b.call((r) => acceptRoute(r, withId(id)));
export const decline = (
  b: Browser,
  id: string,
  body: unknown = { reason: "Sorry, I cannot take this booking." },
): Promise<Reply> => b.call((r) => declineRoute(r, withId(id)), { body });

// ---- T-063: booking changes ----
const withDay = (id: string, dayNumber: string) => ({
  params: Promise.resolve({ id, dayNumber }),
});
/** Pass as the body of `cancel` for a request with no body at all. */
export const NO_BODY = Symbol("no body");
export const cancel = (
  b: Browser,
  id: string,
  body: unknown = { reason: "My plans changed." },
): Promise<Reply> =>
  b.call(
    (r) => cancelRoute(r, withId(id)),
    body === NO_BODY ? { noBody: true } : { body },
  );
export const noShow = (b: Browser, id: string): Promise<Reply> =>
  b.call((r) => noShowRoute(r, withId(id)));
export const complete = (b: Browser, id: string): Promise<Reply> =>
  b.call((r) => completeRoute(r, withId(id)));
export const cooked = (
  b: Browser,
  id: string,
  dayNumber: string | number,
): Promise<Reply> =>
  b.call((r) => cookedRoute(r, withDay(id, String(dayNumber))));
export const propose = (
  b: Browser,
  id: string,
  dayNumber: string | number,
  body: unknown,
): Promise<Reply> =>
  b.call((r) => proposeRoute(r, withDay(id, String(dayNumber))), { body });
export const respond = (
  b: Browser,
  id: string,
  dayNumber: string | number,
  body: unknown,
): Promise<Reply> =>
  b.call((r) => respondRoute(r, withDay(id, String(dayNumber))), { body });
export const confirmPickup = (
  b: Browser,
  id: string,
  dayNumber: string | number,
): Promise<Reply> =>
  b.call((r) => confirmRoute(r, withDay(id, String(dayNumber))));
export const missed = (b: Browser, id: string): Promise<Reply> =>
  b.call((r) => missedRoute(r, withId(id)));

/**
 * Moves every visit date of a booking `n` days into the past, as if time had passed. The test
 * chef is new, so no other booking holds those dates. (There is no clock to move in the tests.)
 */
export async function shiftDays(id: string, n: number) {
  const days = await svc
    .from("booking_days")
    .select("id, visit_date")
    .eq("booking_id", id);
  expect(days.error).toBeNull();
  for (const d of days.data ?? []) {
    const up = await svc
      .from("booking_days")
      .update({ visit_date: addDays(d.visit_date as string, -n) })
      .eq("id", d.id);
    expect(up.error).toBeNull();
  }
}
/** Sets the eat-by date of every meal of a booking (offset from today). */
export async function setEatBy(id: string, offset: number) {
  const days = await svc.from("booking_days").select("id").eq("booking_id", id);
  expect(days.error).toBeNull();
  const up = await svc
    .from("booking_day_dishes")
    .update({ eat_by_date: day(offset) })
    .in(
      "booking_day_id",
      (days.data ?? []).map((d) => d.id as string),
    );
  expect(up.error).toBeNull();
}
export async function activeDates(id: string): Promise<string[]> {
  const { data, error } = await svc
    .from("booking_days")
    .select("visit_date, is_active")
    .eq("booking_id", id)
    .eq("is_active", true);
  expect(error).toBeNull();
  return (data ?? []).map((d) => d.visit_date as string).sort();
}

export const publicDetail = (b: Browser, id: string): Promise<Reply> =>
  b.call(
    (r) =>
      chefDetailRoute(
        new Request(`http://localhost/api/chefs/${id}`, r),
        withId(id),
      ),
    { method: "GET" },
  );
export const publicSearch = (b: Browser, qs: string): Promise<Reply> =>
  b.call(
    (r) => searchRoute(new Request(`http://localhost/api/chefs?${qs}`, r)),
    {
      method: "GET",
    },
  );

/** Books and expects 201. */
export async function bookOk(
  c: Chef,
  body: Record<string, unknown>,
): Promise<Reply & { id: string }> {
  const r = await book(c, body);
  expect(r.status, r.text).toBe(201);
  return Object.assign(r, { id: r.body.id as string });
}

export async function bookingRow(id: string) {
  const { data, error } = await svc
    .from("bookings")
    .select("*")
    .eq("id", id)
    .single();
  expect(error).toBeNull();
  return data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
export async function claimOf(id: string) {
  const { data, error } = await svc
    .from("free_trial_claims")
    .select("state, customer_id")
    .eq("booking_id", id)
    .maybeSingle();
  expect(error).toBeNull();
  return data as { state: string; customer_id: string } | null;
}
export async function bookingCount(customerId: string) {
  const { data, error } = await svc
    .from("bookings")
    .select("id")
    .eq("customer_id", customerId);
  expect(error).toBeNull();
  return (data ?? []).length;
}
export async function notesFor(userId: string, type?: string) {
  let q = svc
    .from("notifications")
    .select("type, title, body, booking_id")
    .eq("user_id", userId);
  if (type) q = q.eq("type", type);
  const { data, error } = await q.order("created_at");
  expect(error).toBeNull();
  return (data ?? []) as {
    type: string;
    title: string;
    body: string | null;
    booking_id: string | null;
  }[];
}
/** Forces a request to be stale, as if its expiry time had passed. */
export async function makeStale(id: string) {
  const { error } = await svc
    .from("bookings")
    .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", id);
  expect(error).toBeNull();
}
export { setChef, type Chef };
