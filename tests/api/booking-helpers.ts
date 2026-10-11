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
import { GET as chefDetailRoute } from "@/app/api/chefs/[id]/route";
import { GET as searchRoute } from "@/app/api/chefs/route";
import { addDays, torontoToday } from "@/lib/domain/dishes";
import { rand, type Browser, type Reply } from "./harness";
import {
  newChef,
  newCustomer,
  phone as phoneRoute,
  setChef,
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
  radius?: number;
  rate?: number;
  /** Cuisine of the chef; a unique tag lets a search find only the chefs of one test. */
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
    cuisines: [o.cuisine ?? "Vietnamese"],
    languages: ["English"],
    hourly_rate_cents: o.rate ?? 3000,
    service_postal_prefix: o.prefix ?? "L5B",
    service_radius_km: o.radius ?? 20,
    location_options: o.options ?? ["customer_home"],
    chef_home_enabled: o.homeEnabled ?? false,
  });
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
        date: day(chef.ticked[0] ?? 1),
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
  body: unknown = {},
): Promise<Reply> => b.call((r) => declineRoute(r, withId(id)), { body });

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
