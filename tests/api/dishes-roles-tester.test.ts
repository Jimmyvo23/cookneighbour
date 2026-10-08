// T-032 tester additions. LOCAL Supabase only.
// 1. A JWT/metadata role claim is ignored on the dish and availability routes (T-028 rule).
// 2. Clearing a date that Postgres cannot store (year 0000) must be a 422, never a 500.
import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import {
  Browser,
  PASSWORD,
  login,
  newChef,
  newCustomer,
  svc,
  type Chef,
} from "./chef-helpers";
import {
  addDays,
  createDishRoute,
  getAvailabilityRoute,
  listDishesRoute,
  patchDish,
  putAvailability,
  today,
  validDish,
} from "./dish-helpers";

beforeEach(() => freshLimits());

async function withClaims(who: Chef, role: string): Promise<Browser> {
  const upd = await svc.auth.admin.updateUserById(who.id, {
    user_metadata: { role, display_name: "Sneaky" },
    app_metadata: { role },
  });
  expect(upd.error).toBeNull();
  const b = new Browser();
  const res = await b.call(login, {
    body: { email: who.email, password: PASSWORD },
  });
  expect(res.status, res.text).toBe(200);
  return b;
}

describe("metadata role claims on the dish and availability routes", () => {
  it("a customer claiming chef or admin in metadata is 403 on all five handlers and writes nothing", async () => {
    for (const role of ["chef", "admin"]) {
      const who = await newCustomer();
      const b = await withClaims(who, role);
      const id = "00000000-0000-4000-8000-000000000000";
      const calls: [string, () => Promise<{ status: number }>][] = [
        ["GET dishes", () => b.call(listDishesRoute, { method: "GET" })],
        [
          "POST dishes",
          () => b.call(createDishRoute, { method: "POST", body: validDish }),
        ],
        [
          "PATCH dish",
          () => b.call(patchDish(id), { method: "PATCH", body: { name: "x" } }),
        ],
        [
          "GET availability",
          () => b.call(getAvailabilityRoute, { method: "GET" }),
        ],
        [
          "PUT availability",
          () =>
            b.call(putAvailability, {
              method: "PUT",
              body: { add: [addDays(today(), 3)] },
            }),
        ],
      ];
      for (const [name, run] of calls)
        expect((await run()).status, `${role} ${name}`).toBe(403);
      const d = await svc.from("dishes").select("id").eq("chef_id", who.id);
      const a = await svc
        .from("availability")
        .select("day")
        .eq("chef_id", who.id);
      expect(d.data).toEqual([]);
      expect(a.data).toEqual([]);
    }
  });

  it("a chef claiming admin in metadata still works as a chef", async () => {
    const who = await newChef("Chef Meta Dish");
    const b = await withClaims(who, "admin");
    const r = await b.call(createDishRoute, {
      method: "POST",
      body: validDish,
    });
    expect(r.status, r.text).toBe(201);
  });
});

describe("dates Postgres cannot store", () => {
  it("remove of 0000-01-01 is a 422 validation error, not a 500", async () => {
    const chef = await newChef();
    for (const bad of ["0000-01-01", "0000-12-31"]) {
      const r = await chef.b.call(putAvailability, {
        method: "PUT",
        body: { remove: [bad] },
      });
      expect(r.status, `${bad}: ${r.text}`).toBe(422);
    }
  });
});
