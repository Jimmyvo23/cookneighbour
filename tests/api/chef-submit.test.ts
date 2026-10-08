import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import {
  CHECK_STATUSES,
  chefRow,
  newChef,
  patchApp,
  privRow,
  readyChef,
  setChef,
  setPriv,
  submit,
  svc,
  type CheckStatus,
} from "./chef-helpers";

beforeEach(() => freshLimits());

const NEW_CHEF_MISSING = [
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
];

/** What submit does to each starting check status (N2: only not_started and failed move). */
const AFTER_SUBMIT: Record<CheckStatus, CheckStatus> = {
  not_started: "pending",
  pending: "pending",
  verified: "verified",
  failed: "pending",
};

describe("POST /api/chef/application/submit: incomplete applications (409)", () => {
  it("lists everything that is missing for a new chef and changes nothing", async () => {
    const chef = await newChef();
    const r = await chef.b.call(submit);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("APPLICATION_INCOMPLETE");
    expect(r.body.error.missing).toEqual(NEW_CHEF_MISSING);
    const priv = await privRow(chef.id);
    expect(priv).toMatchObject({
      id_check_status: "not_started",
      food_handler_status: "not_started",
      kitchen_status: "not_started",
    });
    expect((await chefRow(chef.id)).status).toBe("pending");
  });

  it("adds the kitchen items when chef's home is offered", async () => {
    const chef = await newChef();
    await chef.b.call(patchApp, {
      method: "PATCH",
      body: { locationOptions: ["customer_home", "chef_home"] },
    });
    const r = await chef.b.call(submit);
    expect(r.status).toBe(409);
    expect(r.body.error.missing).toEqual([
      ...NEW_CHEF_MISSING,
      "kitchenAddress",
      "kitchenPhotos",
      "kitchenHygieneAcknowledgement",
    ]);
  });

  const BREAKERS: [string, string, (id: string) => Promise<void>][] = [
    [
      "displayName",
      "the placeholder display name",
      async (id) => setChef(id, { display_name: "New user" }),
    ],
    ["bio", "a blank bio", async (id) => setChef(id, { bio: "   " })],
    [
      "photo",
      "no profile photo",
      async (id) => setChef(id, { photo_path: null }),
    ],
    ["cuisines", "no cuisines", async (id) => setChef(id, { cuisines: [] })],
    ["languages", "no languages", async (id) => setChef(id, { languages: [] })],
    [
      "hourlyRate",
      "no hourly rate",
      async (id) => setChef(id, { hourly_rate_cents: null }),
    ],
    [
      "servicePostalPrefix",
      "no service area",
      async (id) => setChef(id, { service_postal_prefix: null }),
    ],
    [
      "idDocument",
      "no ID document",
      async (id) => setPriv(id, { id_document_path: null }),
    ],
    [
      "foodHandler",
      "no food-handler certificate",
      async (id) => setPriv(id, { food_handler_path: null }),
    ],
    [
      "allergenAcknowledgement",
      "no allergen acknowledgement",
      async (id) => setPriv(id, { allergen_ack_at: null }),
    ],
    [
      "phoneVerified",
      "an unverified phone (MOCK SMS)",
      async (id) => {
        const r = await svc
          .from("profile_private")
          .update({ phone_verified: false })
          .eq("profile_id", id);
        expect(r.error).toBeNull();
      },
    ],
    [
      "sampleDish",
      "no active dish",
      async (id) => {
        const r = await svc
          .from("dishes")
          .update({ is_active: false })
          .eq("chef_id", id);
        expect(r.error).toBeNull();
      },
    ],
  ];
  it.each(BREAKERS)(
    "names exactly %s when the only problem is %s",
    async (item, _why, breakIt) => {
      const chef = await readyChef();
      await breakIt(chef.id);
      const r = await chef.b.call(submit);
      expect(r.status, r.text).toBe(409);
      expect(r.body.error.code).toBe("APPLICATION_INCOMPLETE");
      expect(r.body.error.missing).toEqual([item]);
    },
  );

  it("a dish without a photo is not a sample menu", async () => {
    const chef = await readyChef();
    const r0 = await svc
      .from("dishes")
      .update({ photo_path: null })
      .eq("chef_id", chef.id);
    expect(r0.error).toBeNull();
    const r = await chef.b.call(submit);
    expect(r.body.error.missing).toEqual(["sampleDish"]);
  });

  it("another chef's dish does not count", async () => {
    const chef = await readyChef();
    const other = await readyChef();
    const r0 = await svc
      .from("dishes")
      .update({ is_active: false })
      .eq("chef_id", chef.id);
    expect(r0.error).toBeNull();
    expect(
      (await svc.from("dishes").select("id").eq("chef_id", other.id)).data,
    ).toHaveLength(1);
    const r = await chef.b.call(submit);
    expect(r.body.error.missing).toEqual(["sampleDish"]);
  });

  it.each([
    [
      "kitchenAddress",
      (id: string) => setPriv(id, { kitchen_address_line: null }),
    ],
    ["kitchenPhotos", (id: string) => setPriv(id, { kitchen_photo_paths: [] })],
    [
      "kitchenHygieneAcknowledgement",
      (id: string) => setPriv(id, { kitchen_hygiene_ack_at: null }),
    ],
  ])(
    "with chef's home, names %s when it is the only gap",
    async (item, breakIt) => {
      const chef = await readyChef({ chefHome: true });
      await breakIt(chef.id);
      const r = await chef.b.call(submit);
      expect(r.status, r.text).toBe(409);
      expect(r.body.error.missing).toEqual([item]);
    },
  );

  it("a rejected chef with an incomplete application stays rejected and keeps the reason", async () => {
    const chef = await newChef();
    await setChef(chef.id, { status: "rejected" });
    await setPriv(chef.id, { reject_reason: "Photo unclear" });
    const r = await chef.b.call(submit);
    expect(r.status).toBe(409);
    expect((await chefRow(chef.id)).status).toBe("rejected");
    expect((await privRow(chef.id)).reject_reason).toBe("Photo unclear");
  });
});

describe("POST /api/chef/application/submit: complete applications", () => {
  it("moves not_started checks to pending, returns mock: true, and keeps the chef pending", async () => {
    const chef = await readyChef();
    const r = await chef.b.call(submit);
    expect(r.status, r.text).toBe(200);
    expect(r.body.mock).toBe(true);
    expect(r.body.application.status).toBe("pending");
    expect(r.body.application.missing).toEqual([]);
    expect(r.body.application.checks).toEqual({
      id: "pending",
      foodHandler: "pending",
      kitchen: "not_started", // customer's home only: no kitchen review
      police: "not_started",
    });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it.each(CHECK_STATUSES)("an ID check that is %s", async (status) => {
    const chef = await readyChef();
    await setPriv(chef.id, { id_check_status: status });
    const r = await chef.b.call(submit);
    expect(r.status, r.text).toBe(200);
    expect(r.body.application.checks.id).toBe(AFTER_SUBMIT[status]);
    expect((await privRow(chef.id)).id_check_status).toBe(AFTER_SUBMIT[status]);
  });

  it.each(CHECK_STATUSES)("a food-handler check that is %s", async (status) => {
    const chef = await readyChef();
    await setPriv(chef.id, { food_handler_status: status });
    const r = await chef.b.call(submit);
    expect(r.status, r.text).toBe(200);
    expect(r.body.application.checks.foodHandler).toBe(AFTER_SUBMIT[status]);
  });

  it.each(CHECK_STATUSES)(
    "a kitchen check that is %s moves only when chef's home is offered",
    async (status) => {
      const without = await readyChef();
      await setPriv(without.id, { kitchen_status: status });
      const r1 = await without.b.call(submit);
      expect(r1.status, r1.text).toBe(200);
      expect(r1.body.application.checks.kitchen).toBe(status);

      const withHome = await readyChef({ chefHome: true });
      await setPriv(withHome.id, { kitchen_status: status });
      const r2 = await withHome.b.call(submit);
      expect(r2.status, r2.text).toBe(200);
      expect(r2.body.application.checks.kitchen).toBe(AFTER_SUBMIT[status]);
    },
  );

  it("never touches the police check or chef's home", async () => {
    const chef = await readyChef({ chefHome: true });
    await setPriv(chef.id, { police_check_status: "verified" });
    await setChef(chef.id, { chef_home_enabled: true });
    const r = await chef.b.call(submit);
    expect(r.status, r.text).toBe(200);
    expect(r.body.application.checks.police).toBe("verified");
    expect(r.body.application.chefHomeEnabled).toBe(true);
  });

  it("is idempotent: a second submit changes nothing and still returns 200", async () => {
    const chef = await readyChef();
    const first = await chef.b.call(submit);
    const before = await privRow(chef.id);
    const second = await chef.b.call(submit);
    expect(second.status, second.text).toBe(200);
    expect(second.body.application).toEqual(first.body.application);
    expect(await privRow(chef.id)).toEqual(before); // not even updated_at moved
  });

  it("a rejected chef goes back to pending, the reason is cleared and failed checks restart", async () => {
    const chef = await readyChef();
    await setChef(chef.id, { status: "rejected" });
    await setPriv(chef.id, {
      reject_reason: "ID photo unreadable",
      id_check_status: "failed",
      food_handler_status: "verified",
    });
    const r = await chef.b.call(submit);
    expect(r.status, r.text).toBe(200);
    expect(r.body.application).toMatchObject({
      status: "pending",
      rejectReason: null,
      checks: { id: "pending", foodHandler: "verified" },
    });
    expect((await chefRow(chef.id)).status).toBe("pending");
    expect((await privRow(chef.id)).reject_reason).toBeNull();
  });

  it("an approved chef gets 409 INVALID_STATE and nothing changes", async () => {
    const chef = await readyChef();
    await setChef(chef.id, { status: "approved" });
    const before = await privRow(chef.id);
    const r = await chef.b.call(submit);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("INVALID_STATE");
    expect((await chefRow(chef.id)).status).toBe("approved");
    expect(await privRow(chef.id)).toEqual(before);
  });

  it("an approved chef that is incomplete still gets INVALID_STATE, not a missing list", async () => {
    const chef = await newChef();
    await setChef(chef.id, { status: "approved" });
    const r = await chef.b.call(submit);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("INVALID_STATE");
  });

  it("needs no body but does need the JSON content type", async () => {
    const chef = await readyChef();
    const noBody = await chef.b.call(submit, { raw: "" });
    expect(noBody.status, noBody.text).toBe(200);
    const bad = await chef.b.call(submit, {
      contentType: "text/plain",
      raw: "",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("BAD_REQUEST");
  });

  it("ignores anything in the body: a client cannot choose statuses", async () => {
    const chef = await readyChef();
    const r = await chef.b.call(submit, {
      body: {
        status: "approved",
        idCheck: "verified",
        id_check_status: "verified",
      },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.application.status).toBe("pending");
    expect(r.body.application.checks.id).toBe("pending");
  });
});
