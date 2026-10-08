// T-032: availability routes (contract section 5B). Runs against the LOCAL Supabase.
import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import {
  Browser,
  chefClient,
  newAdmin,
  newChef,
  newCustomer,
  svc,
} from "./chef-helpers";
import {
  addDays,
  getAvailabilityRoute,
  putAvailability,
  putDays,
  today,
} from "./dish-helpers";

beforeEach(() => freshLimits());

const put = (b: Browser, body: unknown) =>
  b.call(putAvailability, { method: "PUT", body });
const get = (b: Browser) => b.call(getAvailabilityRoute, { method: "GET" });
const rows = async (chef: string) =>
  (
    (
      await svc
        .from("availability")
        .select("day, available")
        .eq("chef_id", chef)
    ).data ?? []
  )
    .map((r) => r.day as string)
    .sort();

describe("who may call the availability routes", () => {
  it("anonymous is 401, a customer and an admin are 403, and nothing is written", async () => {
    const day = addDays(today(), 3);
    const customer = await newCustomer();
    const admin = await newAdmin();
    for (const who of [new Browser(), customer.b, admin.b]) {
      const expected = who === customer.b || who === admin.b ? 403 : 401;
      expect((await get(who)).status).toBe(expected);
      expect((await put(who, { add: [day] })).status).toBe(expected);
    }
    expect(await rows(customer.id)).toEqual([]);
    expect(await rows(admin.id)).toEqual([]);
  });

  it("rejects a wrong content type and broken JSON with 400", async () => {
    const chef = await newChef();
    const day = addDays(today(), 3);
    for (const opts of [
      { contentType: "text/plain" },
      { contentType: null },
      { raw: "[" },
    ]) {
      const r = await chef.b.call(putAvailability, {
        method: "PUT",
        body: { add: [day] },
        ...opts,
      });
      expect(r.status, JSON.stringify(opts)).toBe(400);
    }
    expect(await rows(chef.id)).toEqual([]);
  });
});

describe("PUT and GET /api/chef/availability", () => {
  it("starts empty and reports the server's window", async () => {
    const chef = await newChef();
    const r = await get(chef.b);
    expect(r.status, r.text).toBe(200);
    expect(r.body).toEqual({
      days: [],
      today: today(),
      lastBookableDay: addDays(today(), 180),
    });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("adds dates (sorted, de-duplicated) and the GET shows them", async () => {
    const chef = await newChef();
    const d1 = addDays(today(), 2);
    const d2 = addDays(today(), 1);
    const res = await putDays(chef, { add: [d1, d2, d1] });
    expect(res.days).toEqual([d2, d1]);
    expect((await get(chef.b)).body.days).toEqual([d2, d1]);
    expect(await rows(chef.id)).toEqual([d2, d1]);
    const row = await svc
      .from("availability")
      .select("available")
      .eq("chef_id", chef.id);
    expect((row.data ?? []).every((r) => r.available === true)).toBe(true);
  });

  it("is idempotent: adding a date twice and clearing a date that is not set both succeed", async () => {
    const chef = await newChef();
    const d = addDays(today(), 5);
    await putDays(chef, { add: [d] });
    expect((await putDays(chef, { add: [d] })).days).toEqual([d]);
    expect(
      (await putDays(chef, { remove: [addDays(today(), 9)] })).days,
    ).toEqual([d]);
  });

  it("clears dates, and add and remove can be combined in one request", async () => {
    const chef = await newChef();
    const [a, b, c] = [1, 2, 3].map((n) => addDays(today(), n));
    await putDays(chef, { add: [a, b] });
    const res = await putDays(chef, { add: [c], remove: [a] });
    expect(res.days).toEqual([b, c]);
    expect(await rows(chef.id)).toEqual([b, c]);
  });

  it("accepts today and the last bookable day", async () => {
    const chef = await newChef();
    const last = addDays(today(), 180);
    expect((await putDays(chef, { add: [today(), last] })).days).toEqual([
      today(),
      last,
    ]);
  });

  it("refuses past dates, dates after the horizon, and saves nothing", async () => {
    const chef = await newChef();
    const ok = addDays(today(), 2);
    for (const bad of [
      addDays(today(), -1),
      "2020-01-01",
      addDays(today(), 181),
    ]) {
      const r = await put(chef.b, { add: [ok, bad] });
      expect(r.status, bad).toBe(422);
      expect(r.body.error.fields.add).toBeTruthy();
    }
    expect(await rows(chef.id)).toEqual([]);
  });

  it("validates the dates, the lists and the keys", async () => {
    const chef = await newChef();
    const ok = addDays(today(), 2);
    const cases: [string, unknown, string][] = [
      ["empty body", {}, "add"],
      ["empty lists", { add: [], remove: [] }, "add"],
      ["not an array", { add: ok }, "add"],
      ["null", { add: null }, "add"],
      ["number entry", { add: [20261010] }, "add"],
      ["bad format", { add: ["10/10/2026"] }, "add"],
      ["not a real date", { add: ["2026-02-30"] }, "add"],
      ["timestamp", { add: [`${ok}T00:00:00Z`] }, "add"],
      ["remove not a real date", { remove: ["2026-13-01"] }, "remove"],
      ["same date in both", { add: [ok], remove: [ok] }, "remove"],
      ["201 dates", { add: Array.from({ length: 201 }, () => ok) }, "add"],
      ["unknown key", { add: [ok], chefId: "x" }, "chefId"],
      ["unknown key available", { add: [ok], available: false }, "available"],
    ];
    for (const [label, body, field] of cases) {
      const r = await put(chef.b, body);
      expect(r.status, label).toBe(422);
      expect(r.body.error.fields[field], label).toBeTruthy();
    }
    expect(await rows(chef.id)).toEqual([]);
  });

  it("a valid add with an invalid remove saves neither", async () => {
    const chef = await newChef();
    const r = await put(chef.b, {
      add: [addDays(today(), 2)],
      remove: ["2026-02-30"],
    });
    expect(r.status).toBe(422);
    expect(await rows(chef.id)).toEqual([]);
  });

  it("can clear a past date, and GET never shows past dates", async () => {
    const chef = await newChef();
    const past = addDays(today(), -10);
    const future = addDays(today(), 4);
    await svc.from("availability").insert([
      { chef_id: chef.id, day: past },
      { chef_id: chef.id, day: future },
    ]);
    expect((await get(chef.b)).body.days).toEqual([future]);
    const res = await putDays(chef, { remove: [past] });
    expect(res.days).toEqual([future]);
    expect(await rows(chef.id)).toEqual([future]);
  });

  it("accepts a full 181-day window in one request", async () => {
    const chef = await newChef();
    const add = Array.from({ length: 180 }, (_, i) => addDays(today(), i + 1));
    const res = await putDays(chef, { add: [...add, today()] });
    expect(res.days).toHaveLength(181);
  });

  it("each chef has their own calendar: one chef cannot read, set or clear another's", async () => {
    const a = await newChef();
    const b = await newChef();
    const d = addDays(today(), 6);
    await putDays(a, { add: [d] });
    expect((await get(b.b)).body.days).toEqual([]);
    await putDays(b, { add: [addDays(today(), 7)], remove: [d] });
    expect(await rows(a.id)).toEqual([d]); // b's remove only touched b's rows
    expect(await rows(b.id)).toEqual([addDays(today(), 7)]);
  });

  it("a pending chef can set availability", async () => {
    const chef = await newChef();
    const d = addDays(today(), 2);
    expect((await putDays(chef, { add: [d] })).days).toEqual([d]);
  });
});

describe("browser writes are no longer possible (routes only)", () => {
  it("a chef's own session cannot insert, update or delete availability directly", async () => {
    const chef = await newChef();
    const d = addDays(today(), 3);
    await putDays(chef, { add: [d] });
    const c = await chefClient(chef.email);
    const ins = await c
      .from("availability")
      .insert({ chef_id: chef.id, day: addDays(today(), 4) });
    expect(ins.error?.code).toBe("42501");
    const upd = await c
      .from("availability")
      .update({ available: false })
      .eq("chef_id", chef.id);
    expect(upd.error?.code).toBe("42501");
    const del = await c.from("availability").delete().eq("chef_id", chef.id);
    expect(del.error?.code).toBe("42501");
    expect(await rows(chef.id)).toEqual([d]);
  });
});
