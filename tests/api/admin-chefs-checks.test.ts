// T-035: MOCK checks and kitchen review, with stale-review protection (B1). The statuses are
// simulated outcomes recorded by an admin; nothing verifies a real document.
import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import {
  application,
  chefRow,
  idPath,
  kitchenPath,
  newChef,
  patchApp,
  postDoc,
  privRow,
  svc,
  upload,
  uuid,
  type Chef,
} from "./chef-helpers";
import {
  checksOf,
  kitchenOf,
  newAdmin,
  notificationsOf,
  rejectOf,
  submittedChef,
} from "./admin-helpers";

beforeEach(() => freshLimits());

const STATUSES = ["not_started", "pending", "verified", "failed"] as const;

describe("PATCH /api/admin/chefs/:id/checks", () => {
  it("records ID, food-handler and police outcomes for the files the admin viewed and bumps updated_at", async () => {
    const admin = await newAdmin();
    const chef = await submittedChef();
    const app = await application(chef.b);
    const before = await privRow(chef.id);
    const r = await admin.b.call(checksOf(chef.id), {
      method: "PATCH",
      body: {
        idCheck: "verified",
        idDocumentPath: app.documents.idDocumentPath,
        foodHandlerCheck: "failed",
        foodHandlerPath: app.documents.foodHandlerPath,
        policeCheck: "pending",
      },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.body.application.checks).toEqual({
      id: "verified",
      foodHandler: "failed",
      kitchen: "not_started",
      police: "pending",
    });
    const after = await privRow(chef.id);
    expect(after.id_check_status).toBe("verified");
    expect(after.food_handler_status).toBe("failed");
    expect(after.police_check_status).toBe("pending");
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date(before.updated_at).getTime(),
    );
    // The chef sees the outcomes, read-only.
    expect((await application(chef.b)).checks.id).toBe("verified");
  });

  it("accepts every status value and works for pending, approved and rejected chefs", async () => {
    const admin = await newAdmin();
    const chef = await submittedChef();
    const path = (await application(chef.b)).documents.idDocumentPath;
    for (const s of STATUSES) {
      const r = await admin.b.call(checksOf(chef.id), {
        method: "PATCH",
        body: { idCheck: s, idDocumentPath: path },
      });
      expect(r.status, s).toBe(200);
      expect((await privRow(chef.id)).id_check_status).toBe(s);
    }
    for (const status of ["approved", "rejected", "pending"]) {
      await svc.from("chefs").update({ status }).eq("profile_id", chef.id);
      const r = await admin.b.call(checksOf(chef.id), {
        method: "PATCH",
        body: { policeCheck: "verified" },
      });
      expect(r.status, status).toBe(200);
    }
  });

  it("police status needs no file and can be set to every value", async () => {
    const admin = await newAdmin();
    const chef = await newChef();
    const before = await privRow(chef.id);
    for (const s of STATUSES) {
      const r = await admin.b.call(checksOf(chef.id), {
        method: "PATCH",
        body: { policeCheck: s },
      });
      expect(r.status, s).toBe(200);
      expect(r.body.application.checks.police).toBe(s);
    }
    expect(
      new Date((await privRow(chef.id)).updated_at).getTime(),
    ).toBeGreaterThan(new Date(before.updated_at).getTime());
    // A chef cannot set it: the chef route has no such field.
    const c = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { policeCheck: "verified" },
    });
    expect(c.status).toBe(422);
  });

  it("422: nothing to set, a check without its reviewed path, a path without its check, bad values, unknown keys", async () => {
    const admin = await newAdmin();
    const chef = await submittedChef();
    const p = (await application(chef.b)).documents;
    const cases: [Record<string, unknown>, string][] = [
      [{}, "idCheck"],
      [{ idDocumentPath: p.idDocumentPath }, "idCheck"],
      [{ idCheck: "verified" }, "idDocumentPath"],
      [{ foodHandlerCheck: "verified" }, "foodHandlerPath"],
      [{ idCheck: "verified", idDocumentPath: 5 }, "idDocumentPath"],
      [
        { idCheck: "verified", idDocumentPath: "a".repeat(201) },
        "idDocumentPath",
      ],
      [
        { policeCheck: "pending", foodHandlerPath: p.foodHandlerPath },
        "foodHandlerCheck",
      ],
      [{ idCheck: "great", idDocumentPath: p.idDocumentPath }, "idCheck"],
      [{ policeCheck: "great" }, "policeCheck"],
      [{ policeCheck: "verified", status: "approved" }, "status"],
      [{ policeCheck: "verified", kitchenCheck: "verified" }, "kitchenCheck"],
    ];
    for (const [body, field] of cases) {
      const r = await admin.b.call(checksOf(chef.id), {
        method: "PATCH",
        body,
      });
      expect(r.status, JSON.stringify(body)).toBe(422);
      expect(r.body.error.fields, JSON.stringify(body)).toHaveProperty(field);
    }
    const priv = await privRow(chef.id);
    expect(priv.id_check_status).toBe("pending");
    expect(priv.police_check_status).toBe("not_started");
  });

  it("B1: a path that is not the stored one is 409 and nothing is written (not even the other checks)", async () => {
    const admin = await newAdmin();
    const chef = await submittedChef();
    const other = await submittedChef();
    const app = await application(chef.b);
    const before = await privRow(chef.id);
    const wrong = [
      `${chef.id}/id-${uuid()}.png`, // plausible but never stored
      (await application(other.b)).documents.idDocumentPath, // another chef's file
      "garbage",
    ];
    for (const idDocumentPath of wrong) {
      const r = await admin.b.call(checksOf(chef.id), {
        method: "PATCH",
        body: {
          idCheck: "verified",
          idDocumentPath,
          foodHandlerCheck: "verified",
          foodHandlerPath: app.documents.foodHandlerPath, // this one is right
          policeCheck: "verified",
        },
      });
      expect(r.status, idDocumentPath).toBe(409);
      expect(r.body.error.code).toBe("INVALID_STATE");
    }
    // The ID path is right and the food-handler path is the ID file: also 409.
    const r = await admin.b.call(checksOf(chef.id), {
      method: "PATCH",
      body: {
        idCheck: "verified",
        idDocumentPath: app.documents.idDocumentPath,
        foodHandlerCheck: "verified",
        foodHandlerPath: app.documents.idDocumentPath,
      },
    });
    expect(r.status).toBe(409);
    const after = await privRow(chef.id);
    expect(after).toEqual(before); // including updated_at: no write happened
  });

  it("B1: the chef replaced the file after the admin opened it, so the old review is refused", async () => {
    const admin = await newAdmin();
    const chef = await submittedChef();
    const viewed = await application(chef.b);
    const swapped = idPath(chef.id);
    await upload("chef-documents", swapped);
    expect(
      (
        await chef.b.call(postDoc, {
          body: { kind: "id_document", path: swapped },
        })
      ).status,
    ).toBe(200);
    const r = await admin.b.call(checksOf(chef.id), {
      method: "PATCH",
      body: {
        idCheck: "verified",
        idDocumentPath: viewed.documents.idDocumentPath,
        policeCheck: "failed",
      },
    });
    expect(r.status).toBe(409);
    const p = await privRow(chef.id);
    expect(p.id_check_status).toBe("pending");
    expect(p.police_check_status).toBe("not_started");
    // The same for the food-handler certificate.
    const fh = `${chef.id}/food-handler-${uuid()}.pdf`;
    await upload("chef-documents", fh);
    expect(
      (await chef.b.call(postDoc, { body: { kind: "food_handler", path: fh } }))
        .status,
    ).toBe(200);
    const r2 = await admin.b.call(checksOf(chef.id), {
      method: "PATCH",
      body: {
        foodHandlerCheck: "verified",
        foodHandlerPath: viewed.documents.foodHandlerPath,
      },
    });
    expect(r2.status).toBe(409);
    expect((await privRow(chef.id)).food_handler_status).toBe("pending");
  });

  it("B1 race: a verdict racing a file swap never leaves 'verified' on the new file", async () => {
    const admin = await newAdmin();
    for (let i = 0; i < 4; i++) {
      const chef = await submittedChef();
      const viewed = (await application(chef.b)).documents.idDocumentPath;
      const swapped = idPath(chef.id);
      await upload("chef-documents", swapped);
      const [a, s] = await Promise.all([
        admin.b.call(checksOf(chef.id), {
          method: "PATCH",
          body: { idCheck: "verified", idDocumentPath: viewed },
        }),
        chef.b.call(postDoc, { body: { kind: "id_document", path: swapped } }),
      ]);
      expect([200, 409]).toContain(a.status);
      expect(s.status, s.text).toBe(200);
      const p = await privRow(chef.id);
      expect(p.id_document_path).toBe(swapped);
      expect(p.id_check_status, `round ${i}`).toBe("pending");
    }
  });
});

describe("POST /api/admin/chefs/:id/kitchen-review (MOCK)", () => {
  async function kitchenChef() {
    const chef = await submittedChef({ chefHome: true });
    const app = await application(chef.b);
    return {
      chef,
      photos: app.documents.kitchenPhotoPaths as string[],
      address: app.kitchenAddress as {
        line: string;
        city: string;
        postalCode: string;
      },
    };
  }
  const review = (id: string, body: Record<string, unknown>, who: Chef) =>
    who.b.call(kitchenOf(id), { body });

  it("approve: kitchen verified, chef's home switched on, chef notified", async () => {
    const admin = await newAdmin();
    const { chef, photos, address } = await kitchenChef();
    const r = await review(
      chef.id,
      {
        decision: "approve",
        reviewedPhotoPaths: photos,
        reviewedAddress: address,
      },
      admin,
    );
    expect(r.status, r.text).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.body.application.checks.kitchen).toBe("verified");
    expect(r.body.application.chefHomeEnabled).toBe(true);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(true);
    expect((await privRow(chef.id)).kitchen_status).toBe("verified");
    const n = await notificationsOf(chef.id);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({
      type: "kitchen_approved",
      title: "Your kitchen was approved",
      booking_id: null,
    });
    // The chef's status is untouched (the kitchen review is not the chef approval).
    expect((await chefRow(chef.id)).status).toBe("pending");
  });

  it("the photos compare as a set (order does not matter) and an approve note reaches the chef", async () => {
    const admin = await newAdmin();
    const { chef, photos, address } = await kitchenChef();
    const second = kitchenPath(chef.id);
    await upload("kitchen-photos", second);
    expect(
      (
        await chef.b.call(postDoc, {
          body: { kind: "kitchen_photo", path: second },
        })
      ).status,
    ).toBe(200);
    const r = await review(
      chef.id,
      {
        decision: "approve",
        note: "Spotless, thank you",
        reviewedPhotoPaths: [second, ...photos],
        reviewedAddress: address,
      },
      admin,
    );
    expect(r.status, r.text).toBe(200);
    expect((await notificationsOf(chef.id))[0].body).toBe(
      "Spotless, thank you",
    );
  });

  it("accepts the postal code with a space or in lower case", async () => {
    const admin = await newAdmin();
    const { chef, photos, address } = await kitchenChef();
    const r = await review(
      chef.id,
      {
        decision: "approve",
        reviewedPhotoPaths: photos,
        reviewedAddress: { ...address, postalCode: "l5b 1a1" },
      },
      admin,
    );
    expect(r.status, r.text).toBe(200);
  });

  it("B1: reviewed photos or address that differ from the stored ones are 409 and nothing is written", async () => {
    const admin = await newAdmin();
    const { chef, photos, address } = await kitchenChef();
    const second = kitchenPath(chef.id);
    await upload("kitchen-photos", second);
    expect(
      (
        await chef.b.call(postDoc, {
          body: { kind: "kitchen_photo", path: second },
        })
      ).status,
    ).toBe(200);
    const stored = [...photos, second];
    const before = await privRow(chef.id);
    const beforeChef = await chefRow(chef.id);
    const stale: [string, Record<string, unknown>][] = [
      [
        "one photo missing",
        { reviewedPhotoPaths: photos, reviewedAddress: address },
      ],
      [
        "extra photo",
        {
          reviewedPhotoPaths: [...stored, kitchenPath(chef.id)],
          reviewedAddress: address,
        },
      ],
      [
        "different photo",
        {
          reviewedPhotoPaths: [photos[0], kitchenPath(chef.id)],
          reviewedAddress: address,
        },
      ],
      ["no photos", { reviewedPhotoPaths: [], reviewedAddress: address }],
      [
        "other line",
        {
          reviewedPhotoPaths: stored,
          reviewedAddress: { ...address, line: "2 Other Road" },
        },
      ],
      [
        "other city",
        {
          reviewedPhotoPaths: stored,
          reviewedAddress: { ...address, city: "Toronto" },
        },
      ],
      [
        "other postal code",
        {
          reviewedPhotoPaths: stored,
          reviewedAddress: { ...address, postalCode: "L5B 1A2" },
        },
      ],
      [
        "null address while one is stored",
        { reviewedPhotoPaths: stored, reviewedAddress: null },
      ],
    ];
    for (const decision of ["approve", "reject"]) {
      for (const [name, rest] of stale) {
        const r = await review(
          chef.id,
          { decision, note: "Reason given", ...rest },
          admin,
        );
        expect(r.status, `${decision}: ${name}`).toBe(409);
        expect(r.body.error.code).toBe("INVALID_STATE");
      }
    }
    expect(await privRow(chef.id)).toEqual(before);
    expect(await chefRow(chef.id)).toEqual(beforeChef);
    expect(await notificationsOf(chef.id)).toEqual([]);
  });

  it("B1: the chef changed the kitchen after the admin opened it", async () => {
    const admin = await newAdmin();
    const { chef, photos, address } = await kitchenChef();
    const added = kitchenPath(chef.id);
    await upload("kitchen-photos", added);
    expect(
      (
        await chef.b.call(postDoc, {
          body: { kind: "kitchen_photo", path: added },
        })
      ).status,
    ).toBe(200);
    let r = await review(
      chef.id,
      {
        decision: "approve",
        reviewedPhotoPaths: photos,
        reviewedAddress: address,
      },
      admin,
    );
    expect(r.status).toBe(409);
    const moved = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { kitchenAddress: { ...address, line: "9 New Street" } },
    });
    expect(moved.status, moved.text).toBe(200);
    r = await review(
      chef.id,
      {
        decision: "approve",
        reviewedPhotoPaths: [...photos, added],
        reviewedAddress: address,
      },
      admin,
    );
    expect(r.status).toBe(409);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
  });

  it("reject needs a note (3 to 500 safe characters), sets the kitchen to failed, switches chef's home off and notifies", async () => {
    const admin = await newAdmin();
    const { chef, photos, address } = await kitchenChef();
    const base = { reviewedPhotoPaths: photos, reviewedAddress: address };
    for (const note of [
      undefined,
      null,
      "",
      "ab",
      "a".repeat(501),
      7,
      "bad\u0000note",
    ]) {
      const r = await review(
        chef.id,
        { decision: "reject", note, ...base },
        admin,
      );
      expect(r.status, JSON.stringify(note)).toBe(422);
      expect(r.body.error.fields).toHaveProperty("note");
    }
    expect((await privRow(chef.id)).kitchen_status).toBe("pending");

    await review(chef.id, { decision: "approve", ...base }, admin);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(true);
    const r = await review(
      chef.id,
      { decision: "reject", note: " Photos are blurry ", ...base },
      admin,
    );
    expect(r.status, r.text).toBe(200);
    expect(r.body.application.checks.kitchen).toBe("failed");
    expect(r.body.application.chefHomeEnabled).toBe(false);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
    const n = await notificationsOf(chef.id);
    expect(n.map((x) => x.type)).toEqual([
      "kitchen_approved",
      "kitchen_rejected",
    ]);
    expect(n[1]).toMatchObject({
      title: "Your kitchen was not approved",
      body: "Photos are blurry",
    });
  });

  it("422: bad decision, missing or malformed reviewed values, repeats, too many photos, unknown keys", async () => {
    const admin = await newAdmin();
    const { chef, photos, address } = await kitchenChef();
    const ok = {
      decision: "approve",
      reviewedPhotoPaths: photos,
      reviewedAddress: address,
    };
    const cases: [Record<string, unknown>, string][] = [
      [{ ...ok, decision: "maybe" }, "decision"],
      [{ ...ok, decision: undefined }, "decision"],
      [{ decision: "approve" }, "reviewedPhotoPaths"],
      [{ decision: "approve" }, "reviewedAddress"],
      [{ ...ok, reviewedPhotoPaths: "x" }, "reviewedPhotoPaths"],
      [
        { ...ok, reviewedPhotoPaths: [photos[0], photos[0]] },
        "reviewedPhotoPaths",
      ],
      [
        { ...ok, reviewedPhotoPaths: Array.from({ length: 11 }, () => uuid()) },
        "reviewedPhotoPaths",
      ],
      [{ ...ok, reviewedPhotoPaths: [7] }, "reviewedPhotoPaths"],
      [{ ...ok, reviewedAddress: "home" }, "reviewedAddress"],
      [
        { ...ok, reviewedAddress: { line: "1 A St", city: "X" } },
        "reviewedAddress",
      ],
      [
        { ...ok, reviewedAddress: { ...address, postalCode: "12345" } },
        "reviewedAddress",
      ],
      [{ ...ok, reviewedAddress: { ...address, extra: 1 } }, "reviewedAddress"],
      [{ ...ok, note: "x" }, "note"],
      [{ ...ok, status: "approved" }, "status"],
    ];
    for (const [body, field] of cases) {
      const r = await review(chef.id, body, admin);
      expect(r.status, JSON.stringify(body)).toBe(422);
      expect(r.body.error.fields, JSON.stringify(body)).toHaveProperty(field);
    }
    expect((await privRow(chef.id)).kitchen_status).toBe("pending");
  });

  it("allows reviewedAddress null when no kitchen address is stored; chef's home not offered is 409 on approve", async () => {
    const admin = await newAdmin();
    const chef = await submittedChef(); // customer's home only: no kitchen data
    const body = { reviewedPhotoPaths: [], reviewedAddress: null };
    let r = await review(chef.id, { decision: "approve", ...body }, admin);
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("INVALID_STATE");
    expect(r.body.error.message).toContain("own home");
    r = await review(
      chef.id,
      { decision: "reject", note: "Not offered", ...body },
      admin,
    );
    expect(r.status, r.text).toBe(200);
    expect((await privRow(chef.id)).kitchen_status).toBe("failed");
  });

  it("approve needs the address, a photo and the hygiene acknowledgement (APPLICATION_INCOMPLETE)", async () => {
    const admin = await newAdmin();
    const chef = await newChef();
    expect(
      (
        await chef.b.call(patchApp, {
          method: "PATCH",
          body: { locationOptions: ["chef_home"] },
        })
      ).status,
    ).toBe(200);
    let r = await review(
      chef.id,
      { decision: "approve", reviewedPhotoPaths: [], reviewedAddress: null },
      admin,
    );
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("APPLICATION_INCOMPLETE");
    expect(r.body.error.missing).toEqual([
      "kitchenAddress",
      "kitchenPhotos",
      "kitchenHygieneAcknowledgement",
    ]);

    const { chef: full, photos, address } = await kitchenChef();
    await svc
      .from("chef_private")
      .update({ kitchen_hygiene_ack_at: null })
      .eq("chef_id", full.id);
    r = await review(
      full.id,
      {
        decision: "approve",
        reviewedPhotoPaths: photos,
        reviewedAddress: address,
      },
      admin,
    );
    expect(r.status).toBe(409);
    expect(r.body.error.missing).toEqual(["kitchenHygieneAcknowledgement"]);
    // A kitchen photo whose file is gone does not count.
    await svc
      .from("chef_private")
      .update({ kitchen_hygiene_ack_at: new Date().toISOString() })
      .eq("chef_id", full.id);
    await svc.storage.from("kitchen-photos").remove(photos);
    r = await review(
      full.id,
      {
        decision: "approve",
        reviewedPhotoPaths: photos,
        reviewedAddress: address,
      },
      admin,
    );
    expect(r.status).toBe(409);
    expect(r.body.error.missing).toEqual(["kitchenPhotos"]);
    expect((await chefRow(full.id)).chef_home_enabled).toBe(false);
  });

  // D-21(b) (T-061): only a pending or approved chef can have a kitchen reviewed.
  it("a rejected chef's kitchen cannot be reviewed (409), approve or reject, and nothing changes", async () => {
    const admin = await newAdmin();
    const { chef, photos, address } = await kitchenChef();
    await svc
      .from("chefs")
      .update({ status: "rejected" })
      .eq("profile_id", chef.id);
    const before = await privRow(chef.id);
    for (const decision of ["approve", "reject"]) {
      const r = await review(
        chef.id,
        {
          decision,
          note: "Checked the photos.",
          reviewedPhotoPaths: photos,
          reviewedAddress: address,
        },
        admin,
      );
      expect(r.status, `${decision}: ${r.text}`).toBe(409);
      expect(r.body.error.code).toBe("INVALID_STATE");
      expect(r.body.error.message).toMatch(/pending or approved/);
    }
    const after = await privRow(chef.id);
    expect(after.kitchen_status).toBe(before.kitchen_status);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
    expect(await notificationsOf(chef.id)).toEqual([]);
  });
  it("an approved chef's kitchen can still be reviewed", async () => {
    const admin = await newAdmin();
    const { chef, photos, address } = await kitchenChef();
    await svc
      .from("chefs")
      .update({ status: "approved" })
      .eq("profile_id", chef.id);
    const r = await review(
      chef.id,
      {
        decision: "approve",
        reviewedPhotoPaths: photos,
        reviewedAddress: address,
      },
      admin,
    );
    expect(r.status, r.text).toBe(200);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(true);
  });

  // T-061 Tester round (D-21b, D-21d)
  it("reject route then kitchen review: 409 for approve and reject, stale input too, and nothing is written", async () => {
    const admin = await newAdmin();
    const { chef, photos, address } = await kitchenChef();
    // Approve the kitchen first (allowed while pending), then reject the application.
    expect(
      (
        await review(
          chef.id,
          {
            decision: "approve",
            reviewedPhotoPaths: photos,
            reviewedAddress: address,
          },
          admin,
        )
      ).status,
    ).toBe(200);
    const rej = await admin.b.call(rejectOf(chef.id), {
      body: { reason: "Documents unclear." },
    });
    expect(rej.status, rej.text).toBe(200);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
    const before = await privRow(chef.id);
    const notesBefore = await notificationsOf(chef.id);
    for (const body of [
      {
        decision: "approve",
        reviewedPhotoPaths: photos,
        reviewedAddress: address,
      },
      {
        decision: "reject",
        note: "Checked the photos.",
        reviewedPhotoPaths: photos,
        reviewedAddress: address,
      },
      // stale input must not change the answer: the status check comes first
      { decision: "approve", reviewedPhotoPaths: [], reviewedAddress: null },
    ]) {
      const r = await review(chef.id, body, admin);
      expect(r.status, JSON.stringify(body)).toBe(409);
      expect(r.body.error.code).toBe("INVALID_STATE");
    }
    expect((await privRow(chef.id)).kitchen_status).toBe(before.kitchen_status);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
    expect(await notificationsOf(chef.id)).toEqual(notesBefore);
  });
  it("a pending chef's kitchen can be rejected, and re-approving the kitchen later turns chef's home back on", async () => {
    const admin = await newAdmin();
    const { chef, photos, address } = await kitchenChef();
    const body = { reviewedPhotoPaths: photos, reviewedAddress: address };
    let r = await review(
      chef.id,
      { decision: "reject", note: "The kitchen is not clean.", ...body },
      admin,
    );
    expect(r.status, r.text).toBe(200);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
    r = await review(chef.id, { decision: "approve", ...body }, admin);
    expect(r.status, r.text).toBe(200);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(true);
  });

  it("a later kitchen change by the chef switches chef's home off again and resets the check", async () => {
    const admin = await newAdmin();
    const { chef, photos, address } = await kitchenChef();
    expect(
      (
        await review(
          chef.id,
          {
            decision: "approve",
            reviewedPhotoPaths: photos,
            reviewedAddress: address,
          },
          admin,
        )
      ).status,
    ).toBe(200);
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { kitchenAddress: { ...address, line: "7 Moved Avenue" } },
    });
    expect(r.status, r.text).toBe(200);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
    expect((await privRow(chef.id)).kitchen_status).toBe("pending");
  });

  it("racing a kitchen change: chef's home never stays on over a kitchen nobody reviewed", async () => {
    const admin = await newAdmin();
    for (let i = 0; i < 3; i++) {
      const { chef, photos, address } = await kitchenChef();
      const added = kitchenPath(chef.id);
      await upload("kitchen-photos", added);
      const [a, c] = await Promise.all([
        admin.b.call(kitchenOf(chef.id), {
          body: {
            decision: "approve",
            reviewedPhotoPaths: photos,
            reviewedAddress: address,
          },
        }),
        chef.b.call(postDoc, { body: { kind: "kitchen_photo", path: added } }),
      ]);
      expect([200, 409]).toContain(a.status);
      expect(c.status, c.text).toBe(200);
      expect((await privRow(chef.id)).kitchen_photo_paths).toContain(added);
      expect((await privRow(chef.id)).kitchen_status, `round ${i}`).toBe(
        "pending",
      );
      expect((await chefRow(chef.id)).chef_home_enabled, `round ${i}`).toBe(
        false,
      );
    }
  });
});
