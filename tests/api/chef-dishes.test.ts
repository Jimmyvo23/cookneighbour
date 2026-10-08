// T-032: dish routes (contract section 5A). Runs against the LOCAL Supabase.
import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import {
  Browser,
  application,
  chefClient,
  newAdmin,
  newChef,
  newCustomer,
  svc,
  upload,
} from "./chef-helpers";
import {
  anonClient,
  createDish,
  createDishRoute,
  dishPath,
  listDishesRoute,
  patchDish,
  validDish,
} from "./dish-helpers";

beforeEach(() => freshLimits());

const get = (b: Browser) => b.call(listDishesRoute, { method: "GET" });
const patch = (b: Browser, id: string, body: unknown) =>
  b.call(patchDish(id), { method: "PATCH", body });
const dishRow = async (id: string) => {
  const { data, error } = await svc
    .from("dishes")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  expect(error).toBeNull();
  return data as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const dishCount = async (chef: string) =>
  (
    await svc
      .from("dishes")
      .select("id", { count: "exact", head: true })
      .eq("chef_id", chef)
  ).count;

describe("who may call the dish routes", () => {
  it("anonymous is 401, a customer and an admin are 403, and nothing is written", async () => {
    const owner = await newChef();
    const dish = await createDish(owner);
    const customer = await newCustomer();
    const admin = await newAdmin();
    const anon = new Browser();
    const calls = (b: Browser) => [
      get(b),
      b.call(createDishRoute, { body: validDish }),
      patch(b, dish.id, { name: "hijacked" }),
    ];
    for (const r of await Promise.all(calls(anon)))
      expect(r.status, r.text).toBe(401);
    for (const who of [customer, admin])
      for (const r of await Promise.all(calls(who.b)))
        expect(r.status, r.text).toBe(403);
    expect((await dishRow(dish.id))?.name).toBe("Pho bo");
    expect(await dishCount(customer.id)).toBe(0);
    expect(await dishCount(admin.id)).toBe(0);
    // a customer must not get chef rows just by calling a chef route
    const c = await svc
      .from("chefs")
      .select("profile_id")
      .eq("profile_id", customer.id);
    expect(c.data ?? []).toEqual([]);
  });

  it("rejects a wrong content type and broken JSON with 400", async () => {
    const chef = await newChef();
    const dish = await createDish(chef);
    for (const opts of [
      { contentType: "text/plain" },
      { contentType: null },
      { raw: "{nope" },
    ]) {
      const r = await chef.b.call(createDishRoute, {
        body: validDish,
        ...opts,
      });
      expect(r.status, JSON.stringify(opts)).toBe(400);
      const p = await chef.b.call(patchDish(dish.id), {
        method: "PATCH",
        body: { name: "x" },
        ...opts,
      });
      expect(p.status, JSON.stringify(opts)).toBe(400);
    }
    expect(await dishCount(chef.id)).toBe(1);
  });
});

describe("POST /api/chef/dishes", () => {
  it("creates an active dish for the caller with the documented defaults", async () => {
    const chef = await newChef();
    const r = await chef.b.call(createDishRoute, { body: validDish });
    expect(r.status, r.text).toBe(201);
    expect(r.body).toMatchObject({
      name: "Pho bo",
      cuisine: "Vietnamese",
      cookMinutes: 180,
      photoPath: null,
      description: null,
      ingredientCostCents: 0,
      servings: 1,
      allergens: [],
      shelfLifeDays: 2,
      isActive: true,
      currency: "CAD",
    });
    expect(typeof r.body.createdAt).toBe("string");
    const row = await dishRow(r.body.id);
    expect(row?.chef_id).toBe(chef.id);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("stores every field, normalising allergens and trimming text", async () => {
    const chef = await newChef();
    const photo = dishPath(chef.id, "webp");
    await upload("dish-photos", photo);
    const r = await chef.b.call(createDishRoute, {
      body: {
        name: "  Bun cha  ",
        cuisine: " Vietnamese ",
        cookMinutes: 90,
        photoPath: photo,
        description: "Grilled pork\nwith noodles",
        ingredientCostCents: 1850,
        servings: 4,
        allergens: [" Fish ", "SOY", "soy"],
        shelfLifeDays: 3,
      },
    });
    expect(r.status, r.text).toBe(201);
    expect(r.body).toMatchObject({
      name: "Bun cha",
      cuisine: "Vietnamese",
      photoPath: photo,
      description: "Grilled pork\nwith noodles",
      ingredientCostCents: 1850,
      servings: 4,
      allergens: ["fish", "soy"],
      shelfLifeDays: 3,
    });
  });

  it("ignores no client-supplied identity: id, chefId, isActive, currency and unknown keys are 422", async () => {
    const chef = await newChef();
    const other = await newChef();
    for (const extra of [
      { chefId: other.id },
      { chef_id: other.id },
      { id: "11111111-1111-4111-8111-111111111111" },
      { isActive: false },
      { currency: "USD" },
      { createdAt: "2020-01-01" },
      { rating: 5 },
    ]) {
      const r = await chef.b.call(createDishRoute, {
        body: { ...validDish, ...extra },
      });
      expect(r.status, JSON.stringify(extra)).toBe(422);
      expect(r.body.error.code).toBe("VALIDATION_FAILED");
    }
    expect(await dishCount(chef.id)).toBe(0);
    expect(await dishCount(other.id)).toBe(0);
  });

  it("reports every field error at once and saves nothing", async () => {
    const chef = await newChef();
    const r = await chef.b.call(createDishRoute, {
      body: {
        name: "",
        cuisine: 5,
        cookMinutes: 4,
        ingredientCostCents: -1,
        servings: 0,
        allergens: "soy",
        shelfLifeDays: 8,
        description: "x".repeat(1001),
      },
    });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.error.fields).sort()).toEqual([
      "allergens",
      "cookMinutes",
      "cuisine",
      "description",
      "ingredientCostCents",
      "name",
      "servings",
      "shelfLifeDays",
    ]);
    expect(await dishCount(chef.id)).toBe(0);
  });

  it("accepts the bounds and refuses one past them", async () => {
    const chef = await newChef();
    const ok = await chef.b.call(createDishRoute, {
      body: {
        ...validDish,
        name: "x".repeat(120),
        cookMinutes: 360,
        ingredientCostCents: 50000,
        servings: 50,
        shelfLifeDays: 7,
        allergens: Array.from({ length: 14 }, (_, i) => `a${i}`),
      },
    });
    expect(ok.status, ok.text).toBe(201);
    for (const bad of [
      { cookMinutes: 361 },
      { cookMinutes: 4 },
      { ingredientCostCents: 50001 },
      { servings: 51 },
      { shelfLifeDays: 8 },
      { name: "x".repeat(121) },
      { allergens: Array.from({ length: 15 }, (_, i) => `a${i}`) },
    ]) {
      const r = await chef.b.call(createDishRoute, {
        body: { ...validDish, ...bad },
      });
      expect(r.status, JSON.stringify(bad)).toBe(422);
    }
  });

  it("answers 422 (never 500) for NUL, control characters and lone surrogates", async () => {
    const chef = await newChef();
    for (const bad of ["a\u0000b", "a\u0007b", "a\ud800b"]) {
      for (const key of ["name", "cuisine", "description", "allergens"]) {
        const r = await chef.b.call(createDishRoute, {
          body: { ...validDish, [key]: key === "allergens" ? [bad] : bad },
        });
        expect(r.status, `${key} ${JSON.stringify(bad)}`).toBe(422);
        expect(r.body.error.fields[key]).toBeTruthy();
      }
    }
    expect(await dishCount(chef.id)).toBe(0);
  });

  it("works for a pending chef (the sample dish is part of the application)", async () => {
    const chef = await newChef();
    const before = await application(chef.b);
    expect(before.status).toBe("pending");
    expect(before.missing).toContain("sampleDish");
    const photo = dishPath(chef.id);
    await upload("dish-photos", photo);
    await createDish(chef, { photoPath: photo });
    expect((await application(chef.b)).missing).not.toContain("sampleDish");
  });
});

describe("dish photo path", () => {
  it("accepts a photo the chef uploaded to dish-photos with their own session", async () => {
    const chef = await newChef();
    const photo = dishPath(chef.id, "jpg");
    const client = await chefClient(chef.email);
    // a chef account may upload to its own dish-photos folder (storage RLS)
    const up = await client.storage
      .from("dish-photos")
      .upload(
        photo,
        new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }),
        {
          contentType: "image/jpeg",
          upsert: false,
        },
      );
    expect(up.error).toBeNull();
    const d = await createDish(chef, { photoPath: photo });
    expect(d.photoPath).toBe(photo);
  });

  it("is 422 when the object was never uploaded, or sits in another bucket", async () => {
    const chef = await newChef();
    const missing = dishPath(chef.id);
    let r = await chef.b.call(createDishRoute, {
      body: { ...validDish, photoPath: missing },
    });
    expect(r.status, r.text).toBe(422);
    expect(r.body.error.fields.photoPath).toBeTruthy();
    const wrongBucket = dishPath(chef.id);
    await upload("profile-photos", wrongBucket);
    r = await chef.b.call(createDishRoute, {
      body: { ...validDish, photoPath: wrongBucket },
    });
    expect(r.status, r.text).toBe(422);
    expect(await dishCount(chef.id)).toBe(0);
  });

  it("is 422 for a malformed name, traversal, wrong prefix, upper case and a non-string", async () => {
    const chef = await newChef();
    const id = chef.id;
    const u = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    for (const p of [
      `${id}/photo-${u}.png`,
      `${id}/dish-${u}.pdf`,
      `${id}/dish-${u}.PNG`,
      `${id}/dish-x.png`,
      `${id}/../${id}/dish-${u}.png`,
      `${id}/dish-${u}.png\u0000`,
      `${id}\\dish-${u}.png`,
      `/${id}/dish-${u}.png`,
      "x".repeat(201),
      5,
      "",
    ]) {
      const r = await chef.b.call(createDishRoute, {
        body: { ...validDish, photoPath: p },
      });
      expect(r.status, JSON.stringify(p)).toBe(422);
    }
    expect(await dishCount(chef.id)).toBe(0);
  });

  it("is 403 for another chef's folder, and the answer does not depend on the file existing", async () => {
    const a = await newChef();
    const b = await newChef();
    const existing = dishPath(b.id);
    await upload("dish-photos", existing);
    const missing = dishPath(b.id);
    for (const p of [existing, missing]) {
      const r = await a.b.call(createDishRoute, {
        body: { ...validDish, photoPath: p },
      });
      expect(r.status, p).toBe(403);
    }
    expect(await dishCount(a.id)).toBe(0);
  });
});

describe("GET /api/chef/dishes", () => {
  it("lists only the caller's dishes, active and inactive, newest first", async () => {
    const a = await newChef();
    const b = await newChef();
    const first = await createDish(a, { name: "first" });
    const second = await createDish(a, { name: "second" });
    await createDish(b, { name: "not mine" });
    await patch(a.b, first.id, { isActive: false });
    const r = await get(a.b);
    expect(r.status, r.text).toBe(200);
    expect(r.body.items.map((d: { id: string }) => d.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(r.body.items[1].isActive).toBe(false);
    expect(JSON.stringify(r.body)).not.toContain(b.id);
  });
  it("is an empty list for a chef with no dishes", async () => {
    const chef = await newChef();
    const r = await get(chef.b);
    expect(r.body).toEqual({ items: [] });
  });
});

describe("PATCH /api/chef/dishes/:id", () => {
  it("edits only the fields sent and keeps the rest", async () => {
    const chef = await newChef();
    const d = await createDish(chef, {
      description: "keep me",
      servings: 3,
      allergens: ["soy"],
    });
    const r = await patch(chef.b, d.id, {
      name: " New name ",
      cookMinutes: 45,
      allergens: ["Peanuts", "peanuts"],
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({
      id: d.id,
      name: "New name",
      cookMinutes: 45,
      allergens: ["peanuts"],
      description: "keep me",
      servings: 3,
      cuisine: "Vietnamese",
    });
    expect(new Date(r.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(d.updatedAt).getTime(),
    );
  });

  it("{} is a no-op that returns the dish; null clears description and photo", async () => {
    const chef = await newChef();
    const photo = dishPath(chef.id);
    await upload("dish-photos", photo);
    const d = await createDish(chef, { description: "x", photoPath: photo });
    const noop = await patch(chef.b, d.id, {});
    expect(noop.status, noop.text).toBe(200);
    expect(noop.body).toEqual(d);
    const r = await patch(chef.b, d.id, { description: null, photoPath: null });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ description: null, photoPath: null });
  });

  it("replaces the photo with a new uploaded one and skips the probe for the stored one", async () => {
    const chef = await newChef();
    const p1 = dishPath(chef.id);
    await upload("dish-photos", p1);
    const d = await createDish(chef, { photoPath: p1 });
    // the stored path again: no storage call needed even if the object were gone
    await svc.storage.from("dish-photos").remove([p1]);
    const same = await patch(chef.b, d.id, { photoPath: p1, name: "same" });
    expect(same.status, same.text).toBe(200);
    const p2 = dishPath(chef.id);
    const missing = await patch(chef.b, d.id, { photoPath: p2 });
    expect(missing.status).toBe(422);
    await upload("dish-photos", p2);
    const ok = await patch(chef.b, d.id, { photoPath: p2 });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.photoPath).toBe(p2);
  });

  it("rejects a photo in another chef's folder with 403 and changes nothing", async () => {
    const a = await newChef();
    const b = await newChef();
    const d = await createDish(a);
    const theirs = dishPath(b.id);
    await upload("dish-photos", theirs);
    const r = await patch(a.b, d.id, { photoPath: theirs, name: "changed" });
    expect(r.status, r.text).toBe(403);
    const row = await dishRow(d.id);
    expect(row?.photo_path).toBeNull();
    expect(row?.name).toBe("Pho bo");
  });

  it("saves nothing when any field is invalid", async () => {
    const chef = await newChef();
    const d = await createDish(chef);
    const r = await patch(chef.b, d.id, { name: "fine", cookMinutes: 1 });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.error.fields)).toEqual(["cookMinutes"]);
    expect((await dishRow(d.id))?.name).toBe("Pho bo");
  });

  it("is 422 for fields a chef may not set (mass assignment) and the dish is unchanged", async () => {
    const chef = await newChef();
    const other = await newChef();
    const d = await createDish(chef);
    for (const extra of [
      { chefId: other.id },
      { chef_id: other.id },
      { id: "11111111-1111-4111-8111-111111111111" },
      { currency: "USD" },
      { updatedAt: "2020-01-01T00:00:00Z" },
    ]) {
      const r = await patch(chef.b, d.id, { name: "mass", ...extra });
      expect(r.status, JSON.stringify(extra)).toBe(422);
    }
    const row = await dishRow(d.id);
    expect(row?.chef_id).toBe(chef.id);
    expect(row?.name).toBe("Pho bo");
    expect(row?.currency).toBe("CAD");
  });

  it("is 404 for another chef's dish, an unknown id and a malformed id; nothing changes", async () => {
    const a = await newChef();
    const b = await newChef();
    const d = await createDish(b, { name: "b's dish" });
    const unknown = "11111111-1111-4111-8111-111111111111";
    for (const id of [
      d.id,
      unknown,
      "not-a-uuid",
      "1' or '1'='1",
      d.id.toUpperCase(),
    ]) {
      const r = await patch(a.b, id, { name: "stolen", isActive: false });
      expect(r.status, id).toBe(404);
      expect(r.body.error.code).toBe("NOT_FOUND");
    }
    const row = await dishRow(d.id);
    expect(row).toMatchObject({
      name: "b's dish",
      is_active: true,
      chef_id: b.id,
    });
    // the owner is unaffected and gets the same 404 only for ids that are not theirs
    expect((await patch(b.b, d.id, { name: "mine" })).status).toBe(200);
  });

  it("does not leak whether a foreign dish exists: same 404 body as a missing one", async () => {
    const a = await newChef();
    const b = await newChef();
    const d = await createDish(b);
    const foreign = await patch(a.b, d.id, { name: "x" });
    const missing = await patch(a.b, "11111111-1111-4111-8111-111111111111", {
      name: "x",
    });
    expect(foreign.status).toBe(missing.status);
    expect(foreign.body).toEqual(missing.body);
  });
});

describe("deactivate and reactivate", () => {
  it("a deactivated dish leaves the public menu but stays in the chef's list and in the database", async () => {
    const chef = await newChef();
    await svc
      .from("chefs")
      .update({ status: "approved" })
      .eq("profile_id", chef.id);
    const d = await createDish(chef);
    const publicIds = async () =>
      (
        (await anonClient().from("dishes").select("id").eq("chef_id", chef.id))
          .data ?? []
      ).map((r) => r.id);
    expect(await publicIds()).toEqual([d.id]);
    const off = await patch(chef.b, d.id, { isActive: false });
    expect(off.status, off.text).toBe(200);
    expect(off.body.isActive).toBe(false);
    expect(await publicIds()).toEqual([]);
    expect((await get(chef.b)).body.items).toHaveLength(1);
    expect(await dishRow(d.id)).not.toBeNull();
    const again = await patch(chef.b, d.id, { isActive: false });
    expect(again.status).toBe(200); // idempotent
    const on = await patch(chef.b, d.id, { isActive: true });
    expect(on.body.isActive).toBe(true);
    expect(await publicIds()).toEqual([d.id]);
    expect((await patch(chef.b, d.id, { isActive: "no" })).status).toBe(422);
  });

  it("deactivating the only photo dish brings sampleDish back into missing", async () => {
    const chef = await newChef();
    const photo = dishPath(chef.id);
    await upload("dish-photos", photo);
    const d = await createDish(chef, { photoPath: photo });
    expect((await application(chef.b)).missing).not.toContain("sampleDish");
    await patch(chef.b, d.id, { isActive: false });
    expect((await application(chef.b)).missing).toContain("sampleDish");
    await patch(chef.b, d.id, { isActive: true });
    expect((await application(chef.b)).missing).not.toContain("sampleDish");
  });

  it("a dish without a photo does not satisfy sampleDish", async () => {
    const chef = await newChef();
    await createDish(chef);
    expect((await application(chef.b)).missing).toContain("sampleDish");
  });
});

describe("the 50 active dishes cap", () => {
  const fill = async (chef: string, n: number) => {
    const r = await svc.from("dishes").insert(
      Array.from({ length: n }, (_, i) => ({
        chef_id: chef,
        name: `d${i}`,
        cuisine: "Thai",
        cook_minutes: 30,
      })),
    );
    expect(r.error).toBeNull();
  };

  it("POST is 409 INVALID_STATE at 50, and reactivating over the cap is too", async () => {
    const chef = await newChef();
    await fill(chef.id, 49);
    const last = await createDish(chef, { name: "fiftieth" });
    const over = await chef.b.call(createDishRoute, { body: validDish });
    expect(over.status, over.text).toBe(409);
    expect(over.body.error.code).toBe("INVALID_STATE");
    expect(await dishCount(chef.id)).toBe(50);
    // deactivate one, create another, then try to bring the first back
    expect((await patch(chef.b, last.id, { isActive: false })).status).toBe(
      200,
    );
    await createDish(chef, { name: "replacement" });
    const back = await patch(chef.b, last.id, { isActive: true });
    expect(back.status, back.text).toBe(409);
    expect(back.body.error.code).toBe("INVALID_STATE");
    expect((await dishRow(last.id))?.is_active).toBe(false);
    // editing other fields of a deactivated dish at the cap is fine
    expect((await patch(chef.b, last.id, { name: "renamed" })).status).toBe(
      200,
    );
  });

  it("parallel creates cannot exceed the cap", async () => {
    const chef = await newChef();
    await fill(chef.id, 46);
    const rs = await Promise.all(
      Array.from({ length: 10 }, () =>
        chef.b.call(createDishRoute, { body: validDish }),
      ),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(4);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(6);
    expect(
      (
        await svc
          .from("dishes")
          .select("id", { count: "exact", head: true })
          .eq("chef_id", chef.id)
          .eq("is_active", true)
      ).count,
    ).toBe(50);
  });
});

describe("browser writes are no longer possible (routes only)", () => {
  it("a chef's own session cannot insert, update or delete dishes directly", async () => {
    const chef = await newChef();
    const d = await createDish(chef);
    const c = await chefClient(chef.email);
    const ins = await c.from("dishes").insert({
      chef_id: chef.id,
      name: "direct",
      cuisine: "x",
      cook_minutes: 1,
    });
    expect(ins.error?.code).toBe("42501");
    const upd = await c
      .from("dishes")
      .update({ name: "direct" })
      .eq("id", d.id);
    expect(upd.error?.code).toBe("42501");
    const del = await c.from("dishes").delete().eq("id", d.id);
    expect(del.error?.code).toBe("42501");
    expect((await dishRow(d.id))?.name).toBe("Pho bo");
  });
});
