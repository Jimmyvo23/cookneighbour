import { beforeEach, describe, expect, it } from "vitest";
import { POST as signup } from "@/app/api/auth/signup/route";
import {
  DELETE as clearIntake,
  GET as getIntake,
  PUT as putIntake,
} from "@/app/api/me/intake/route";
import { GET as getMe } from "@/app/api/me/route";
import { Browser, PASSWORD, freshLimits, newEmail, service } from "./harness";

const svc = service();
beforeEach(() => freshLimits());

async function person(role: "customer" | "chef") {
  const b = new Browser();
  const res = await b.call(signup, {
    body: { email: newEmail(role), password: PASSWORD, role, displayName: "T" },
  });
  expect(res.status, res.text).toBe(201);
  return { b, id: res.body.user.id as string };
}

const form = {
  noAllergies: false,
  allergens: ["peanuts"],
  allergyNotes: "carries an EpiPen",
  noDietaryNeeds: true,
};

describe("saved allergy profile /api/me/intake (T-067)", () => {
  it("starts empty, saves, reads back, replaces and clears", async () => {
    const { b, id } = await person("customer");
    const first = await b.call(getIntake);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ intake: null, savedAt: null });

    const put = await b.call(putIntake, { method: "PUT", body: form });
    expect(put.status, put.text).toBe(200);
    expect(put.body.intake).toEqual({
      noAllergies: false,
      allergens: ["peanuts"],
      allergyNotes: "carries an EpiPen",
      noDietaryNeeds: true,
      dietaryNotes: "",
    });
    const got = await b.call(getIntake);
    expect(got.body).toEqual(put.body);
    expect(typeof got.body.savedAt).toBe("string");

    const again = await b.call(putIntake, {
      method: "PUT",
      body: { noAllergies: true, noDietaryNeeds: false, dietaryNotes: "halal" },
    });
    expect(again.body.intake.allergens).toEqual([]);
    expect(again.body.intake.dietaryNotes).toBe("halal");

    const row = await svc
      .from("profile_private")
      .select("saved_intake")
      .eq("profile_id", id)
      .single();
    expect(row.data?.saved_intake.dietaryNotes).toBe("halal");

    const del = await b.call(clearIntake, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await b.call(getIntake)).body).toEqual({
      intake: null,
      savedAt: null,
    });
  });

  it("validates like the booking intake (422 with plain field keys)", async () => {
    const { b } = await person("customer");
    const blank = await b.call(putIntake, { method: "PUT", body: {} });
    expect(blank.status).toBe(422);
    expect(Object.keys(blank.body.error.fields).sort()).toEqual([
      "allergies",
      "dietaryNotes",
    ]);
    for (const body of [
      { ...form, allergens: ["kryptonite"] },
      { ...form, allergyNotes: "a\u0000b" },
      { ...form, allergyNotes: "x".repeat(301) },
      { ...form, noAllergies: true },
      { ...form, role: "admin" },
    ]) {
      const r = await b.call(putIntake, { method: "PUT", body });
      expect(r.status, JSON.stringify(body)).toBe(422);
    }
    expect((await b.call(getIntake)).body.intake).toBeNull();
  });

  it("needs a signed-in customer and JSON", async () => {
    for (const [h, method] of [
      [getIntake, "GET"],
      [putIntake, "PUT"],
      [clearIntake, "DELETE"],
    ] as const) {
      const anon = await new Browser().call(h, { method, body: form });
      expect(anon.status, method).toBe(401);
      const chef = await (
        await person("chef")
      ).b.call(h, { method, body: form });
      expect(chef.status, method).toBe(403);
    }
    const { b } = await person("customer");
    for (const contentType of [null, "text/plain"]) {
      expect(
        (await b.call(putIntake, { method: "PUT", contentType, body: form }))
          .status,
      ).toBe(400);
      expect(
        (await b.call(clearIntake, { method: "DELETE", contentType })).status,
      ).toBe(400);
    }
  });

  it("is per user and not part of GET /api/me", async () => {
    const a = await person("customer");
    const c = await person("customer");
    await a.b.call(putIntake, { method: "PUT", body: form });
    expect((await c.b.call(getIntake)).body.intake).toBeNull();
    const me = await a.b.call(getMe);
    expect(me.text).not.toMatch(/EpiPen|saved_intake/);
  });
});
