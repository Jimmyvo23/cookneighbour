import { beforeEach, describe, expect, it } from "vitest";
import type { MeResponse } from "@/lib/api/types";
import { mockFetch, resetMockState } from "@/lib/mocks/mock-adapter";

// Tester: the exact check order of the dish routes (src/lib/server/dishes.ts):
// role -> 404 (PATCH) -> unknown keys alone (422) -> foreign photo folder (403)
// -> field rules, all at once (422) -> 409 cap.

const H = { "Content-Type": "application/json" };
async function call(method: string, path: string, body?: unknown) {
  const res = await mockFetch(path, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}
async function signUp(role: "chef" | "customer") {
  return call("POST", "/api/auth/signup", {
    email: "mai@example.com",
    password: "longenough1",
    role,
    displayName: "Mai Tran",
  });
}
const uid = async () =>
  ((await call("GET", "/api/me")).data as MeResponse).profile.id;
const good = () => ({ name: "Pho", cuisine: "Vietnamese", cookMinutes: 60 });
const FOREIGN =
  "11111111-2222-4333-8444-555555555555/dish-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png";

beforeEach(() => resetMockState());

describe("MOCK dish routes: check order", () => {
  it("customers get 403 and visitors 401, before anything else", async () => {
    expect((await call("POST", "/api/chef/dishes", good())).status).toBe(401);
    await signUp("customer");
    expect((await call("POST", "/api/chef/dishes", good())).status).toBe(403);
    expect(
      (await call("PATCH", "/api/chef/dishes/nope", { bogus: 1 })).status,
    ).toBe(403);
  });

  it("PATCH of a missing or malformed id is 404 even with unknown keys and bad fields", async () => {
    await signUp("chef");
    for (const id of ["nope", "123e4567-e89b-42d3-a456-426614174000"]) {
      const r = await call("PATCH", `/api/chef/dishes/${id}`, {
        bogus: 1,
        cookMinutes: 1,
        photoPath: FOREIGN,
      });
      expect(r.status).toBe(404);
    }
  });

  it("unknown keys are reported alone, before field errors and the foreign photo", async () => {
    await signUp("chef");
    const r = await call("POST", "/api/chef/dishes", {
      name: "",
      cuisine: "",
      cookMinutes: 1,
      photoPath: FOREIGN,
      owner: "x",
    });
    expect(r.status).toBe(422);
    expect(Object.keys(r.data.error.fields)).toEqual(["owner"]);
  });

  it("isActive is an unknown key on create, and known on PATCH", async () => {
    await signUp("chef");
    const bad = await call("POST", "/api/chef/dishes", {
      ...good(),
      isActive: false,
    });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.data.error.fields)).toEqual(["isActive"]);
    const made = await call("POST", "/api/chef/dishes", good());
    expect(made.data.isActive).toBe(true);
    const off = await call("PATCH", `/api/chef/dishes/${made.data.id}`, {
      isActive: false,
    });
    expect(off.data.isActive).toBe(false);
  });

  it("a foreign photo folder is 403 before field errors", async () => {
    await signUp("chef");
    const r = await call("POST", "/api/chef/dishes", {
      name: "",
      cuisine: "x",
      cookMinutes: 1,
      photoPath: FOREIGN,
    });
    expect(r.status).toBe(403);
    expect(r.data.error.fields).toBeUndefined();
  });

  it("a badly named own photo and field errors are reported together", async () => {
    await signUp("chef");
    const me = await uid();
    const r = await call("POST", "/api/chef/dishes", {
      name: "",
      cuisine: "x",
      cookMinutes: 1,
      servings: 51,
      photoPath: `${me}/DISH-AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.png`,
    });
    expect(r.status).toBe(422);
    expect(Object.keys(r.data.error.fields).sort()).toEqual(
      ["cookMinutes", "name", "photoPath", "servings"].sort(),
    );
  });

  it("field errors win over the 50-dish cap (422, not 409)", async () => {
    await signUp("chef");
    for (let i = 0; i < 50; i++)
      expect(
        (await call("POST", "/api/chef/dishes", { ...good(), name: `D${i}` }))
          .status,
      ).toBe(201);
    const bad = await call("POST", "/api/chef/dishes", {
      ...good(),
      cookMinutes: 1,
    });
    expect(bad.status).toBe(422);
    expect((await call("POST", "/api/chef/dishes", good())).status).toBe(409);
  }, 30000);

  it("an empty PATCH changes nothing; editing at the cap is fine; deactivating at the cap is fine", async () => {
    await signUp("chef");
    let last = "";
    for (let i = 0; i < 50; i++)
      last = (
        await call("POST", "/api/chef/dishes", { ...good(), name: `D${i}` })
      ).data.id;
    const before = (await call("GET", "/api/chef/dishes")).data.items.find(
      (d: { id: string }) => d.id === last,
    );
    const noop = await call("PATCH", `/api/chef/dishes/${last}`, {});
    expect(noop.status).toBe(200);
    expect(noop.data.updatedAt).toBe(before.updatedAt);
    // Re-sending isActive: true on an already active dish at the cap is not a 409.
    expect(
      (await call("PATCH", `/api/chef/dishes/${last}`, { isActive: true }))
        .status,
    ).toBe(200);
    expect(
      (await call("PATCH", `/api/chef/dishes/${last}`, { name: "Renamed" }))
        .status,
    ).toBe(200);
    expect(
      (await call("PATCH", `/api/chef/dishes/${last}`, { isActive: false }))
        .status,
    ).toBe(200);
  }, 30000);
});
