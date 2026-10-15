import { beforeEach, describe, expect, it } from "vitest";
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
async function signUp(role: "chef" | "customer") {
  return call("POST", "/api/auth/signup", {
    email: "mai@example.com",
    password: "longenough1",
    role,
    displayName: "Mai Tran",
  });
}
const FORM = {
  noAllergies: false,
  allergens: ["Peanuts", "peanuts", "milk"],
  allergyNotes: "  EpiPen ",
  noDietaryNeeds: true,
  dietaryNotes: "",
};

beforeEach(() => resetMockState());

describe("MOCK /api/me/intake (contract 4A)", () => {
  it("needs a session", async () => {
    expect((await call("GET", "/api/me/intake")).status).toBe(401);
  });
  it("is for customers only", async () => {
    await signUp("chef");
    for (const m of ["GET", "PUT", "DELETE"])
      expect((await call(m, "/api/me/intake", FORM)).status).toBe(403);
  });
  it("starts with nothing saved", async () => {
    await signUp("customer");
    const r = await call("GET", "/api/me/intake");
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ intake: null, savedAt: null });
  });
  it("saves a normalized form and reads it back with an ISO time", async () => {
    await signUp("customer");
    const put = await call("PUT", "/api/me/intake", FORM);
    expect(put.status).toBe(200);
    expect(put.data.intake).toEqual({
      noAllergies: false,
      allergens: ["peanuts", "milk"],
      allergyNotes: "EpiPen",
      noDietaryNeeds: true,
      dietaryNotes: "",
    });
    expect(put.data.savedAt).toMatch(/^\d{4}-\d\d-\d\dT.*\.\d{3}Z$/);
    expect((await call("GET", "/api/me/intake")).data).toEqual(put.data);
  });
  it("refuses a blank form with plain field keys", async () => {
    await signUp("customer");
    const r = await call("PUT", "/api/me/intake", {
      noAllergies: false,
      allergens: [],
      allergyNotes: "",
      noDietaryNeeds: false,
      dietaryNotes: "",
    });
    expect(r.status).toBe(422);
    expect(Object.keys(r.data.error.fields).sort()).toEqual([
      "allergies",
      "dietaryNotes",
    ]);
  });
  it("clears the saved form", async () => {
    await signUp("customer");
    await call("PUT", "/api/me/intake", FORM);
    const r = await call("DELETE", "/api/me/intake");
    expect(r).toEqual({
      status: 200,
      data: { intake: null, savedAt: null },
    });
    expect((await call("GET", "/api/me/intake")).data.intake).toBeNull();
  });
  it("is forgotten on log out", async () => {
    await signUp("customer");
    await call("PUT", "/api/me/intake", FORM);
    await call("POST", "/api/auth/logout");
    await signUp("customer");
    expect((await call("GET", "/api/me/intake")).data.intake).toBeNull();
  });
});
