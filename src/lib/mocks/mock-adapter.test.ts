import { beforeEach, describe, expect, it } from "vitest";
import type {
  ChefApplication,
  MeResponse,
  RegisterDocumentResponse,
  SubmitApplicationResponse,
} from "@/lib/api/types";
import { mockFetch, resetMockState } from "@/lib/mocks/mock-adapter";

const H = { "Content-Type": "application/json" };
async function call(method: string, path: string, body?: unknown) {
  const res = await mockFetch(path, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}
async function signUp(role: "chef" | "customer", displayName = "Mai Tran") {
  return call("POST", "/api/auth/signup", {
    email: "mai@example.com",
    password: "longenough1",
    role,
    displayName,
  });
}
async function uid() {
  return ((await call("GET", "/api/me")).data as MeResponse).profile.id;
}
const U = (id: string, file: string) => `${id}/${file}`;
const UUID = "123e4567-e89b-42d3-a456-426614174000";

beforeEach(() => resetMockState());

describe("MOCK chef application", () => {
  it("is for chefs only", async () => {
    await signUp("customer");
    expect((await call("GET", "/api/chef/application")).status).toBe(403);
  });
  it("needs a session", async () => {
    expect((await call("GET", "/api/chef/application")).status).toBe(401);
  });
  it("starts as a draft with every check not started", async () => {
    await signUp("chef");
    const { status, data } = await call("GET", "/api/chef/application");
    const a = data as ChefApplication;
    expect(status).toBe(200);
    expect(a.status).toBe("pending");
    expect(a.checks).toEqual({
      id: "not_started",
      foodHandler: "not_started",
      kitchen: "not_started",
      police: "not_started",
    });
    expect(a.missing).toContain("bio");
    expect(a.missing).toContain("sampleDish");
    expect(a.missing).toContain("phoneVerified");
  });
  it("GET /api/me shows the chef summary", async () => {
    await signUp("chef");
    expect(
      ((await call("GET", "/api/me")).data as MeResponse).chef?.status,
    ).toBe("pending");
  });
  it("PATCH validates with the real rules and saves", async () => {
    await signUp("chef");
    const bad = await call("PATCH", "/api/chef/application", {
      hourlyRateCents: 1,
      nope: 1,
    });
    expect(bad.status).toBe(422);
    expect(bad.data.error.fields.hourlyRateCents).toBeTruthy();
    expect(bad.data.error.fields.nope).toBe("Unknown field.");
    const ok = await call("PATCH", "/api/chef/application", {
      bio: "Hi",
      cuisines: ["Thai"],
      hourlyRateCents: 2500,
    });
    expect(ok.status).toBe(200);
    expect(ok.data.bio).toBe("Hi");
    expect(ok.data.missing).not.toContain("bio");
  });
  it("registers documents, replacing resets a verified-style check only when set", async () => {
    await signUp("chef");
    const id = await uid();
    const path = U(id, `id-${UUID}.png`);
    const r = await call("POST", "/api/chef/application/documents", {
      kind: "id_document",
      path,
    });
    expect(r.status).toBe(200);
    expect(
      (r.data as RegisterDocumentResponse).application.documents.idDocumentPath,
    ).toBe(path);
    const again = await call("POST", "/api/chef/application/documents", {
      kind: "id_document",
      path,
    });
    expect(again.status).toBe(200);
  });
  it("rejects foreign folders (403), bad names and kinds (422)", async () => {
    await signUp("chef");
    const id = await uid();
    expect(
      (
        await call("POST", "/api/chef/application/documents", {
          kind: "id_document",
          path: `other/id-${UUID}.png`,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("POST", "/api/chef/application/documents", {
          kind: "id_document",
          path: U(id, "ID-x.PNG"),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call("POST", "/api/chef/application/documents", {
          kind: "nope",
          path: U(id, `id-${UUID}.png`),
        })
      ).status,
    ).toBe(422);
  });
  it("kitchen photos: add, limit of 10, remove, unknown path is 404", async () => {
    await signUp("chef");
    const id = await uid();
    const p = (n: number) =>
      U(
        id,
        `kitchen-123e4567-e89b-42d3-a456-4266141740${String(n).padStart(2, "0")}.jpg`,
      );
    for (let i = 0; i < 10; i++)
      expect(
        (
          await call("POST", "/api/chef/application/documents", {
            kind: "kitchen_photo",
            path: p(i),
          })
        ).status,
      ).toBe(200);
    expect(
      (
        await call("POST", "/api/chef/application/documents", {
          kind: "kitchen_photo",
          path: p(10),
        })
      ).status,
    ).toBe(409);
    const del = await call("DELETE", "/api/chef/application/documents", {
      kind: "kitchen_photo",
      path: p(0),
    });
    expect(del.status).toBe(200);
    expect(del.data.application.documents.kitchenPhotoPaths).toHaveLength(9);
    expect(
      (
        await call("DELETE", "/api/chef/application/documents", {
          kind: "kitchen_photo",
          path: p(0),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("DELETE", "/api/chef/application/documents", {
          kind: "id_document",
          path: p(1),
        })
      ).status,
    ).toBe(422);
  });
  it("submit with missing items is 409 APPLICATION_INCOMPLETE with the list", async () => {
    await signUp("chef");
    const r = await call("POST", "/api/chef/application/submit");
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe("APPLICATION_INCOMPLETE");
    expect(r.data.error.missing).toContain("bio");
  });
  it("a complete application submits and moves checks to pending (MOCK)", async () => {
    await signUp("chef", "Chef With Dish");
    await call("POST", "/api/me/phone", { phone: "416 555 0123" });
    await call("POST", "/api/me/phone/verify", { code: "123456" });
    const id = await uid();
    await call("PATCH", "/api/chef/application", {
      bio: "Hi",
      cuisines: ["Thai"],
      languages: ["English"],
      hourlyRateCents: 2500,
      servicePostalPrefix: "L5B",
      serviceRadiusKm: 10,
      locationOptions: ["customer_home"],
      photoPath: U(id, `photo-${UUID}.png`),
      acknowledgeAllergenStatement: true,
    });
    await call("POST", "/api/chef/application/documents", {
      kind: "id_document",
      path: U(id, `id-${UUID}.pdf`),
    });
    await call("POST", "/api/chef/application/documents", {
      kind: "food_handler",
      path: U(id, `food-handler-${UUID}.pdf`),
    });
    const r = await call("POST", "/api/chef/application/submit");
    expect(r.status).toBe(200);
    const s = r.data as SubmitApplicationResponse;
    expect(s.mock).toBe(true);
    expect(s.application.checks.id).toBe("pending");
    expect(s.application.checks.foodHandler).toBe("pending");
    expect(s.application.checks.kitchen).toBe("not_started");
    expect(s.application.missing).toEqual([]);
  });
  it("the chef's-home option needs kitchen items and a kitchen change switches it off", async () => {
    await signUp("chef");
    const r = await call("PATCH", "/api/chef/application", {
      locationOptions: ["customer_home", "chef_home"],
    });
    expect(r.data.missing).toEqual(
      expect.arrayContaining([
        "kitchenAddress",
        "kitchenPhotos",
        "kitchenHygieneAcknowledgement",
      ]),
    );
    const k = await call("PATCH", "/api/chef/application", {
      kitchenAddress: {
        line: "1 Main St",
        city: "Mississauga",
        postalCode: "l5b 1a1",
      },
      acknowledgeKitchenHygiene: true,
    });
    expect(k.data.kitchenAddress.postalCode).toBe("L5B1A1");
    expect(k.data.kitchenHygieneAckAt).toBeTruthy();
    expect(k.data.chefHomeEnabled).toBe(false);
  });
  it("magic names give a rejected or approved chef", async () => {
    await signUp("chef", "Rejected Chef");
    const a = (await call("GET", "/api/chef/application"))
      .data as ChefApplication;
    expect(a.status).toBe("rejected");
    expect(a.rejectReason).toMatch(/MOCK/);
    resetMockState();
    await signUp("chef", "Approved Chef");
    expect(
      ((await call("GET", "/api/chef/application")).data as ChefApplication)
        .status,
    ).toBe("approved");
    const s = await call("POST", "/api/chef/application/submit");
    expect(s.status).toBe(409);
    expect(s.data.error.code).toBe("INVALID_STATE");
  });
  it("PATCH /api/me changes the display name", async () => {
    await signUp("chef");
    const r = await call("PATCH", "/api/me", { displayName: "Nana Lan" });
    expect(r.status).toBe(200);
    expect(
      ((await call("GET", "/api/chef/application")).data as ChefApplication)
        .displayName,
    ).toBe("Nana Lan");
  });
});

describe("MOCK dishes (contract 5A)", () => {
  const dish = (over: Record<string, unknown> = {}) => ({
    name: "Pho bo",
    cuisine: "Vietnamese",
    cookMinutes: 180,
    ...over,
  });
  const photo = (id: string) => `${id}/dish-${UUID}.png`;

  it("is for chefs only and needs a session", async () => {
    expect((await call("GET", "/api/chef/dishes")).status).toBe(401);
    await signUp("customer");
    expect((await call("GET", "/api/chef/dishes")).status).toBe(403);
    expect(
      (await call("PUT", "/api/chef/availability", { add: [] })).status,
    ).toBe(403);
  });
  it("creates with defaults, lists newest first, and lower-cases allergens", async () => {
    await signUp("chef");
    const a = await call(
      "POST",
      "/api/chef/dishes",
      dish({ allergens: ["Soy", "SOY"] }),
    );
    expect(a.status).toBe(201);
    expect(a.data).toMatchObject({
      isActive: true,
      servings: 1,
      shelfLifeDays: 2,
      ingredientCostCents: 0,
      allergens: ["soy"],
      photoPath: null,
    });
    await call("POST", "/api/chef/dishes", dish({ name: "Second" }));
    const list = await call("GET", "/api/chef/dishes");
    expect(list.data.items.map((d: { name: string }) => d.name)).toEqual([
      "Second",
      "Pho bo",
    ]);
  });
  it("uses the real bounds and rejects unknown keys", async () => {
    await signUp("chef");
    const bounds = await call(
      "POST",
      "/api/chef/dishes",
      dish({ cookMinutes: 4, servings: 51 }),
    );
    expect(bounds.status).toBe(422);
    expect(bounds.data.error.fields.cookMinutes).toBeTruthy();
    expect(bounds.data.error.fields.servings).toBeTruthy();
    // Like the real route, unknown keys are answered on their own (isActive is not a create field).
    const unknown = await call(
      "POST",
      "/api/chef/dishes",
      dish({ isActive: false }),
    );
    expect(unknown.status).toBe(422);
    expect(unknown.data.error.fields.isActive).toBe("Unknown field.");
  });
  it("answers a foreign photo folder with 403 before field errors", async () => {
    await signUp("chef");
    const r = await call(
      "POST",
      "/api/chef/dishes",
      dish({ name: "", photoPath: `someone-else/dish-${UUID}.png` }),
    );
    expect(r.status).toBe(403);
  });
  it("PATCH: 404 for a missing dish before 422, 422 for bad fields, edits and deactivates", async () => {
    await signUp("chef");
    expect(
      (await call("PATCH", "/api/chef/dishes/nope", { name: "" })).status,
    ).toBe(404);
    const d = (await call("POST", "/api/chef/dishes", dish())).data;
    expect(
      (await call("PATCH", `/api/chef/dishes/${d.id}`, { name: "" })).status,
    ).toBe(422);
    expect(
      (await call("PATCH", `/api/chef/dishes/${d.id}`, {})).data.name,
    ).toBe("Pho bo");
    const off = await call("PATCH", `/api/chef/dishes/${d.id}`, {
      isActive: false,
      servings: 3,
    });
    expect(off.data).toMatchObject({ isActive: false, servings: 3 });
    const on = await call("PATCH", `/api/chef/dishes/${d.id}`, {
      isActive: true,
    });
    expect(on.data.isActive).toBe(true);
  });
  it("stops at 50 active dishes with 409, and a deactivated dish frees a place", async () => {
    await signUp("chef");
    let first = "";
    for (let i = 0; i < 50; i++) {
      const r = await call("POST", "/api/chef/dishes", dish({ name: `D${i}` }));
      expect(r.status).toBe(201);
      first ||= r.data.id;
    }
    const over = await call("POST", "/api/chef/dishes", dish());
    expect(over.status).toBe(409);
    expect(over.data.error.code).toBe("INVALID_STATE");
    await call("PATCH", `/api/chef/dishes/${first}`, { isActive: false });
    const again = await call("POST", "/api/chef/dishes", dish());
    expect(again.status).toBe(201);
    expect(
      (await call("PATCH", `/api/chef/dishes/${first}`, { isActive: true }))
        .status,
    ).toBe(409);
  }, 30000);
  it("an active dish with a photo satisfies missing.sampleDish; deactivating brings it back", async () => {
    await signUp("chef");
    const id = await uid();
    const d = (
      await call("POST", "/api/chef/dishes", dish({ photoPath: photo(id) }))
    ).data;
    expect(
      ((await call("GET", "/api/chef/application")).data as ChefApplication)
        .missing,
    ).not.toContain("sampleDish");
    await call("PATCH", `/api/chef/dishes/${d.id}`, { isActive: false });
    expect(
      ((await call("GET", "/api/chef/application")).data as ChefApplication)
        .missing,
    ).toContain("sampleDish");
  });
  it('a chef named "with dish" starts with a real dish with a photo', async () => {
    await signUp("chef", "Mai With Dish");
    const items = (await call("GET", "/api/chef/dishes")).data.items;
    expect(items).toHaveLength(1);
    expect(items[0].photoPath).toMatch(/dish-/);
    expect(
      ((await call("GET", "/api/chef/application")).data as ChefApplication)
        .missing,
    ).not.toContain("sampleDish");
  });
});

describe("MOCK availability (contract 5B)", () => {
  it("returns the server window and starts empty", async () => {
    await signUp("chef");
    const r = await call("GET", "/api/chef/availability");
    expect(r.data.days).toEqual([]);
    expect(r.data.lastBookableDay > r.data.today).toBe(true);
  });
  it("adds and removes dates, de-duplicated and sorted", async () => {
    await signUp("chef");
    const { today } = (await call("GET", "/api/chef/availability")).data;
    const d = (n: number) => {
      const x = new Date(`${today}T12:00:00Z`);
      x.setUTCDate(x.getUTCDate() + n);
      return x.toISOString().slice(0, 10);
    };
    const a = await call("PUT", "/api/chef/availability", {
      add: [d(3), d(1), d(1)],
    });
    expect(a.data.days).toEqual([d(1), d(3)]);
    const b = await call("PUT", "/api/chef/availability", {
      remove: [d(1)],
      add: [d(2)],
    });
    expect(b.data.days).toEqual([d(2), d(3)]);
  });
  it("409 DATE_BOOKED names the booked date and saves nothing (D-22)", async () => {
    await signUp("chef");
    const { today } = (await call("GET", "/api/chef/availability")).data;
    const d = (n: number) => {
      const x = new Date(`${today}T12:00:00Z`);
      x.setUTCDate(x.getUTCDate() + n);
      return x.toISOString().slice(0, 10);
    };
    await call("PUT", "/api/chef/availability", { add: [d(2), d(3)] });
    const r = await call("PUT", "/api/chef/availability", {
      remove: [d(2), d(3)],
      add: [d(4)],
    });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe("DATE_BOOKED");
    expect(r.data.error.dates).toEqual([d(3)]);
    expect((await call("GET", "/api/chef/availability")).data.days).toEqual([
      d(2),
      d(3),
    ]);
  });
  it("refuses past dates, dates after the window, overlaps, empty bodies and unknown keys", async () => {
    await signUp("chef");
    const { today, lastBookableDay } = (
      await call("GET", "/api/chef/availability")
    ).data;
    expect(
      (await call("PUT", "/api/chef/availability", { add: ["2020-01-01"] }))
        .status,
    ).toBe(422);
    const after = new Date(`${lastBookableDay}T12:00:00Z`);
    after.setUTCDate(after.getUTCDate() + 1);
    expect(
      (
        await call("PUT", "/api/chef/availability", {
          add: [after.toISOString().slice(0, 10)],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call("PUT", "/api/chef/availability", {
          add: [today],
          remove: [today],
        })
      ).status,
    ).toBe(422);
    expect((await call("PUT", "/api/chef/availability", {})).status).toBe(422);
    expect(
      (
        await call("PUT", "/api/chef/availability", {
          add: [today],
          chefId: "x",
        })
      ).status,
    ).toBe(422);
    expect(
      (await call("PUT", "/api/chef/availability", { add: ["2026-02-30"] }))
        .status,
    ).toBe(422);
  });
});
