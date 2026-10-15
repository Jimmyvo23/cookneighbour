// T-067 tester additions. LOCAL Supabase only (runs in CI).
// Covers: metadata role claims ignored, admin refused, savedAt format, other profile data untouched,
// the saved profile never reaches a chef or the booking's own copy, and no client write.
import { beforeEach, describe, expect, it } from "vitest";
import {
  DELETE as clearIntake,
  GET as getIntake,
  PUT as putIntake,
} from "@/app/api/me/intake/route";
import { GET as getMe } from "@/app/api/me/route";
import { freshLimits, PASSWORD } from "./harness";
import { login, newAdmin, newChef, newCustomer, svc } from "./chef-helpers";
import { Browser } from "./harness";
import {
  book,
  bookableChef,
  bookingBody,
  bookingCustomer,
  getBooking,
} from "./booking-helpers";

beforeEach(() => freshLimits());

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const form = (tag: string) => ({
  noAllergies: false,
  allergens: ["sesame"],
  allergyNotes: `profile-only ${tag}`,
  noDietaryNeeds: true,
});

async function withClaims(who: { id: string; email: string }, role: string) {
  const upd = await svc.auth.admin.updateUserById(who.id, {
    user_metadata: { role },
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

describe("saved intake: roles and claims", () => {
  it("admin is refused on all three handlers and a customer-role claim does not help a chef or admin", async () => {
    const admin = await newAdmin("customer");
    const chef = await newChef();
    const chefB = await withClaims(chef, "customer");
    for (const [name, b] of [
      ["admin", admin.b],
      ["chef claiming customer", chefB],
    ] as const) {
      for (const [h, method] of [
        [getIntake, "GET"],
        [putIntake, "PUT"],
        [clearIntake, "DELETE"],
      ] as const) {
        const r = await b.call(h, { method, body: form(name) });
        expect(r.status, `${name} ${method}`).toBe(403);
      }
    }
  });

  it("a customer claiming chef or admin in metadata is still a customer", async () => {
    for (const role of ["chef", "admin"]) {
      const c = await newCustomer();
      const b = await withClaims(c, role);
      const put = await b.call(putIntake, { method: "PUT", body: form(role) });
      expect(put.status, put.text).toBe(200);
      const row = await svc
        .from("profile_private")
        .select("saved_intake")
        .eq("profile_id", c.id)
        .single();
      expect(row.data?.saved_intake.allergyNotes).toBe(`profile-only ${role}`);
    }
  });
});

describe("saved intake: storage behaviour", () => {
  it("savedAt is ISO with ms and Z on PUT and GET; a refused PUT keeps the old value", async () => {
    const c = await newCustomer();
    const put = await c.b.call(putIntake, { method: "PUT", body: form("a") });
    expect(put.body.savedAt).toMatch(ISO_Z);
    const got = await c.b.call(getIntake);
    expect(got.body.savedAt).toMatch(ISO_Z);
    expect(got.body.savedAt).toBe(put.body.savedAt);
    const bad = await c.b.call(putIntake, {
      method: "PUT",
      body: { ...form("b"), allergens: ["nope"] },
    });
    expect(bad.status).toBe(422);
    const after = await c.b.call(getIntake);
    expect(after.body).toEqual(got.body);
  });

  it("save and clear leave the phone, address and verification untouched", async () => {
    const c = await bookingCustomer();
    const before = await svc
      .from("profile_private")
      .select(
        "phone_e164, phone_hash, phone_verified, address_line, address_hash",
      )
      .eq("profile_id", c.id)
      .single();
    expect(before.data?.phone_verified).toBe(true);
    await c.b.call(putIntake, { method: "PUT", body: form("keep") });
    const mid = await svc
      .from("profile_private")
      .select(
        "phone_e164, phone_hash, phone_verified, address_line, address_hash",
      )
      .eq("profile_id", c.id)
      .single();
    expect(mid.data).toEqual(before.data);
    await c.b.call(clearIntake, { method: "DELETE" });
    const end = await svc
      .from("profile_private")
      .select(
        "phone_e164, phone_hash, phone_verified, address_line, address_hash, saved_intake, saved_intake_at",
      )
      .eq("profile_id", c.id)
      .single();
    expect(end.data).toEqual({
      ...before.data,
      saved_intake: null,
      saved_intake_at: null,
    });
  });

  it("a stored value that is not a valid form reads as nothing saved", async () => {
    const c = await newCustomer();
    await svc
      .from("profile_private")
      .update({
        saved_intake: { allergens: ["kryptonite"] },
        saved_intake_at: new Date().toISOString(),
      })
      .eq("profile_id", c.id);
    expect((await c.b.call(getIntake)).body).toEqual({
      intake: null,
      savedAt: null,
    });
  });

  it("the database refuses a non-object saved_intake", async () => {
    const c = await newCustomer();
    for (const bad of [[1], "text", 5]) {
      const r = await svc
        .from("profile_private")
        .update({ saved_intake: bad })
        .eq("profile_id", c.id);
      expect(r.error?.code, JSON.stringify(bad)).toBe("23514");
    }
  });

  it("clear on a customer with nothing saved succeeds; unknown and array bodies are refused", async () => {
    const c = await newCustomer();
    const del = await c.b.call(clearIntake, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ intake: null, savedAt: null });
    for (const body of [[], "x"]) {
      const r = await c.b.call(putIntake, { method: "PUT", body });
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe("saved intake: not leaked, not mixed into bookings", () => {
  it("never reaches the chef or GET /api/me; booking keeps its own copy", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const tag = `zq${Date.now()}`;
    await c.b.call(putIntake, { method: "PUT", body: form(tag) });
    const made = await book(c, bookingBody(chef));
    expect(made.status, made.text).toBe(201);
    const id = made.body.id as string;

    const asChef = await getBooking(chef.b, id);
    expect(asChef.status, asChef.text).toBe(200);
    expect(asChef.text).not.toContain(tag);
    expect(asChef.body.intake.allergies).toBe("None");

    // Editing the profile later does not change the booking.
    await c.b.call(putIntake, { method: "PUT", body: form(`${tag}-2`) });
    const asCust = await getBooking(c.b, id);
    expect(asCust.text).not.toContain(tag);
    expect(asCust.body.intake.allergies).toBe("None");

    for (const b of [c.b, chef.b]) {
      const me = await b.call(getMe);
      expect(me.text).not.toMatch(new RegExp(`${tag}|saved_intake`));
    }
    // A chef reading the table directly gets nothing (RLS), checked in tests/rls too.
    const chefIntake = await chef.b.call(getIntake);
    expect(chefIntake.status).toBe(403);
    expect(chefIntake.text).not.toContain(tag);
  });
});
