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
