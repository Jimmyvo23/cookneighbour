// T-032: the database caps a chef at 50 active dishes, also under parallel writes.
import { describe, expect, it } from "vitest";
import { makeChef, serviceClient } from "./helpers";

const svc = serviceClient();
const row = (chef: string, i: number, extra: object = {}) => ({
  chef_id: chef,
  name: `d${i}`,
  cuisine: "Thai",
  cook_minutes: 30,
  ...extra,
});

async function fill(chef: string, n: number) {
  const { error } = await svc
    .from("dishes")
    .insert(Array.from({ length: n }, (_, i) => row(chef, i)));
  expect(error).toBeNull();
}

describe("dishes_active_cap trigger", () => {
  it("allows 50 active dishes and refuses the 51st with SQLSTATE 54000", async () => {
    const chef = await makeChef(svc, "cap-a");
    await fill(chef.id, 50);
    const r = await svc.from("dishes").insert(row(chef.id, 51));
    expect(r.error?.code, r.error?.message).toBe("54000");
  });

  it("inactive dishes do not count; reactivating over the cap is refused", async () => {
    const chef = await makeChef(svc, "cap-b");
    await fill(chef.id, 50);
    const inactive = await svc
      .from("dishes")
      .insert(row(chef.id, 99, { is_active: false }))
      .select("id")
      .single();
    expect(inactive.error).toBeNull();
    const react = await svc
      .from("dishes")
      .update({ is_active: true })
      .eq("id", inactive.data!.id);
    expect(react.error?.code).toBe("54000");
    // deactivating one makes room
    const one = await svc
      .from("dishes")
      .select("id")
      .eq("chef_id", chef.id)
      .eq("is_active", true)
      .limit(1)
      .single();
    expect(
      (
        await svc
          .from("dishes")
          .update({ is_active: false })
          .eq("id", one.data!.id)
      ).error,
    ).toBeNull();
    expect(
      (
        await svc
          .from("dishes")
          .update({ is_active: true })
          .eq("id", inactive.data!.id)
      ).error,
    ).toBeNull();
  });

  it("is per chef, and editing other columns of a full menu still works", async () => {
    const a = await makeChef(svc, "cap-c");
    const b = await makeChef(svc, "cap-d");
    await fill(a.id, 50);
    expect((await svc.from("dishes").insert(row(b.id, 1))).error).toBeNull();
    expect(
      (await svc.from("dishes").update({ name: "renamed" }).eq("chef_id", a.id))
        .error,
    ).toBeNull();
  });

  it("parallel inserts cannot pass the cap", async () => {
    const chef = await makeChef(svc, "cap-e");
    await fill(chef.id, 45);
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        svc.from("dishes").insert(row(chef.id, 100 + i)),
      ),
    );
    expect(results.filter((r) => !r.error).length).toBe(5);
    expect(
      results.filter((r) => r.error).every((r) => r.error!.code === "54000"),
    ).toBe(true);
    const { count } = await svc
      .from("dishes")
      .select("id", { count: "exact", head: true })
      .eq("chef_id", chef.id)
      .eq("is_active", true);
    expect(count).toBe(50);
  });
});
