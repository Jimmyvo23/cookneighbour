import { describe, expect, it } from "vitest";
import type { DocumentKind, MockCheckStatus } from "../api/types";
import {
  MAX_KITCHEN_PHOTOS,
  checkStoragePath,
  computeMissing,
  parseUpdateBody,
  planPrivateChange,
  planSubmit,
  resetMockCheck,
  sameKitchenAddress,
  type MissingInput,
  type PrivateState,
} from "./chef-application";

const CHEF = "1111111a-2222-4333-8444-55555555555b";
const OTHER = "99999999-2222-4333-8444-555555555555";
const U1 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ALL: MockCheckStatus[] = ["not_started", "pending", "verified", "failed"];

describe("checkStoragePath (contract section 2, rule 7)", () => {
  const ok = (kind: DocumentKind | "profile_photo", file: string) =>
    checkStoragePath(kind, CHEF, `${CHEF}/${file}`);

  it("accepts the documented name for each kind and names the bucket", () => {
    expect(ok("id_document", `id-${U1}.pdf`)).toEqual({
      ok: true,
      bucket: "chef-documents",
      path: `${CHEF}/id-${U1}.pdf`,
    });
    expect(ok("food_handler", `food-handler-${U1}.png`)).toMatchObject({
      ok: true,
      bucket: "chef-documents",
    });
    expect(ok("kitchen_photo", `kitchen-${U1}.webp`)).toMatchObject({
      ok: true,
      bucket: "kitchen-photos",
    });
    expect(ok("profile_photo", `photo-${U1}.jpeg`)).toMatchObject({
      ok: true,
      bucket: "profile-photos",
    });
  });

  it("allows only the file types the bucket accepts", () => {
    expect(ok("id_document", `id-${U1}.webp`)).toMatchObject({
      ok: false,
      kind: "invalid",
    });
    expect(ok("kitchen_photo", `kitchen-${U1}.pdf`)).toMatchObject({
      ok: false,
      kind: "invalid",
    });
    expect(ok("profile_photo", `photo-${U1}.gif`)).toMatchObject({
      ok: false,
      kind: "invalid",
    });
  });

  it("requires lower case: names the app does not generate are refused (tester F6)", () => {
    for (const file of [
      `ID-${U1}.png`,
      `Id-${U1}.png`,
      `id-${U1.toUpperCase()}.png`,
      `id-${U1}.PNG`,
      `id-${U1}.Png`,
    ])
      expect(ok("id_document", file), file).toMatchObject({
        ok: false,
        kind: "invalid",
      });
    expect(ok("food_handler", `FOOD-HANDLER-${U1}.pdf`)).toMatchObject({
      ok: false,
    });
    expect(ok("kitchen_photo", `kitchen-${U1}.JPG`)).toMatchObject({
      ok: false,
    });
    expect(ok("profile_photo", `photo-${U1.toUpperCase()}.webp`)).toMatchObject(
      { ok: false },
    );
    // the same name in lower case is fine
    expect(ok("id_document", `id-${U1}.png`)).toMatchObject({ ok: true });
  });

  it("rejects a name that belongs to another kind", () => {
    expect(ok("id_document", `kitchen-${U1}.png`)).toMatchObject({
      ok: false,
      kind: "invalid",
    });
    expect(ok("food_handler", `id-${U1}.png`)).toMatchObject({
      ok: false,
      kind: "invalid",
    });
    expect(ok("kitchen_photo", `photo-${U1}.png`)).toMatchObject({
      ok: false,
      kind: "invalid",
    });
  });

  it("treats any folder other than the caller's own as foreign (403 case)", () => {
    for (const p of [
      `${OTHER}/id-${U1}.png`,
      `${CHEF.toUpperCase()}/id-${U1}.png`,
      `id-${U1}.png`,
      `${CHEF}x/id-${U1}.png`,
    ])
      expect(checkStoragePath("id_document", CHEF, p), p).toMatchObject({
        ok: false,
        kind: "foreign",
      });
  });

  it("rejects traversal and odd characters as invalid, even under the caller's own folder", () => {
    for (const p of [
      `${CHEF}/../${OTHER}/id-${U1}.png`,
      `${OTHER}/../${CHEF}/id-${U1}.png`,
      `${CHEF}/..`,
      `/${CHEF}/id-${U1}.png`,
      `${CHEF}\\id-${U1}.png`,
      `${CHEF}/id-${U1}.png\n`,
      `${CHEF}/id-${U1}.png\u0000`,
      `${CHEF}//id-${U1}.png`,
      `${CHEF}/sub/id-${U1}.png`,
      `${CHEF}/id-${U1}.png/`,
      `${CHEF}/id-${U1}.png?x=1`,
      `${CHEF}/id-${U1}.png#x`,
      `${CHEF}/id-%2e%2e.png`,
      "",
      " ",
      "x".repeat(500),
    ])
      expect(
        checkStoragePath("id_document", CHEF, p),
        JSON.stringify(p),
      ).toMatchObject({
        ok: false,
      });
    // traversal is "invalid" (422), never "foreign" (403), so the message does not suggest a real folder
    expect(
      checkStoragePath("id_document", CHEF, `${OTHER}/../x`),
    ).toMatchObject({ kind: "invalid" });
  });

  it("rejects non-strings", () => {
    for (const v of [undefined, null, 5, {}, [], true])
      expect(checkStoragePath("id_document", CHEF, v)).toMatchObject({
        ok: false,
        kind: "invalid",
      });
  });
});

describe("resetMockCheck (N1 plus the Planner decision on failed documents)", () => {
  it.each([
    ["verified", "pending"],
    ["failed", "pending"],
    ["pending", "pending"],
    ["not_started", "not_started"],
  ] as const)("%s becomes %s", (from, to) => {
    expect(resetMockCheck(from)).toBe(to);
  });
});

function state(over: Partial<PrivateState> = {}): PrivateState {
  return {
    idDocumentPath: `${CHEF}/id-${U1}.png`,
    foodHandlerPath: `${CHEF}/food-handler-${U1}.png`,
    kitchenPhotoPaths: [`${CHEF}/kitchen-${U1}.png`],
    kitchenAddress: {
      line: "1 Fake St",
      city: "Mississauga",
      postalCode: "L5B1A1",
    },
    idCheck: "verified",
    foodHandlerCheck: "verified",
    kitchenCheck: "verified",
    ...over,
  };
}

describe("planPrivateChange: re-verification reset", () => {
  const NEW_ID = `${CHEF}/id-bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;
  const NEW_FH = `${CHEF}/food-handler-bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;
  const NEW_K = `${CHEF}/kitchen-bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;

  it.each(ALL)("changed ID document with id check %s", (idCheck) => {
    const plan = planPrivateChange(state({ idCheck }), {
      idDocumentPath: NEW_ID,
    });
    expect(plan.columns.id_document_path).toBe(NEW_ID);
    if (idCheck === "verified" || idCheck === "failed")
      expect(plan.columns.id_check_status).toBe("pending");
    else expect(plan.columns).not.toHaveProperty("id_check_status");
    // nothing else moves
    expect(plan.columns).not.toHaveProperty("food_handler_status");
    expect(plan.columns).not.toHaveProperty("kitchen_status");
    expect(plan.disableChefHome).toBe(false);
  });

  it.each(ALL)("changed food-handler document with check %s", (check) => {
    const plan = planPrivateChange(state({ foodHandlerCheck: check }), {
      foodHandlerPath: NEW_FH,
    });
    expect(plan.columns.food_handler_path).toBe(NEW_FH);
    if (check === "verified" || check === "failed")
      expect(plan.columns.food_handler_status).toBe("pending");
    else expect(plan.columns).not.toHaveProperty("food_handler_status");
    expect(plan.columns).not.toHaveProperty("id_check_status");
    expect(plan.disableChefHome).toBe(false);
  });

  it("registering the same document path again changes nothing", () => {
    const plan = planPrivateChange(state(), {
      idDocumentPath: state().idDocumentPath!,
      foodHandlerPath: state().foodHandlerPath!,
    });
    expect(plan.columns).toEqual({});
    expect(plan.disableChefHome).toBe(false);
  });

  it.each(ALL)("changed kitchen photos with kitchen check %s", (check) => {
    const plan = planPrivateChange(state({ kitchenCheck: check }), {
      kitchenPhotoPaths: [...state().kitchenPhotoPaths, NEW_K],
    });
    expect(plan.columns.kitchen_photo_paths).toEqual([
      ...state().kitchenPhotoPaths,
      NEW_K,
    ]);
    if (check === "verified" || check === "failed")
      expect(plan.columns.kitchen_status).toBe("pending");
    else expect(plan.columns).not.toHaveProperty("kitchen_status");
    expect(plan.disableChefHome).toBe(true);
  });

  it("removing a kitchen photo is a kitchen change too", () => {
    const plan = planPrivateChange(state(), { kitchenPhotoPaths: [] });
    expect(plan.columns.kitchen_photo_paths).toEqual([]);
    expect(plan.columns.kitchen_status).toBe("pending");
    expect(plan.disableChefHome).toBe(true);
  });

  it("the same photo set (any order) is not a change", () => {
    const s = state({
      kitchenPhotoPaths: [`${CHEF}/kitchen-${U1}.png`, NEW_K],
    });
    const plan = planPrivateChange(s, {
      kitchenPhotoPaths: [NEW_K, `${CHEF}/kitchen-${U1}.png`],
    });
    expect(plan.columns).toEqual({});
    expect(plan.disableChefHome).toBe(false);
  });

  it.each(ALL)("changed kitchen address with kitchen check %s", (check) => {
    const plan = planPrivateChange(state({ kitchenCheck: check }), {
      kitchenAddress: {
        line: "2 Fake St",
        city: "Mississauga",
        postalCode: "L5B1A1",
      },
    });
    expect(plan.columns).toMatchObject({
      kitchen_address_line: "2 Fake St",
      kitchen_city: "Mississauga",
      kitchen_postal_code: "L5B1A1",
    });
    if (check === "verified" || check === "failed")
      expect(plan.columns.kitchen_status).toBe("pending");
    else expect(plan.columns).not.toHaveProperty("kitchen_status");
    expect(plan.disableChefHome).toBe(true);
  });

  it.each([
    ["line", { line: "9 Fake St", city: "Mississauga", postalCode: "L5B1A1" }],
    ["city", { line: "1 Fake St", city: "Toronto", postalCode: "L5B1A1" }],
    [
      "postal code",
      { line: "1 Fake St", city: "Mississauga", postalCode: "L5C1A1" },
    ],
  ])("a changed %s alone counts as an address change", (_n, kitchenAddress) => {
    const plan = planPrivateChange(state(), { kitchenAddress });
    expect(plan.columns.kitchen_status).toBe("pending");
    expect(plan.disableChefHome).toBe(true);
  });

  it("the same address again is not a change (verified stays verified)", () => {
    const plan = planPrivateChange(state(), {
      kitchenAddress: {
        line: "1 Fake St",
        city: "Mississauga",
        postalCode: "L5B1A1",
      },
    });
    expect(plan.columns).toEqual({});
    expect(plan.disableChefHome).toBe(false);
  });

  it("setting a first kitchen address leaves a not_started check alone but still switches chef's home off", () => {
    const plan = planPrivateChange(
      state({ kitchenAddress: null, kitchenCheck: "not_started" }),
      {
        kitchenAddress: {
          line: "1 Fake St",
          city: "Mississauga",
          postalCode: "L5B1A1",
        },
      },
    );
    expect(plan.columns).not.toHaveProperty("kitchen_status");
    expect(plan.disableChefHome).toBe(true);
  });

  it("an ID change does not touch the kitchen, and a kitchen change does not touch the documents", () => {
    const a = planPrivateChange(state(), { idDocumentPath: NEW_ID });
    expect(a.columns).not.toHaveProperty("kitchen_status");
    expect(a.disableChefHome).toBe(false);
    const b = planPrivateChange(state(), { kitchenPhotoPaths: [NEW_K] });
    expect(b.columns).not.toHaveProperty("id_check_status");
    expect(b.columns).not.toHaveProperty("food_handler_status");
  });

  it("combined changes reset every affected check in one plan", () => {
    const plan = planPrivateChange(state(), {
      idDocumentPath: NEW_ID,
      foodHandlerPath: NEW_FH,
      kitchenPhotoPaths: [NEW_K],
    });
    expect(plan.columns).toMatchObject({
      id_check_status: "pending",
      food_handler_status: "pending",
      kitchen_status: "pending",
    });
    expect(plan.disableChefHome).toBe(true);
  });
});

describe("sameKitchenAddress", () => {
  it("compares all three parts and treats null as different from an address", () => {
    const a = { line: "1 A St", city: "X", postalCode: "L5B1A1" };
    expect(sameKitchenAddress(a, { ...a })).toBe(true);
    expect(sameKitchenAddress(a, { ...a, city: "Y" })).toBe(false);
    expect(sameKitchenAddress(null, a)).toBe(false);
    expect(sameKitchenAddress(null, null)).toBe(true);
  });
});

describe("planSubmit (N2: never overwrite verified or pending)", () => {
  const base = {
    status: "pending" as const,
    idCheck: "not_started" as MockCheckStatus,
    foodHandlerCheck: "not_started" as MockCheckStatus,
    kitchenCheck: "not_started" as MockCheckStatus,
    locationOptions: ["customer_home" as const],
  };
  it.each(ALL)("moves a %s ID check only from not_started or failed", (c) => {
    const plan = planSubmit({ ...base, idCheck: c });
    if (c === "not_started" || c === "failed")
      expect(plan.columns.id_check_status).toBe("pending");
    else expect(plan.columns).not.toHaveProperty("id_check_status");
  });
  it.each(ALL)("food handler %s", (c) => {
    const plan = planSubmit({ ...base, foodHandlerCheck: c });
    if (c === "not_started" || c === "failed")
      expect(plan.columns.food_handler_status).toBe("pending");
    else expect(plan.columns).not.toHaveProperty("food_handler_status");
  });
  it.each(ALL)("kitchen %s moves only when chef's home is offered", (c) => {
    const without = planSubmit({ ...base, kitchenCheck: c });
    expect(without.columns).not.toHaveProperty("kitchen_status");
    const withHome = planSubmit({
      ...base,
      kitchenCheck: c,
      locationOptions: ["customer_home", "chef_home"],
    });
    if (c === "not_started" || c === "failed")
      expect(withHome.columns.kitchen_status).toBe("pending");
    else expect(withHome.columns).not.toHaveProperty("kitchen_status");
  });
  it("a rejected chef goes back to pending and the reason is cleared", () => {
    const plan = planSubmit({ ...base, status: "rejected" });
    expect(plan.moveToPending).toBe(true);
    expect(plan.columns.reject_reason).toBeNull();
  });
  it("a pending chef with nothing to move is a no-op", () => {
    const plan = planSubmit({
      ...base,
      idCheck: "verified",
      foodHandlerCheck: "pending",
    });
    expect(plan.columns).toEqual({});
    expect(plan.moveToPending).toBe(false);
  });
  it("never touches the police check", () => {
    expect(JSON.stringify(planSubmit(base))).not.toMatch(/police/);
  });
});

describe("computeMissing", () => {
  function complete(over: Partial<MissingInput> = {}): MissingInput {
    return {
      displayName: "Chef Lan",
      bio: "I cook.",
      photoPath: `${CHEF}/photo-${U1}.png`,
      cuisines: ["Vietnamese"],
      languages: ["English"],
      hourlyRateCents: 3000,
      servicePostalPrefix: "L5B",
      locationOptions: ["customer_home"],
      idDocumentPath: `${CHEF}/id-${U1}.png`,
      foodHandlerPath: `${CHEF}/food-handler-${U1}.png`,
      allergenAckAt: "2026-10-08T00:00:00.000Z",
      phoneVerified: true,
      sampleDishCount: 1,
      kitchenAddress: null,
      kitchenPhotoPaths: [],
      kitchenHygieneAckAt: null,
      ...over,
    };
  }
  it("is empty for a complete customer's-home application", () => {
    expect(computeMissing(complete())).toEqual([]);
  });
  it("lists every item for an empty application, in contract order", () => {
    expect(
      computeMissing({
        displayName: "New user",
        bio: null,
        photoPath: null,
        cuisines: [],
        languages: [],
        hourlyRateCents: null,
        servicePostalPrefix: null,
        locationOptions: [],
        idDocumentPath: null,
        foodHandlerPath: null,
        allergenAckAt: null,
        phoneVerified: false,
        sampleDishCount: 0,
        kitchenAddress: null,
        kitchenPhotoPaths: [],
        kitchenHygieneAckAt: null,
      }),
    ).toEqual([
      "displayName",
      "bio",
      "photo",
      "cuisines",
      "languages",
      "hourlyRate",
      "servicePostalPrefix",
      "locationOptions",
      "idDocument",
      "foodHandler",
      "allergenAcknowledgement",
      "phoneVerified",
      "sampleDish",
    ]);
  });
  it("treats a blank bio or name as missing", () => {
    expect(computeMissing(complete({ bio: "   " }))).toEqual(["bio"]);
    expect(computeMissing(complete({ displayName: " " }))).toEqual([
      "displayName",
    ]);
  });
  it("adds the kitchen items only when chef's home is offered", () => {
    expect(
      computeMissing(
        complete({ locationOptions: ["customer_home", "chef_home"] }),
      ),
    ).toEqual([
      "kitchenAddress",
      "kitchenPhotos",
      "kitchenHygieneAcknowledgement",
    ]);
    expect(
      computeMissing(
        complete({
          locationOptions: ["chef_home"],
          kitchenAddress: { line: "1 A St", city: "X", postalCode: "L5B1A1" },
          kitchenPhotoPaths: [`${CHEF}/kitchen-${U1}.png`],
          kitchenHygieneAckAt: "2026-10-08T00:00:00.000Z",
        }),
      ),
    ).toEqual([]);
  });
});

describe("parseUpdateBody", () => {
  const parse = (b: Record<string, unknown>) => parseUpdateBody(b);

  it("accepts a full valid body and normalizes it", () => {
    const { value, errors } = parse({
      bio: "  Hello  ",
      photoPath: `${CHEF}/photo-${U1}.png`,
      cuisines: [" Vietnamese ", "vietnamese", "Thai"],
      languages: ["English", "Vietnamese"],
      hourlyRateCents: 3500,
      servicePostalPrefix: " l5b ",
      serviceRadiusKm: 25,
      locationOptions: ["chef_home", "customer_home", "chef_home"],
      kitchenAddress: {
        line: " 1 Fake St ",
        city: " Mississauga ",
        postalCode: "l5b 1a1",
      },
      acknowledgeAllergenStatement: true,
      acknowledgeKitchenHygiene: true,
    });
    expect(errors).toEqual({});
    expect(value).toEqual({
      bio: "Hello",
      photoPath: `${CHEF}/photo-${U1}.png`,
      cuisines: ["Vietnamese", "Thai"],
      languages: ["English", "Vietnamese"],
      hourlyRateCents: 3500,
      servicePostalPrefix: "L5B",
      serviceRadiusKm: 25,
      locationOptions: ["chef_home", "customer_home"],
      kitchenAddress: {
        line: "1 Fake St",
        city: "Mississauga",
        postalCode: "L5B1A1",
      },
      acknowledgeAllergenStatement: true,
      acknowledgeKitchenHygiene: true,
    });
  });

  it("an empty body is valid and changes nothing", () => {
    expect(parse({})).toEqual({ value: {}, errors: {} });
  });

  it("bio rejects NUL and other control characters but keeps line breaks and tabs (tester F1)", () => {
    for (const bad of [
      "a\u0000b",
      "\u0000",
      "x\u0001y",
      "x\u0008y",
      "x\u000by",
      "x\u000cy",
      "x\u001fy",
      "x\u007fy",
    ])
      expect(parse({ bio: bad }).errors.bio, JSON.stringify(bad)).toBeTruthy();
    expect(parse({ bio: "line one\nline two\r\n\tindented" }).errors).toEqual(
      {},
    );
    expect(parse({ bio: "line one\nline two" }).value.bio).toBe(
      "line one\nline two",
    );
  });

  it("text fields reject lone surrogates, accept real emoji and accents", () => {
    const lone = ["a\ud800", "\udc00b", "x\udbffy", "\ude00\ud83d"];
    for (const bad of lone) {
      expect(parse({ bio: bad }).errors.bio, JSON.stringify(bad)).toBeTruthy();
      expect(parse({ cuisines: [bad] }).errors.cuisines).toBeTruthy();
      expect(parse({ languages: [bad] }).errors.languages).toBeTruthy();
      expect(
        parse({
          kitchenAddress: { line: bad, city: "X", postalCode: "L5B1A1" },
        }).errors["kitchenAddress.line"],
      ).toBeTruthy();
      expect(
        parse({
          kitchenAddress: { line: "1 A St", city: bad, postalCode: "L5B1A1" },
        }).errors["kitchenAddress.city"],
      ).toBeTruthy();
    }
    expect(parse({ bio: "Café \u{1F35C} pho" }).errors).toEqual({});
    expect(parse({ cuisines: ["Phở \u{1F35C}"] }).errors).toEqual({});
  });

  it("bio: null and blank clear it, 2001 characters is too long, 2000 is fine", () => {
    expect(parse({ bio: null }).value.bio).toBeNull();
    expect(parse({ bio: "   " }).value.bio).toBeNull();
    expect(parse({ bio: "x".repeat(2000) }).errors).toEqual({});
    expect(parse({ bio: "x".repeat(2001) }).errors.bio).toBeTruthy();
    expect(parse({ bio: 5 }).errors.bio).toBeTruthy();
  });

  it("photoPath: null clears; anything but a string or null is an error", () => {
    expect(parse({ photoPath: null }).value.photoPath).toBeNull();
    expect(parse({ photoPath: 5 }).errors.photoPath).toBeTruthy();
    expect(parse({ photoPath: "" }).errors.photoPath).toBeTruthy();
  });

  it.each(["cuisines", "languages"])(
    "%s: 1 to 10 entries of 1 to 40 characters",
    (key) => {
      expect(parse({ [key]: ["A"] }).errors).toEqual({});
      expect(parse({ [key]: ["x".repeat(40)] }).errors).toEqual({});
      expect(
        parse({ [key]: Array.from({ length: 10 }, (_, i) => `E${i}`) }).errors,
      ).toEqual({});
      for (const bad of [
        [],
        Array.from({ length: 11 }, (_, i) => `E${i}`),
        [""],
        ["   "],
        ["x".repeat(41)],
        [5],
        [null],
        ["bad\u0000name"],
        "Vietnamese",
        null,
        { 0: "x" },
      ])
        expect(
          parse({ [key]: bad }).errors[key],
          JSON.stringify(bad),
        ).toBeTruthy();
    },
  );

  it("hourlyRateCents: whole cents from 500 to 20000", () => {
    for (const ok of [500, 3000, 20000])
      expect(parse({ hourlyRateCents: ok }).errors).toEqual({});
    for (const bad of [
      499,
      0,
      -1,
      20001,
      12.5,
      "3000",
      null,
      NaN,
      Infinity,
      true,
    ])
      expect(
        parse({ hourlyRateCents: bad }).errors.hourlyRateCents,
        String(bad),
      ).toBeTruthy();
  });

  it("servicePostalPrefix has the A1A shape (existence is checked by the route)", () => {
    expect(
      parse({ servicePostalPrefix: "l5b" }).value.servicePostalPrefix,
    ).toBe("L5B");
    for (const bad of ["L5", "L5B1", "L5B 1A1", "555", "", 5, null])
      expect(
        parse({ servicePostalPrefix: bad }).errors.servicePostalPrefix,
        String(bad),
      ).toBeTruthy();
  });

  it("serviceRadiusKm: whole kilometres 1 to 200", () => {
    for (const ok of [1, 15, 200])
      expect(parse({ serviceRadiusKm: ok }).errors).toEqual({});
    for (const bad of [0, 201, 1.5, "15", null, -3])
      expect(
        parse({ serviceRadiusKm: bad }).errors.serviceRadiusKm,
        String(bad),
      ).toBeTruthy();
  });

  it("locationOptions: a non-empty set of customer_home and chef_home", () => {
    expect(parse({ locationOptions: ["customer_home"] }).errors).toEqual({});
    expect(parse({ locationOptions: ["chef_home"] }).errors).toEqual({});
    for (const bad of [
      [],
      ["admin"],
      ["customer_home", "x"],
      "customer_home",
      null,
      [5],
    ])
      expect(
        parse({ locationOptions: bad }).errors.locationOptions,
        JSON.stringify(bad),
      ).toBeTruthy();
  });

  it("kitchenAddress: needs line, city and a postal code; nested errors use dotted keys", () => {
    const e = parse({
      kitchenAddress: { line: "", city: "x".repeat(81), postalCode: "12345" },
    }).errors;
    expect(Object.keys(e).sort()).toEqual([
      "kitchenAddress.city",
      "kitchenAddress.line",
      "kitchenAddress.postalCode",
    ]);
    expect(
      parse({ kitchenAddress: "1 Fake St" }).errors.kitchenAddress,
    ).toBeTruthy();
    expect(parse({ kitchenAddress: null }).errors.kitchenAddress).toBeTruthy();
    expect(parse({ kitchenAddress: [] }).errors.kitchenAddress).toBeTruthy();
    expect(
      parse({
        kitchenAddress: {
          line: "1 A",
          city: "B",
          postalCode: "L5B1A1",
          extra: 1,
        },
      }).errors["kitchenAddress.extra"],
    ).toBeTruthy();
  });

  it("acknowledgements accept only the boolean true", () => {
    for (const key of [
      "acknowledgeAllergenStatement",
      "acknowledgeKitchenHygiene",
    ]) {
      expect(parse({ [key]: true }).errors).toEqual({});
      for (const bad of [false, "true", 1, null, "yes"])
        expect(parse({ [key]: bad }).errors[key], String(bad)).toBeTruthy();
    }
  });

  it("collects every error in one pass", () => {
    const { errors } = parse({
      bio: 5,
      hourlyRateCents: 1,
      locationOptions: [],
    });
    expect(Object.keys(errors).sort()).toEqual([
      "bio",
      "hourlyRateCents",
      "locationOptions",
    ]);
  });

  it("MAX_KITCHEN_PHOTOS is 10 (contract ASSUMPTION)", () => {
    expect(MAX_KITCHEN_PHOTOS).toBe(10);
  });
});
