// T-101 (D-147, D-148): the contact filter on text people write about themselves. Local Supabase.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as signup } from "@/app/api/auth/signup/route";
import { PUT as putIntake } from "@/app/api/me/intake/route";
import { PATCH as patchMe } from "@/app/api/me/route";
import {
  Browser,
  PASSWORD,
  freshLimits,
  newEmail,
  type Reply,
} from "./harness";
import { newChef, newCustomer, patchApp, svc } from "./chef-helpers";
import {
  createDish,
  createDishRoute,
  patchDish,
  validDish,
} from "./dish-helpers";
import {
  NONE,
  bookableChef,
  bookingBody,
  bookingCustomer,
  book,
  bookOk,
  estimate,
} from "./booking-helpers";

beforeEach(() => freshLimits());

const BAD = [
  "Anna 416 555 0199",
  "mail anna@example.com",
  "see www.annacooks.ca",
];

function expectContact(r: Reply, key: string) {
  expect(r.status, r.text).toBe(422);
  expect(r.body.error.code).toBe("CONTACT_DETAILS_NOT_ALLOWED");
  expect(Object.keys(r.body.error.fields)).toEqual([key]);
}

describe("display name", () => {
  it("sign-up refuses a phone number, email or link, and creates no account", async () => {
    for (const displayName of BAD) {
      const email = newEmail("cust");
      const r = await new Browser().call(signup, {
        body: { email, password: PASSWORD, role: "customer", displayName },
      });
      expectContact(r, "displayName");
      const { data } = await svc.auth.admin.listUsers({ perPage: 1000 });
      expect(data.users.some((u) => u.email === email)).toBe(false);
    }
  });

  it("PATCH /api/me refuses it for a customer and a chef, and keeps the old name", async () => {
    const chef = await newChef("Clean Chef");
    const cust = await newCustomer("Clean Customer");
    for (const who of [chef, cust])
      for (const displayName of BAD) {
        const r = await who.b.call(patchMe, {
          method: "PATCH",
          body: { displayName },
        });
        expectContact(r, "displayName");
      }
    const p = await svc
      .from("profiles")
      .select("display_name")
      .eq("id", chef.id)
      .single();
    expect(p.data?.display_name).toBe("Clean Chef");
    const c = await svc
      .from("chefs")
      .select("display_name")
      .eq("profile_id", chef.id)
      .single();
    expect(c.data?.display_name).toBe("Clean Chef");
  });

  it("a normal name with digits that are not a phone number still passes", async () => {
    const cust = await newCustomer();
    const r = await cust.b.call(patchMe, {
      method: "PATCH",
      body: { displayName: "Mai Tran 2nd" },
    });
    expect(r.status, r.text).toBe(200);
  });
});

describe("chef bio", () => {
  it("is refused with 422 CONTACT_DETAILS_NOT_ALLOWED and not saved", async () => {
    const chef = await newChef();
    for (const bio of BAD) {
      const r = await chef.b.call(patchApp, { method: "PATCH", body: { bio } });
      expectContact(r, "bio");
    }
    const row = await svc
      .from("chefs")
      .select("bio")
      .eq("profile_id", chef.id)
      .single();
    expect(row.data?.bio ?? null).toBeNull();
    const ok = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { bio: "I cook northern Vietnamese food." },
    });
    expect(ok.status, ok.text).toBe(200);
  });
});

describe("dish name and description", () => {
  it("create and update are refused and nothing is written", async () => {
    const chef = await newChef();
    for (const field of ["name", "description"] as const)
      for (const bad of BAD) {
        const r = await chef.b.call(createDishRoute, {
          body: { ...validDish, [field]: bad },
        });
        expectContact(r, field);
      }
    const none = await svc.from("dishes").select("id").eq("chef_id", chef.id);
    expect(none.data).toEqual([]);

    const dish = await createDish(chef);
    for (const field of ["name", "description"] as const) {
      const r = await chef.b.call(patchDish(dish.id), {
        method: "PATCH",
        body: { [field]: BAD[0] },
      });
      expectContact(r, field);
    }
    const row = await svc
      .from("dishes")
      .select("name, description")
      .eq("id", dish.id)
      .single();
    expect(row.data?.name).toBe(validDish.name);
    expect(row.data?.description).toBeNull();
  });

  it("a mixed failure stays VALIDATION_FAILED", async () => {
    const chef = await newChef();
    const r = await chef.b.call(createDishRoute, {
      body: { ...validDish, name: BAD[0], cookMinutes: -5 },
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("intake notes", () => {
  it("booking create and estimate refuse contact details in allergy and dietary notes", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    for (const intake of [
      {
        noAllergies: false,
        allergyNotes: "call 416 555 0199",
        noDietaryNeeds: true,
      },
      { noAllergies: true, noDietaryNeeds: false, dietaryNotes: "a@b.co" },
    ]) {
      const r = await book(c, bookingBody(chef, { intake }));
      expect(r.status, r.text).toBe(422);
      expect(r.body.error.code).toBe("CONTACT_DETAILS_NOT_ALLOWED");
      expect(
        Object.keys(r.body.error.fields).every((k) => k.startsWith("intake.")),
      ).toBe(true);
      const e = await estimate(c, bookingBody(chef, { intake }));
      expect(e.status, e.text).toBe(422);
    }
    const ok = await bookOk(c, bookingBody(chef, { intake: NONE }));
    expect(ok.status).toBe(201);
  });

  it("the saved allergy profile refuses them too", async () => {
    const c = await newCustomer();
    const r = await c.b.call(putIntake, {
      method: "PUT",
      body: {
        noAllergies: false,
        allergens: [],
        allergyNotes: "text me 416-555-0199",
        noDietaryNeeds: true,
      },
    });
    expect(r.status, r.text).toBe(422);
    expect(r.body.error.code).toBe("CONTACT_DETAILS_NOT_ALLOWED");
    expect(Object.keys(r.body.error.fields)).toEqual(["allergyNotes"]);
  });
});
