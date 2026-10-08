// Shared helpers for the dish and availability route tests (T-032). LOCAL Supabase only.
import { expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  GET as listDishesRoute,
  POST as createDishRoute,
} from "@/app/api/chef/dishes/route";
import { PATCH as patchDishRoute } from "@/app/api/chef/dishes/[id]/route";
import {
  GET as getAvailabilityRoute,
  PUT as putAvailabilityRoute,
} from "@/app/api/chef/availability/route";
import { addDays, torontoToday } from "@/lib/domain/dishes";
import { uuid, type Chef } from "./chef-helpers";

export { listDishesRoute, createDishRoute, getAvailabilityRoute };
export const putAvailability = putAvailabilityRoute;
export const today = () => torontoToday();
export { addDays };

export const patchDish = (id: string) => (request: Request) =>
  patchDishRoute(request, { params: Promise.resolve({ id }) });

export const dishPath = (chef: string, ext = "png") =>
  `${chef}/dish-${uuid()}.${ext}`;

export const validDish = {
  name: "Pho bo",
  cuisine: "Vietnamese",
  cookMinutes: 180,
};

export function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function createDish(
  chef: Chef,
  body: Record<string, unknown> = {},
) {
  const r = await chef.b.call(createDishRoute, {
    body: { ...validDish, ...body },
  });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string } & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function putDays(
  chef: Chef,
  body: { add?: string[]; remove?: string[] },
) {
  const r = await chef.b.call(putAvailabilityRoute, {
    method: "PUT",
    body,
  });
  expect(r.status, r.text).toBe(200);
  return r.body as { days: string[]; today: string; lastBookableDay: string };
}
