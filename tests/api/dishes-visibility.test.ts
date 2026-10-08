// T-032 / CLAUDE.md section 10: "pending or rejected chefs must never appear in search". Dishes
// and availability written through the routes stay invisible to anonymous visitors and customers
// until the chef is approved, and an approved chef shows only active dishes.
import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import {
  chefClient,
  newCustomer,
  newChef,
  setChef,
  svc,
  upload,
} from "./chef-helpers";
import {
  addDays,
  anonClient,
  createDish,
  dishPath,
  patchDish,
  putDays,
  today,
} from "./dish-helpers";

beforeEach(() => freshLimits());

type Db = ReturnType<typeof anonClient>;
async function seen(db: Db, chef: string) {
  const dishes = await db.from("dishes").select("id").eq("chef_id", chef);
  const days = await db.from("availability").select("day").eq("chef_id", chef);
  expect(dishes.error).toBeNull();
  expect(days.error).toBeNull();
  return { dishes: dishes.data?.length ?? 0, days: days.data?.length ?? 0 };
}

describe("dishes and availability follow the chef's status", () => {
  it("are hidden from anon and customers while pending and rejected, shown when approved", async () => {
    const chef = await newChef();
    const photo = dishPath(chef.id);
    await upload("dish-photos", photo);
    const active = await createDish(chef, { photoPath: photo });
    const hidden = await createDish(chef, { name: "off menu" });
    await chef.b.call(patchDish(hidden.id), {
      method: "PATCH",
      body: { isActive: false },
    });
    await putDays(chef, { add: [addDays(today(), 2), addDays(today(), 3)] });

    const customer = await newCustomer();
    const asCustomer = await chefClient(customer.email);
    const asChef = await chefClient(chef.email);
    const hide = { dishes: 0, days: 0 };

    // pending
    expect(await seen(anonClient(), chef.id)).toEqual(hide);
    expect(await seen(asCustomer, chef.id)).toEqual(hide);
    // the chef sees their own rows, including the inactive dish
    expect(await seen(asChef, chef.id)).toEqual({ dishes: 2, days: 2 });

    // rejected
    await setChef(chef.id, { status: "rejected" });
    expect(await seen(anonClient(), chef.id)).toEqual(hide);
    expect(await seen(asCustomer, chef.id)).toEqual(hide);

    // edits made while pending or rejected do not open anything up
    await putDays(chef, { add: [addDays(today(), 4)] });
    await createDish(chef, { name: "another" });
    expect(await seen(anonClient(), chef.id)).toEqual(hide);

    // control: approved shows active dishes and all availability, never the inactive dish
    await setChef(chef.id, { status: "approved" });
    for (const db of [anonClient(), asCustomer]) {
      const r = await seen(db, chef.id);
      expect(r).toEqual({ dishes: 2, days: 3 });
      const ids = (
        await db.from("dishes").select("id").eq("chef_id", chef.id)
      ).data!.map((d) => d.id);
      expect(ids).toContain(active.id);
      expect(ids).not.toContain(hidden.id);
    }

    // and back to hidden when an admin rejects an approved chef
    await setChef(chef.id, { status: "rejected" });
    expect(await seen(anonClient(), chef.id)).toEqual(hide);
    expect(
      (await svc.from("dishes").select("id").eq("chef_id", chef.id)).data,
    ).toHaveLength(3);
  });
});
