import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getMe } from "@/app/api/me/route";
import { PUT as putAddress } from "@/app/api/me/address/route";
import { freshLimits } from "./harness";
import {
  AFTER_CHANGE,
  Browser,
  CHECK_STATUSES,
  PASSWORD,
  application,
  chefRow,
  deleteDoc,
  getApp,
  idPath,
  login,
  newAdmin,
  newChef,
  newCustomer,
  newEmail,
  patchApp,
  photoPath,
  postDoc,
  privRow,
  readyChef,
  setChef,
  setPriv,
  submit,
  svc,
  upload,
  uuid,
} from "./chef-helpers";

beforeEach(() => freshLimits());

type Handler = Parameters<Browser["call"]>[0];
const ROUTES: [string, Handler, string, unknown][] = [
  ["GET /api/chef/application", getApp, "GET", undefined],
  ["PATCH /api/chef/application", patchApp, "PATCH", {}],
  [
    "POST /api/chef/application/documents",
    postDoc,
    "POST",
    { kind: "id_document", path: "x" },
  ],
  [
    "DELETE /api/chef/application/documents",
    deleteDoc,
    "DELETE",
    { kind: "kitchen_photo", path: "x" },
  ],
  ["POST /api/chef/application/submit", submit, "POST", {}],
];

describe("who may call the chef application routes", () => {
  let customer: Awaited<ReturnType<typeof newCustomer>>;
  let admin: Awaited<ReturnType<typeof newAdmin>>;
  beforeAll(async () => {
    customer = await newCustomer();
    admin = await newAdmin();
  });

  it.each(ROUTES)("%s: 401 without a session", async (_n, h, method, body) => {
    const r = await new Browser().call(h, { method, body });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("UNAUTHENTICATED");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it.each(ROUTES)("%s: 403 for a customer", async (_n, h, method, body) => {
    const r = await customer.b.call(h, { method, body });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
  });

  it.each(ROUTES)("%s: 403 for an admin", async (_n, h, method, body) => {
    const r = await admin.b.call(h, { method, body });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
  });

  it("the role check comes before anything else: a customer with a bad content type gets 403, not 400", async () => {
    const r = await customer.b.call(patchApp, {
      method: "PATCH",
      contentType: "text/plain",
      body: {},
    });
    expect(r.status).toBe(403);
  });

  it("a rejected request creates no chef rows for a customer or an admin", async () => {
    for (const who of [customer, admin]) {
      await who.b.call(getApp, { method: "GET" });
      await who.b.call(patchApp, { method: "PATCH", body: { bio: "x" } });
      const c = await svc
        .from("chefs")
        .select("profile_id")
        .eq("profile_id", who.id);
      const p = await svc
        .from("chef_private")
        .select("chef_id")
        .eq("chef_id", who.id);
      expect(c.data).toEqual([]);
      expect(p.data).toEqual([]);
    }
  });
});

describe("CSRF content-type rule on the state-changing chef routes", () => {
  it.each(ROUTES.filter((r) => r[2] !== "GET"))(
    "%s rejects a missing or non-JSON content type with 400",
    async (_n, h, method, body) => {
      const chef = await newChef();
      for (const contentType of [
        null,
        "text/plain",
        "application/x-www-form-urlencoded",
        "multipart/form-data; boundary=x",
        "application/json-evil",
      ]) {
        const r = await chef.b.call(h, { method, contentType, body });
        expect(r.status, String(contentType)).toBe(400);
        expect(r.body.error.code).toBe("BAD_REQUEST");
      }
    },
  );

  it("a request with no Content-Type header at all and no body is 400 on every state-changing route (tester T1)", async () => {
    // The `null` entry above still sends a string body, and Request adds text/plain itself. This
    // is the bare fetch(url, { method }) a browser sends when the fetch helper is not used.
    const chef = await newChef();
    for (const [name, h, method] of ROUTES.filter((r) => r[2] !== "GET")) {
      const r = await chef.b.call(h, {
        method,
        contentType: null,
        noBody: true,
      });
      expect(r.status, name).toBe(400);
      expect(r.body.error.code, name).toBe("BAD_REQUEST");
    }
  });

  it("PATCH, POST and DELETE with a malformed or non-object JSON body are 400", async () => {
    const chef = await newChef();
    for (const [h, method] of [
      [patchApp, "PATCH"],
      [postDoc, "POST"],
      [deleteDoc, "DELETE"],
    ] as const) {
      expect((await chef.b.call(h, { method, raw: "{nope" })).status).toBe(400);
      expect((await chef.b.call(h, { method, raw: "[1]" })).status).toBe(400);
    }
  });
});

describe("GET /api/chef/application", () => {
  it("returns a new chef's application with defaults, MOCK checks and what is missing", async () => {
    const { b } = await newChef("Chef Lan");
    const r = await b.call(getApp, { method: "GET" });
    expect(r.status, r.text).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.body).toEqual({
      status: "pending",
      displayName: "Chef Lan",
      bio: null,
      photoPath: null,
      cuisines: [],
      languages: [],
      hourlyRateCents: null,
      servicePostalPrefix: null,
      serviceRadiusKm: 15,
      locationOptions: ["customer_home"],
      chefHomeEnabled: false,
      country: "CA",
      currency: "CAD",
      language: "en",
      rejectReason: null,
      checks: {
        id: "not_started",
        foodHandler: "not_started",
        kitchen: "not_started",
        police: "not_started",
      },
      documents: {
        idDocumentPath: null,
        foodHandlerPath: null,
        kitchenPhotoPaths: [],
      },
      kitchenAddress: null,
      allergenAckAt: null,
      kitchenHygieneAckAt: null,
      missing: [
        "bio",
        "photo",
        "cuisines",
        "languages",
        "hourlyRate",
        "servicePostalPrefix",
        "idDocument",
        "foodHandler",
        "allergenAcknowledgement",
        "phoneVerified",
        "sampleDish",
      ],
    });
  });

  it("never returns hashes, the phone number, the email or internal columns", async () => {
    const chef = await newChef();
    await chef.b.call(patchApp, { method: "PATCH", body: { bio: "hello" } });
    const r = await chef.b.call(getApp, { method: "GET" });
    expect(r.text).not.toMatch(
      /hash|phone_e164|updated_at|chef_id|profile_id/i,
    );
    expect(r.text).not.toContain(chef.email);
  });

  it("each chef sees only their own application", async () => {
    const a = await newChef("Chef A");
    const b = await newChef("Chef B");
    await a.b.call(patchApp, { method: "PATCH", body: { bio: "bio of A" } });
    await b.b.call(patchApp, { method: "PATCH", body: { bio: "bio of B" } });
    expect((await application(a.b)).bio).toBe("bio of A");
    expect((await application(b.b)).bio).toBe("bio of B");
  });

  it("repairs a chef whose sign-up was interrupted (both rows missing), idempotently (T-028 N-e)", async () => {
    // A chef-role auth user: the trigger made profiles and profile_private, nothing else.
    const email = newEmail("broken");
    const created = await svc.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: "chef", display_name: "Broken Chef" },
    });
    expect(created.error).toBeNull();
    const id = created.data.user!.id;
    expect(
      (await svc.from("chefs").select("profile_id").eq("profile_id", id)).data,
    ).toEqual([]);
    expect(
      (await svc.from("chef_private").select("chef_id").eq("chef_id", id)).data,
    ).toEqual([]);

    const b = new Browser();
    expect(
      (await b.call(login, { body: { email, password: PASSWORD } })).status,
    ).toBe(200);
    const r = await b.call(getApp, { method: "GET" });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({
      status: "pending",
      displayName: "Broken Chef",
      checks: {
        id: "not_started",
        kitchen: "not_started",
        police: "not_started",
      },
    });
    const chef = await chefRow(id);
    expect(chef).toMatchObject({
      status: "pending",
      display_name: "Broken Chef",
      chef_home_enabled: false,
    });
    const createdAt = (await privRow(id)).created_at;

    // A second GET changes nothing (ON CONFLICT DO NOTHING).
    expect((await b.call(getApp, { method: "GET" })).status).toBe(200);
    expect((await privRow(id)).created_at).toBe(createdAt);
    expect((await chefRow(id)).created_at).toBe(chef.created_at);
  });

  it("repairs a missing chef_private row without touching the existing chefs row", async () => {
    const chef = await newChef("Half Chef");
    await chef.b.call(patchApp, {
      method: "PATCH",
      body: { bio: "keep me", hourlyRateCents: 4200 },
    });
    const del = await svc.from("chef_private").delete().eq("chef_id", chef.id);
    expect(del.error).toBeNull();
    const r = await chef.b.call(getApp, { method: "GET" });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ bio: "keep me", hourlyRateCents: 4200 });
    expect((await privRow(chef.id)).id_check_status).toBe("not_started");
  });

  it("two simultaneous first requests both succeed (no duplicate-key failure)", async () => {
    const email = newEmail("race");
    const created = await svc.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: "chef", display_name: "Race Chef" },
    });
    const id = created.data.user!.id;
    const b = new Browser();
    await b.call(login, { body: { email, password: PASSWORD } });
    const [x, y] = await Promise.all([
      b.call(getApp, { method: "GET" }),
      b.call(getApp, { method: "GET" }),
    ]);
    expect([x.status, y.status]).toEqual([200, 200]);
    const rows = await svc
      .from("chefs")
      .select("profile_id")
      .eq("profile_id", id);
    expect(rows.data).toHaveLength(1);
  });

  it("every other chef route repairs too, so a broken sign-up never ends in a 500", async () => {
    const email = newEmail("broken2");
    const created = await svc.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: "chef", display_name: "Broken Two" },
    });
    const id = created.data.user!.id;
    const b = new Browser();
    await b.call(login, { body: { email, password: PASSWORD } });
    const r = await b.call(patchApp, {
      method: "PATCH",
      body: { bio: "works" },
    });
    expect(r.status, r.text).toBe(200);
    expect((await chefRow(id)).bio).toBe("works");
  });
});

describe("PATCH /api/chef/application: validation (422)", () => {
  it("rejects keys outside the whitelist and changes nothing", async () => {
    const chef = await newChef("Keep Name");
    const before = await chefRow(chef.id);
    for (const key of [
      "displayName",
      "status",
      "chefHomeEnabled",
      "ratingAvg",
      "reviewCount",
      "checks",
      "rejectReason",
      "police",
      "chefId",
      "profileId",
      "userId",
      "role",
      "documents",
      "idDocumentPath",
      "kitchenPhotoPaths",
      "allergenAckAt",
      "country",
    ]) {
      const r = await chef.b.call(patchApp, {
        method: "PATCH",
        body: { [key]: "x" },
      });
      expect(r.status, key).toBe(422);
      expect(r.body.error.code).toBe("VALIDATION_FAILED");
      expect(r.body.error.fields[key], key).toBeTruthy();
    }
    expect(await chefRow(chef.id)).toEqual(before);
  });

  it("reports every bad field at once with the request's field names", async () => {
    const chef = await newChef();
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: {
        bio: "x".repeat(2001),
        cuisines: [],
        languages: ["x".repeat(41)],
        hourlyRateCents: 100,
        servicePostalPrefix: "12",
        serviceRadiusKm: 0,
        locationOptions: ["admin"],
        kitchenAddress: { line: "", city: "", postalCode: "12345" },
        acknowledgeAllergenStatement: false,
        acknowledgeKitchenHygiene: "true",
      },
    });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.error.fields).sort()).toEqual(
      [
        "acknowledgeAllergenStatement",
        "acknowledgeKitchenHygiene",
        "bio",
        "cuisines",
        "hourlyRateCents",
        "kitchenAddress.city",
        "kitchenAddress.line",
        "kitchenAddress.postalCode",
        "languages",
        "locationOptions",
        "serviceRadiusKm",
        "servicePostalPrefix",
      ].sort(),
    );
  });

  it("hourly rate bounds: 499 and 20001 are refused, 500 and 20000 are accepted", async () => {
    const chef = await newChef();
    for (const bad of [499, 20001, 0, -5, 30.5, "3000"]) {
      const r = await chef.b.call(patchApp, {
        method: "PATCH",
        body: { hourlyRateCents: bad },
      });
      expect(r.status, String(bad)).toBe(422);
    }
    expect((await chefRow(chef.id)).hourly_rate_cents).toBeNull();
    for (const ok of [500, 20000]) {
      const r = await chef.b.call(patchApp, {
        method: "PATCH",
        body: { hourlyRateCents: ok },
      });
      expect(r.status, String(ok)).toBe(200);
      expect(r.body.hourlyRateCents).toBe(ok);
    }
  });

  it("location options: a non-empty subset of customer_home and chef_home", async () => {
    const chef = await newChef();
    for (const bad of [
      [],
      ["x"],
      ["customer_home", "admin"],
      "customer_home",
      null,
    ]) {
      const r = await chef.b.call(patchApp, {
        method: "PATCH",
        body: { locationOptions: bad },
      });
      expect(r.status, JSON.stringify(bad)).toBe(422);
    }
    expect((await chefRow(chef.id)).location_options).toEqual([
      "customer_home",
    ]);
    for (const ok of [
      ["chef_home"],
      ["customer_home", "chef_home"],
      ["customer_home"],
    ]) {
      const r = await chef.b.call(patchApp, {
        method: "PATCH",
        body: { locationOptions: ok },
      });
      expect(r.status, JSON.stringify(ok)).toBe(200);
      expect(r.body.locationOptions).toEqual(ok);
    }
  });

  it("service area and kitchen postal code must be in the GTA table; lower case is accepted", async () => {
    const chef = await newChef();
    const bad = await chef.b.call(patchApp, {
      method: "PATCH",
      body: {
        servicePostalPrefix: "K1A",
        kitchenAddress: {
          line: "1 Main St",
          city: "Ottawa",
          postalCode: "K1A 0B1",
        },
      },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields.servicePostalPrefix).toBe(
      "Not a GTA postal code area.",
    );
    expect(bad.body.error.fields["kitchenAddress.postalCode"]).toBe(
      "Not a GTA postal code.",
    );
    const ok = await chef.b.call(patchApp, {
      method: "PATCH",
      body: {
        servicePostalPrefix: "l5c",
        kitchenAddress: {
          line: "1 Main St",
          city: "Mississauga",
          postalCode: "l5c 1a1",
        },
      },
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.servicePostalPrefix).toBe("L5C");
    expect(ok.body.kitchenAddress).toEqual({
      line: "1 Main St",
      city: "Mississauga",
      postalCode: "L5C1A1",
    });
  });

  it("acknowledgements accept only true", async () => {
    const chef = await newChef();
    for (const key of [
      "acknowledgeAllergenStatement",
      "acknowledgeKitchenHygiene",
    ])
      for (const bad of [false, "true", 1, null]) {
        const r = await chef.b.call(patchApp, {
          method: "PATCH",
          body: { [key]: bad },
        });
        expect(r.status, `${key}=${String(bad)}`).toBe(422);
      }
    const priv = await privRow(chef.id);
    expect(priv.allergen_ack_at).toBeNull();
    expect(priv.kitchen_hygiene_ack_at).toBeNull();
  });

  it("bio and other text with NUL, control characters or a lone surrogate is 422, never a database error (tester F1)", async () => {
    const chef = await newChef();
    for (const bio of [
      "a\u0000b",
      "\u0000",
      "x\u0001y",
      "tab ok\u007f",
      "a\ud800",
      "\udc00b",
    ]) {
      const r = await chef.b.call(patchApp, { method: "PATCH", body: { bio } });
      expect(r.status, JSON.stringify(bio)).toBe(422);
      expect(r.body.error.code).toBe("VALIDATION_FAILED");
      expect(r.body.error.fields.bio).toBeTruthy();
    }
    for (const body of [
      { cuisines: ["bad\u0000name"] },
      { languages: ["x\ud800"] },
      {
        kitchenAddress: {
          line: "1 A St\u0000",
          city: "Mississauga",
          postalCode: "L5B1A1",
        },
      },
      {
        kitchenAddress: {
          line: "1 A St",
          city: "Mis\ud800",
          postalCode: "L5B1A1",
        },
      },
    ]) {
      const r = await chef.b.call(patchApp, { method: "PATCH", body });
      expect(r.status, JSON.stringify(body)).toBe(422);
    }
    expect((await chefRow(chef.id)).bio).toBeNull();
    // line breaks, tabs and real emoji are fine
    const ok = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { bio: "Line one\nLine two\twith a tab \u{1F35C}" },
    });
    expect(ok.status, ok.text).toBe(200);
    expect((await chefRow(chef.id)).bio).toBe(
      "Line one\nLine two\twith a tab \u{1F35C}",
    );
  });

  it("a validation failure writes nothing, even for the valid fields in the same request", async () => {
    const chef = await newChef();
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { bio: "should not be saved", hourlyRateCents: 1 },
    });
    expect(r.status).toBe(422);
    expect((await chefRow(chef.id)).bio).toBeNull();
  });
});

describe("PATCH /api/chef/application: saving", () => {
  it("an empty body is 200 and changes nothing", async () => {
    const chef = await newChef();
    const before = await application(chef.b);
    const r = await chef.b.call(patchApp, { method: "PATCH", body: {} });
    expect(r.status).toBe(200);
    expect(r.body).toEqual(before);
  });

  it("saves trimmed, de-duplicated, normalized values and returns the new state", async () => {
    const chef = await newChef();
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: {
        bio: "  I cook pho.  ",
        cuisines: [" Vietnamese ", "vietnamese", "Thai"],
        languages: ["English", "Vietnamese"],
        hourlyRateCents: 3500,
        servicePostalPrefix: " l5b ",
        serviceRadiusKm: 25,
        locationOptions: ["customer_home", "customer_home"],
      },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({
      bio: "I cook pho.",
      cuisines: ["Vietnamese", "Thai"],
      languages: ["English", "Vietnamese"],
      hourlyRateCents: 3500,
      servicePostalPrefix: "L5B",
      serviceRadiusKm: 25,
      locationOptions: ["customer_home"],
    });
    const row = await chefRow(chef.id);
    expect(row).toMatchObject({
      bio: "I cook pho.",
      cuisines: ["Vietnamese", "Thai"],
      hourly_rate_cents: 3500,
      service_postal_prefix: "L5B",
      service_radius_km: 25,
    });
    // moderation columns untouched
    expect(row).toMatchObject({
      status: "pending",
      chef_home_enabled: false,
      rating_avg: 0,
      review_count: 0,
    });
  });

  it("bio can be cleared with null or a blank string", async () => {
    const chef = await newChef();
    await chef.b.call(patchApp, { method: "PATCH", body: { bio: "x" } });
    expect(
      (await chef.b.call(patchApp, { method: "PATCH", body: { bio: null } }))
        .body.bio,
    ).toBeNull();
    await chef.b.call(patchApp, { method: "PATCH", body: { bio: "y" } });
    expect(
      (await chef.b.call(patchApp, { method: "PATCH", body: { bio: "   " } }))
        .body.bio,
    ).toBeNull();
  });

  it("only touches the caller's own rows", async () => {
    const a = await newChef("Chef A");
    const other = await newChef("Chef Other");
    const before = await chefRow(other.id);
    const r = await a.b.call(patchApp, {
      method: "PATCH",
      body: { bio: "mine", hourlyRateCents: 9000 },
    });
    expect(r.status).toBe(200);
    expect(await chefRow(other.id)).toEqual(before);
    // naming another chef is just an unknown key
    const named = await a.b.call(patchApp, {
      method: "PATCH",
      body: { chefId: other.id, bio: "x" },
    });
    expect(named.status).toBe(422);
  });

  it("acknowledgements get the server clock time, and the first time is kept", async () => {
    const chef = await newChef();
    const t0 = Date.now();
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: {
        acknowledgeAllergenStatement: true,
        acknowledgeKitchenHygiene: true,
      },
    });
    const t1 = Date.now();
    expect(r.status, r.text).toBe(200);
    for (const key of ["allergenAckAt", "kitchenHygieneAckAt"]) {
      const at = Date.parse(r.body[key]);
      expect(at, key).toBeGreaterThanOrEqual(t0 - 1000);
      expect(at, key).toBeLessThanOrEqual(t1 + 1000);
    }
    const first = r.body.allergenAckAt;
    await new Promise((res) => setTimeout(res, 20));
    const again = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { acknowledgeAllergenStatement: true },
    });
    expect(again.body.allergenAckAt).toBe(first);
  });

  it("a client cannot send its own acknowledgement time", async () => {
    const chef = await newChef();
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: {
        allergenAckAt: "2001-01-01T00:00:00Z",
        acknowledgeAllergenStatement: true,
      },
    });
    expect(r.status).toBe(422);
    expect((await privRow(chef.id)).allergen_ack_at).toBeNull();
  });

  it("a rejected chef may edit and stays rejected with the reason visible; an approved chef stays approved", async () => {
    const rej = await newChef();
    await setChef(rej.id, { status: "rejected" });
    await setPriv(rej.id, { reject_reason: "Photo unclear" });
    const r = await rej.b.call(patchApp, {
      method: "PATCH",
      body: { bio: "fixed" },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      status: "rejected",
      rejectReason: "Photo unclear",
      bio: "fixed",
    });

    const appr = await newChef();
    await setChef(appr.id, { status: "approved" });
    const r2 = await appr.b.call(patchApp, {
      method: "PATCH",
      body: { bio: "still public" },
    });
    expect(r2.status).toBe(200);
    expect(r2.body.status).toBe("approved");
    expect((await chefRow(appr.id)).status).toBe("approved");
  });
});

describe("PATCH profile photoPath (storage path rule)", () => {
  it("accepts an uploaded photo in the caller's folder and can clear it", async () => {
    const chef = await newChef();
    const p = photoPath(chef.id, "jpg");
    await upload("profile-photos", p);
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { photoPath: p },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.photoPath).toBe(p);
    expect((await chefRow(chef.id)).photo_path).toBe(p);
    const cleared = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { photoPath: null },
    });
    expect(cleared.body.photoPath).toBeNull();
  });

  it("422 when the object was never uploaded", async () => {
    const chef = await newChef();
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { photoPath: photoPath(chef.id) },
    });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.photoPath).toBeTruthy();
    expect((await chefRow(chef.id)).photo_path).toBeNull();
  });

  it("403 for another chef's folder, even when that object exists; nothing changes", async () => {
    const chef = await newChef();
    const victim = await newChef();
    const theirs = photoPath(victim.id);
    await upload("profile-photos", theirs);
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { bio: "should not be saved", photoPath: theirs },
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
    const row = await chefRow(chef.id);
    expect(row.photo_path).toBeNull();
    expect(row.bio).toBeNull();
    expect((await chefRow(victim.id)).photo_path).toBeNull();
    // a missing object in another folder gives the same answer (no way to probe foreign files)
    const missing = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { photoPath: photoPath(victim.id) },
    });
    expect(missing.status).toBe(403);
  });

  it("path traversal and odd paths are 422, never saved", async () => {
    const chef = await newChef();
    const victim = await newChef();
    const theirs = photoPath(victim.id);
    await upload("profile-photos", theirs);
    for (const p of [
      `${chef.id}/../${theirs}`,
      `${chef.id}/../${victim.id}/${theirs.split("/")[1]}`,
      `${chef.id}/..`,
      `/${chef.id}/photo-${uuid()}.png`,
      `${chef.id}\\photo-${uuid()}.png`,
      `${chef.id}//photo-${uuid()}.png`,
      `${chef.id}/photo-${uuid()}.png/../../x`,
      `${chef.id}/id-${uuid()}.png`, // another kind's name
      `${chef.id}/photo-${uuid()}.exe`,
      `${chef.id}/photo.png`,
      "",
    ]) {
      const r = await chef.b.call(patchApp, {
        method: "PATCH",
        body: { photoPath: p },
      });
      expect(r.status, JSON.stringify(p)).toBe(422);
    }
    expect((await chefRow(chef.id)).photo_path).toBeNull();
  });

  it("the file must be in the profile-photos bucket, not another bucket", async () => {
    const chef = await newChef();
    const p = photoPath(chef.id);
    await upload("dish-photos", p); // right name, wrong bucket
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { photoPath: p },
    });
    expect(r.status).toBe(422);
  });
});

describe("PATCH: MOCK re-verification reset for the kitchen (N1)", () => {
  const OLD = {
    line: "1 Old Street",
    city: "Mississauga",
    postalCode: "L5B1A1",
  };

  async function chefWithKitchen(
    kitchen: string,
    options: string[] = ["customer_home", "chef_home"],
  ) {
    const chef = await newChef();
    await setChef(chef.id, {
      location_options: options,
      chef_home_enabled: true,
    });
    await setPriv(chef.id, {
      kitchen_status: kitchen,
      id_check_status: "verified",
      food_handler_status: "verified",
      kitchen_address_line: OLD.line,
      kitchen_city: OLD.city,
      kitchen_postal_code: OLD.postalCode,
    });
    return chef;
  }

  it.each(CHECK_STATUSES)(
    "a new kitchen address with kitchen check %s: check -> expected status, chef's home off, documents untouched",
    async (status) => {
      const chef = await chefWithKitchen(status);
      const r = await chef.b.call(patchApp, {
        method: "PATCH",
        body: {
          kitchenAddress: {
            line: "2 New Street",
            city: "Mississauga",
            postalCode: "L5B 1A1",
          },
        },
      });
      expect(r.status, r.text).toBe(200);
      expect(r.body.checks.kitchen).toBe(AFTER_CHANGE[status]);
      expect(r.body.chefHomeEnabled).toBe(false);
      expect(r.body.checks.id).toBe("verified");
      expect(r.body.checks.foodHandler).toBe("verified");
      const priv = await privRow(chef.id);
      expect(priv.kitchen_status).toBe(AFTER_CHANGE[status]);
      expect(priv.kitchen_address_line).toBe("2 New Street");
      expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
    },
  );

  it.each([
    [
      "line",
      { line: "9 Other Road", city: "Mississauga", postalCode: "L5B 1A1" },
    ],
    ["city", { line: "1 Old Street", city: "Toronto", postalCode: "L5B 1A1" }],
    [
      "postal code",
      { line: "1 Old Street", city: "Mississauga", postalCode: "L5C 1A1" },
    ],
  ])(
    "a changed %s alone resets a verified kitchen",
    async (_n, kitchenAddress) => {
      const chef = await chefWithKitchen("verified");
      const r = await chef.b.call(patchApp, {
        method: "PATCH",
        body: { kitchenAddress },
      });
      expect(r.status, r.text).toBe(200);
      expect(r.body.checks.kitchen).toBe("pending");
      expect(r.body.chefHomeEnabled).toBe(false);
    },
  );

  it("sending the same address again (any spacing or case) does not reset anything", async () => {
    const chef = await chefWithKitchen("verified");
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: {
        kitchenAddress: {
          line: " 1 Old Street ",
          city: "Mississauga ",
          postalCode: "l5b1a1",
        },
      },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.checks.kitchen).toBe("verified");
    expect(r.body.chefHomeEnabled).toBe(true);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(true);
  });

  it("edits unrelated to the kitchen leave every check and chef's home alone", async () => {
    const chef = await chefWithKitchen("verified");
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: {
        bio: "new bio",
        hourlyRateCents: 4000,
        cuisines: ["Thai"],
        locationOptions: ["customer_home", "chef_home"],
        acknowledgeKitchenHygiene: true,
      },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.checks).toMatchObject({
      id: "verified",
      foodHandler: "verified",
      kitchen: "verified",
    });
    expect(r.body.chefHomeEnabled).toBe(true);
  });

  it("a kitchen change resets the check and chef's home even when chef's home is not currently offered (tester T2)", async () => {
    const chef = await chefWithKitchen("verified", ["customer_home"]);
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: {
        kitchenAddress: {
          line: "2 New Street",
          city: "Mississauga",
          postalCode: "L5B 1A1",
        },
      },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.checks.kitchen).toBe("pending");
    expect(r.body.chefHomeEnabled).toBe(false);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
  });

  it("removing chef_home from locationOptions touches neither chef's home nor the kitchen check, and adding it back needs no admin (tester T3)", async () => {
    const chef = await chefWithKitchen("verified");
    const off = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { locationOptions: ["customer_home"] },
    });
    expect(off.status, off.text).toBe(200);
    expect(off.body.locationOptions).toEqual(["customer_home"]);
    expect(off.body.checks.kitchen).toBe("verified");
    expect(off.body.chefHomeEnabled).toBe(true);
    const on = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { locationOptions: ["customer_home", "chef_home"] },
    });
    expect(on.body.checks.kitchen).toBe("verified");
    expect(on.body.chefHomeEnabled).toBe(true);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(true);
  });

  it("remove chef_home, change the kitchen, add chef_home back: the kitchen still needs a new review (no bypass)", async () => {
    const chef = await chefWithKitchen("verified");
    await chef.b.call(patchApp, {
      method: "PATCH",
      body: { locationOptions: ["customer_home"] },
    });
    const edit = await chef.b.call(patchApp, {
      method: "PATCH",
      body: {
        kitchenAddress: {
          line: "99 Sneaky Road",
          city: "Mississauga",
          postalCode: "L5B 1A1",
        },
      },
    });
    expect(edit.body.checks.kitchen).toBe("pending");
    expect(edit.body.chefHomeEnabled).toBe(false);
    const back = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { locationOptions: ["customer_home", "chef_home"] },
    });
    expect(back.body.checks.kitchen).toBe("pending");
    expect(back.body.chefHomeEnabled).toBe(false);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
  });

  it("the police check is never touched by the chef", async () => {
    const chef = await chefWithKitchen("verified");
    await setPriv(chef.id, { police_check_status: "verified" });
    await chef.b.call(patchApp, {
      method: "PATCH",
      body: {
        kitchenAddress: {
          line: "7 Another St",
          city: "Mississauga",
          postalCode: "L5B 1A1",
        },
      },
    });
    expect((await privRow(chef.id)).police_check_status).toBe("verified");
  });
});

describe("responses never carry other people's data", () => {
  it("/api/me for a chef still works after application edits", async () => {
    const chef = await newChef("Chef Me");
    await chef.b.call(patchApp, {
      method: "PATCH",
      body: { hourlyRateCents: 5000 },
    });
    const me = await chef.b.call(getMe, { method: "GET" });
    expect(me.status).toBe(200);
    expect(me.body.chef.hourlyRateCents).toBe(5000);
  });

  it("no route response holds the chef's phone, home address, email or any hash (tester T6)", async () => {
    const chef = await readyChef({ chefHome: true });
    const home = await chef.b.call(putAddress, {
      method: "PUT",
      body: {
        line: "100 Private Avenue",
        city: "Mississauga",
        postalCode: "L5C 1A1",
      },
    });
    expect(home.status, home.text).toBe(200);
    const newId = idPath(chef.id);
    await upload("chef-documents", newId);
    const replies: [string, string][] = [];
    const record = async (name: string, p: ReturnType<Browser["call"]>) => {
      const r = await p;
      replies.push([`${name} ${r.status}`, r.text]);
      return r;
    };
    await record("GET", chef.b.call(getApp, { method: "GET" }));
    await record(
      "PATCH",
      chef.b.call(patchApp, { method: "PATCH", body: { bio: "new bio" } }),
    );
    await record(
      "POST documents",
      chef.b.call(postDoc, { body: { kind: "id_document", path: newId } }),
    );
    await record("POST submit", chef.b.call(submit));
    await record(
      "DELETE documents",
      chef.b.call(deleteDoc, {
        method: "DELETE",
        body: { kind: "kitchen_photo", path: chef.kitchen },
      }),
    );
    // the application is now incomplete (no kitchen photo), so this is the 409 body
    const incomplete = await record("POST submit (409)", chef.b.call(submit));
    expect(incomplete.status).toBe(409);
    expect(replies).toHaveLength(6);

    const forbidden = [
      chef.phoneNumber,
      chef.phoneNumber.slice(2),
      "+1******",
      chef.email,
      "100 Private",
      "L5C1A1",
      "L5C 1A1",
      "phone_e164",
      "address_line",
    ];
    for (const [name, text] of replies) {
      for (const f of forbidden)
        expect(
          text,
          `${name} must not contain ${f.slice(0, 6)}...`,
        ).not.toContain(f);
      expect(text, name).not.toMatch(/hash/i);
    }
  });
});
