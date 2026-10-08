import { beforeEach, describe, expect, it } from "vitest";
import {
  patchApplication,
  registerDocument,
  removeKitchenPhoto,
  requireChef,
  submitApplication,
} from "@/lib/server/chef-application";
import { freshLimits } from "./harness";
import { setCurrentJar } from "./jar";
import {
  AFTER_CHANGE,
  CHECK_STATUSES,
  chefClient,
  chefRow,
  deleteDoc,
  fhPath,
  idPath,
  kitchenPath,
  newChef,
  objectExists,
  patchApp,
  photoPath,
  postDoc,
  privRow,
  readyChef,
  setChef,
  setPriv,
  uuid,
  upload,
  PNG,
  PDF,
  type Chef,
} from "./chef-helpers";

beforeEach(() => freshLimits());

const BOTH = ["customer_home", "chef_home"];

describe("POST /api/chef/application/documents: validation", () => {
  it("rejects unknown keys and a missing or unknown kind (422)", async () => {
    const chef = await newChef();
    const p = idPath(chef.id);
    const extra = await chef.b.call(postDoc, {
      body: { kind: "id_document", path: p, chefId: chef.id },
    });
    expect(extra.status).toBe(422);
    expect(extra.body.error.fields.chefId).toBeTruthy();
    for (const kind of [
      undefined,
      null,
      5,
      "passport",
      "ID_DOCUMENT",
      "profile_photo",
      "",
    ]) {
      const r = await chef.b.call(postDoc, { body: { kind, path: p } });
      expect(r.status, String(kind)).toBe(422);
      expect(r.body.error.fields.kind).toBeTruthy();
    }
  });

  it("rejects a missing or non-string path (422)", async () => {
    const chef = await newChef();
    for (const path of [undefined, null, 5, {}, [], ""]) {
      const r = await chef.b.call(postDoc, {
        body: { kind: "id_document", path },
      });
      expect(r.status, JSON.stringify(path)).toBe(422);
      expect(r.body.error.fields.path).toBeTruthy();
    }
  });

  it("a name that does not fit the kind, or a file type the bucket refuses, is 422", async () => {
    const chef = await newChef();
    const c = chef.id;
    for (const [kind, path] of [
      ["id_document", `${c}/kitchen-${uuid()}.png`],
      ["id_document", `${c}/food-handler-${uuid()}.png`],
      ["id_document", `${c}/id-${uuid()}.webp`],
      ["id_document", `${c}/id-${uuid()}.exe`],
      ["id_document", `${c}/id-not-a-uuid.png`],
      ["id_document", `${c}/id.png`],
      ["food_handler", `${c}/id-${uuid()}.png`],
      ["kitchen_photo", `${c}/kitchen-${uuid()}.pdf`],
      ["kitchen_photo", `${c}/photo-${uuid()}.png`],
      // lower case only (tester F6): the app generates these names
      ["id_document", `${c}/ID-${uuid()}.png`],
      ["id_document", `${c}/id-${uuid().toUpperCase()}.png`],
      ["id_document", `${c}/id-${uuid()}.PNG`],
      ["food_handler", `${c}/FOOD-HANDLER-${uuid()}.pdf`],
      ["kitchen_photo", `${c}/kitchen-${uuid()}.JPG`],
    ] as const) {
      const r = await chef.b.call(postDoc, { body: { kind, path } });
      expect(r.status, `${kind} ${path}`).toBe(422);
      expect(r.body.error.fields.path).toBeTruthy();
    }
  });

  it("path traversal and odd paths are 422 and never saved", async () => {
    const chef = await newChef();
    const victim = await newChef();
    const theirs = idPath(victim.id);
    await upload("chef-documents", theirs);
    const c = chef.id;
    for (const path of [
      `${c}/../${theirs}`,
      `${c}/../${victim.id}/${theirs.split("/")[1]}`,
      `${c}/..`,
      `${c}/id-${uuid()}.png/../../x`,
      `/${c}/id-${uuid()}.png`,
      `${c}\\id-${uuid()}.png`,
      `${c}//id-${uuid()}.png`,
      `${c}/sub/id-${uuid()}.png`,
      `${c}/id-${uuid()}.png\n`,
      `${c}/id-${uuid()}.png?x=1`,
      `${c}/id-%2e%2e.png`,
      "x".repeat(300),
    ]) {
      const r = await chef.b.call(postDoc, {
        body: { kind: "id_document", path },
      });
      expect(r.status, JSON.stringify(path)).toBe(422);
    }
    expect((await privRow(chef.id)).id_document_path).toBeNull();
  });

  it("403 for a path in another chef's folder, even when that object exists; nothing is saved", async () => {
    const chef = await newChef();
    const victim = await newChef();
    const theirs = idPath(victim.id);
    await upload("chef-documents", theirs);
    for (const kind of [
      "id_document",
      "food_handler",
      "kitchen_photo",
    ] as const) {
      const path =
        kind === "kitchen_photo"
          ? kitchenPath(victim.id)
          : kind === "id_document"
            ? theirs
            : fhPath(victim.id);
      if (kind === "kitchen_photo") await upload("kitchen-photos", path);
      const r = await chef.b.call(postDoc, { body: { kind, path } });
      expect(r.status, kind).toBe(403);
      expect(r.body.error.code).toBe("FORBIDDEN");
    }
    // a foreign path that does not exist gets the same answer: no probing of other folders
    const ghost = await chef.b.call(postDoc, {
      body: { kind: "id_document", path: idPath(victim.id) },
    });
    expect(ghost.status).toBe(403);
    const mine = await privRow(chef.id);
    expect(mine.id_document_path).toBeNull();
    expect(mine.food_handler_path).toBeNull();
    expect(mine.kitchen_photo_paths).toEqual([]);
    const theirsRow = await privRow(victim.id);
    expect(theirsRow.id_document_path).toBeNull();
  });

  it("404 when the object was never uploaded, or sits in the wrong bucket", async () => {
    const chef = await newChef();
    const never = await chef.b.call(postDoc, {
      body: { kind: "id_document", path: idPath(chef.id) },
    });
    expect(never.status).toBe(404);
    expect(never.body.error.code).toBe("NOT_FOUND");

    const wrongBucket = idPath(chef.id);
    await upload("kitchen-photos", wrongBucket); // right name, but the ID must be in chef-documents
    const r = await chef.b.call(postDoc, {
      body: { kind: "id_document", path: wrongBucket },
    });
    expect(r.status).toBe(404);

    const k = kitchenPath(chef.id);
    await upload("chef-documents", k);
    const r2 = await chef.b.call(postDoc, {
      body: { kind: "kitchen_photo", path: k },
    });
    expect(r2.status).toBe(404);
    const priv = await privRow(chef.id);
    expect(priv.id_document_path).toBeNull();
    expect(priv.kitchen_photo_paths).toEqual([]);
  });
});

const DOCS = [
  {
    kind: "id_document",
    pathCol: "id_document_path",
    statusCol: "id_check_status",
    otherStatusCol: "food_handler_status",
    key: "id",
    otherKey: "foodHandler",
    docKey: "idDocumentPath",
    make: (c: string, ext?: string) => idPath(c, ext ?? "png"),
  },
  {
    kind: "food_handler",
    pathCol: "food_handler_path",
    statusCol: "food_handler_status",
    otherStatusCol: "id_check_status",
    key: "foodHandler",
    otherKey: "id",
    docKey: "foodHandlerPath",
    make: (c: string, ext?: string) => fhPath(c, ext ?? "pdf"),
  },
] as const;

describe.each(DOCS)(
  "registering a $kind (MOCK re-verification reset, N1)",
  (d) => {
    it.each(CHECK_STATUSES)(
      "replacing a document whose check is %s",
      async (status) => {
        const chef = await newChef();
        const oldPath = d.make(chef.id);
        const newPath = d.make(chef.id);
        await setPriv(chef.id, {
          [d.pathCol]: oldPath,
          [d.statusCol]: status,
          [d.otherStatusCol]: "verified",
          kitchen_status: "verified",
          police_check_status: "verified",
        });
        await setChef(chef.id, { chef_home_enabled: true });
        await upload("chef-documents", newPath);

        const r = await chef.b.call(postDoc, {
          body: { kind: d.kind, path: newPath },
        });
        expect(r.status, r.text).toBe(200);
        expect(r.body.application.documents[d.docKey]).toBe(newPath);
        expect(r.body.application.checks[d.key]).toBe(AFTER_CHANGE[status]);
        // nothing else moves: the other document, the kitchen, chef's home and the police check
        expect(r.body.application.checks[d.otherKey]).toBe("verified");
        expect(r.body.application.checks.kitchen).toBe("verified");
        expect(r.body.application.checks.police).toBe("verified");
        expect(r.body.application.chefHomeEnabled).toBe(true);
        const priv = await privRow(chef.id);
        expect(priv[d.pathCol]).toBe(newPath);
        expect(priv[d.statusCol]).toBe(AFTER_CHANGE[status]);
        expect(priv[d.otherStatusCol]).toBe("verified");
        expect((await chefRow(chef.id)).chef_home_enabled).toBe(true);
      },
    );

    it("the first upload leaves a not_started check alone (submit moves it later)", async () => {
      const chef = await newChef();
      const p = d.make(chef.id);
      await upload("chef-documents", p);
      const r = await chef.b.call(postDoc, { body: { kind: d.kind, path: p } });
      expect(r.status, r.text).toBe(200);
      expect(r.body.application.checks[d.key]).toBe("not_started");
      expect(r.body.application.documents[d.docKey]).toBe(p);
    });

    it("registering the same path again changes nothing: a verified check stays verified", async () => {
      const chef = await newChef();
      const p = d.make(chef.id);
      await upload("chef-documents", p);
      await setPriv(chef.id, { [d.pathCol]: p, [d.statusCol]: "verified" });
      const r = await chef.b.call(postDoc, { body: { kind: d.kind, path: p } });
      expect(r.status, r.text).toBe(200);
      expect(r.body.application.checks[d.key]).toBe("verified");
    });

    it("re-registering the same path leaves a failed check failed and does not touch the row at all (tester T12)", async () => {
      const chef = await newChef();
      const p = d.make(chef.id);
      await upload("chef-documents", p);
      await setPriv(chef.id, { [d.pathCol]: p, [d.statusCol]: "failed" });
      const before = await privRow(chef.id);
      const r = await chef.b.call(postDoc, { body: { kind: d.kind, path: p } });
      expect(r.status, r.text).toBe(200);
      expect(r.body.application.checks[d.key]).toBe("failed");
      expect(await privRow(chef.id)).toEqual(before); // not even updated_at moved
    });

    it("the replaced file stays in storage for the admin's records; the new path is what is stored", async () => {
      const chef = await newChef();
      const oldPath = d.make(chef.id);
      const newPath = d.make(chef.id);
      await upload("chef-documents", oldPath);
      await upload("chef-documents", newPath);
      await chef.b.call(postDoc, { body: { kind: d.kind, path: oldPath } });
      await chef.b.call(postDoc, { body: { kind: d.kind, path: newPath } });
      expect((await privRow(chef.id))[d.pathCol]).toBe(newPath);
      expect(await objectExists("chef-documents", oldPath)).toBe(true);
    });
  },
);

describe.each(["approved", "rejected"] as const)(
  "a %s chef registering new files (tester T4)",
  (status) => {
    async function setup() {
      const chef = await newChef();
      const oldPhoto = kitchenPath(chef.id);
      await setChef(chef.id, {
        status,
        location_options: BOTH,
        chef_home_enabled: true,
      });
      await setPriv(chef.id, {
        reject_reason: status === "rejected" ? "Photo unclear" : null,
        id_check_status: "verified",
        food_handler_status: "verified",
        kitchen_status: "verified",
        kitchen_photo_paths: [oldPhoto],
      });
      return chef;
    }

    it("a new ID and food-handler file reset only their own check; the status and reason stay", async () => {
      const chef = await setup();
      const idp = idPath(chef.id);
      const fhp = fhPath(chef.id);
      await upload("chef-documents", idp);
      await upload("chef-documents", fhp);
      const a = await chef.b.call(postDoc, {
        body: { kind: "id_document", path: idp },
      });
      expect(a.status, a.text).toBe(200);
      expect(a.body.application).toMatchObject({
        status,
        checks: { id: "pending", foodHandler: "verified", kitchen: "verified" },
        chefHomeEnabled: true,
      });
      const b = await chef.b.call(postDoc, {
        body: { kind: "food_handler", path: fhp },
      });
      expect(b.body.application).toMatchObject({
        status,
        checks: { id: "pending", foodHandler: "pending", kitchen: "verified" },
      });
      expect(b.body.application.rejectReason).toBe(
        status === "rejected" ? "Photo unclear" : null,
      );
      expect((await chefRow(chef.id)).status).toBe(status);
    });

    it("a new kitchen photo resets the kitchen and switches chef's home off; the status stays", async () => {
      const chef = await setup();
      const p = kitchenPath(chef.id);
      await upload("kitchen-photos", p);
      const r = await chef.b.call(postDoc, {
        body: { kind: "kitchen_photo", path: p },
      });
      expect(r.status, r.text).toBe(200);
      expect(r.body.application).toMatchObject({
        status,
        checks: { id: "verified", kitchen: "pending" },
        chefHomeEnabled: false,
      });
      const row = await chefRow(chef.id);
      expect(row.status).toBe(status);
      expect(row.chef_home_enabled).toBe(false);
    });
  },
);

describe("registering kitchen photos", () => {
  async function kitchenChef(status: string, options: string[] = BOTH) {
    const chef = await newChef();
    const first = kitchenPath(chef.id);
    await setChef(chef.id, {
      location_options: options,
      chef_home_enabled: true,
    });
    await setPriv(chef.id, {
      kitchen_photo_paths: [first],
      kitchen_status: status,
      id_check_status: "verified",
      food_handler_status: "verified",
    });
    return { chef, first };
  }

  it("adds a photo; the first photo leaves a not_started kitchen check alone", async () => {
    const chef = await newChef();
    const p = kitchenPath(chef.id, "webp");
    await upload("kitchen-photos", p);
    const r = await chef.b.call(postDoc, {
      body: { kind: "kitchen_photo", path: p },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.application.documents.kitchenPhotoPaths).toEqual([p]);
    expect(r.body.application.checks.kitchen).toBe("not_started");
  });

  it.each(CHECK_STATUSES)(
    "adding a photo while the kitchen check is %s: check -> expected status, chef's home off",
    async (status) => {
      const { chef, first } = await kitchenChef(status);
      const p = kitchenPath(chef.id);
      await upload("kitchen-photos", p);
      const r = await chef.b.call(postDoc, {
        body: { kind: "kitchen_photo", path: p },
      });
      expect(r.status, r.text).toBe(200);
      expect(r.body.application.documents.kitchenPhotoPaths).toEqual([
        first,
        p,
      ]);
      expect(r.body.application.checks.kitchen).toBe(AFTER_CHANGE[status]);
      expect(r.body.application.chefHomeEnabled).toBe(false);
      expect(r.body.application.checks.id).toBe("verified");
      expect(r.body.application.checks.foodHandler).toBe("verified");
      expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
      expect((await privRow(chef.id)).kitchen_status).toBe(
        AFTER_CHANGE[status],
      );
    },
  );

  it("registering a photo that is already registered is a no-op (verified stays verified, chef's home stays on)", async () => {
    const { chef, first } = await kitchenChef("verified");
    await upload("kitchen-photos", first);
    const r = await chef.b.call(postDoc, {
      body: { kind: "kitchen_photo", path: first },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.application.checks.kitchen).toBe("verified");
    expect(r.body.application.chefHomeEnabled).toBe(true);
    expect(r.body.application.documents.kitchenPhotoPaths).toEqual([first]);
  });

  it("a new photo resets the kitchen even when chef's home is not currently offered (tester T2)", async () => {
    const { chef } = await kitchenChef("verified", ["customer_home"]);
    const p = kitchenPath(chef.id);
    await upload("kitchen-photos", p);
    const r = await chef.b.call(postDoc, {
      body: { kind: "kitchen_photo", path: p },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.application.checks.kitchen).toBe("pending");
    expect(r.body.application.chefHomeEnabled).toBe(false);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
  });

  it("a failed kitchen check stays failed when the same photo is registered again (tester T12)", async () => {
    const { chef, first } = await kitchenChef("failed");
    await upload("kitchen-photos", first);
    const before = await privRow(chef.id);
    const r = await chef.b.call(postDoc, {
      body: { kind: "kitchen_photo", path: first },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.application.checks.kitchen).toBe("failed");
    expect(await privRow(chef.id)).toEqual(before);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(true);
  });

  it("an 11th photo is 409 INVALID_STATE, and a re-registration at the limit still works", async () => {
    const chef = await newChef();
    const paths = Array.from({ length: 10 }, () => kitchenPath(chef.id));
    await setPriv(chef.id, { kitchen_photo_paths: paths });
    const extra = kitchenPath(chef.id);
    await upload("kitchen-photos", extra);
    const r = await chef.b.call(postDoc, {
      body: { kind: "kitchen_photo", path: extra },
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("INVALID_STATE");
    expect((await privRow(chef.id)).kitchen_photo_paths).toEqual(paths);
    const again = await chef.b.call(postDoc, {
      body: { kind: "kitchen_photo", path: paths[3] },
    });
    expect(again.status).toBe(200);
  });

  it("registering several photos at the same time keeps every one (no lost update)", async () => {
    const chef = await newChef();
    const paths = Array.from({ length: 6 }, () => kitchenPath(chef.id));
    for (const p of paths) await upload("kitchen-photos", p);
    const replies = await Promise.all(
      paths.map((path) =>
        chef.b.call(postDoc, { body: { kind: "kitchen_photo", path } }),
      ),
    );
    expect(
      replies.map((r) => r.status),
      replies.map((r) => r.text).join("\n"),
    ).toEqual(paths.map(() => 200));
    const stored = (await privRow(chef.id)).kitchen_photo_paths as string[];
    expect([...stored].sort()).toEqual([...paths].sort());
  });
});

describe("parallel requests at the photo limit (tester T9)", () => {
  async function uploaded(chefId: string, n: number): Promise<string[]> {
    const paths = Array.from({ length: n }, () => kitchenPath(chefId));
    for (const p of paths) await upload("kitchen-photos", p);
    return paths;
  }
  const register = (chef: Chef, path: string) =>
    chef.b.call(postDoc, { body: { kind: "kitchen_photo", path } });

  it("the maximum of 10 photos registered at once from an empty list: all 200, all 10 stored", async () => {
    const chef = await newChef();
    const paths = await uploaded(chef.id, 10);
    const replies = await Promise.all(paths.map((p) => register(chef, p)));
    expect(
      replies.map((r) => r.status),
      replies.map((r) => r.text).join("\n"),
    ).toEqual(paths.map(() => 200));
    const stored = (await privRow(chef.id)).kitchen_photo_paths as string[];
    expect([...stored].sort()).toEqual([...paths].sort());
  });

  it("10 stored and 2 more registered at once: both are 409 and nothing changes", async () => {
    const chef = await newChef();
    const stored = Array.from({ length: 10 }, () => kitchenPath(chef.id));
    await setPriv(chef.id, { kitchen_photo_paths: stored });
    const extra = await uploaded(chef.id, 2);
    const replies = await Promise.all(extra.map((p) => register(chef, p)));
    expect(replies.map((r) => r.status)).toEqual([409, 409]);
    expect(replies.map((r) => r.body.error.code)).toEqual([
      "INVALID_STATE",
      "INVALID_STATE",
    ]);
    expect((await privRow(chef.id)).kitchen_photo_paths).toEqual(stored);
  });

  it("5 stored and 8 more at once: exactly 5 succeed (the limit holds under a race)", async () => {
    const chef = await newChef();
    const stored = Array.from({ length: 5 }, () => kitchenPath(chef.id));
    await setPriv(chef.id, { kitchen_photo_paths: stored });
    const extra = await uploaded(chef.id, 8);
    const replies = await Promise.all(extra.map((p) => register(chef, p)));
    const ok = replies.filter((r) => r.status === 200).length;
    const full = replies.filter((r) => r.status === 409).length;
    expect({ ok, full }).toEqual({ ok: 5, full: 3 });
    expect(
      ((await privRow(chef.id)).kitchen_photo_paths as string[]).length,
    ).toBe(10);
  });

  it("an acknowledgement saved at the same time as a photo registration: both survive", async () => {
    const chef = await newChef();
    const [p] = await uploaded(chef.id, 1);
    const [ack, reg] = await Promise.all([
      chef.b.call(patchApp, {
        method: "PATCH",
        body: { acknowledgeAllergenStatement: true, bio: "parallel" },
      }),
      register(chef, p),
    ]);
    expect(ack.status, ack.text).toBe(200);
    expect(reg.status, reg.text).toBe(200);
    const priv = await privRow(chef.id);
    expect(priv.allergen_ack_at).not.toBeNull();
    expect(priv.kitchen_photo_paths).toEqual([p]);
    expect((await chefRow(chef.id)).bio).toBe("parallel");
  });
});

describe("DELETE /api/chef/application/documents", () => {
  it("only kitchen photos can be removed: other kinds are 422", async () => {
    const chef = await newChef();
    for (const kind of [
      "id_document",
      "food_handler",
      "profile_photo",
      undefined,
      5,
    ]) {
      const r = await chef.b.call(deleteDoc, {
        method: "DELETE",
        body: { kind, path: idPath(chef.id) },
      });
      expect(r.status, String(kind)).toBe(422);
      expect(r.body.error.fields.kind).toBeTruthy();
    }
  });

  it("rejects unknown keys and bad paths (422), and a foreign folder (403) without touching the other chef", async () => {
    const chef = await newChef();
    const victim = await newChef();
    const theirs = kitchenPath(victim.id);
    await upload("kitchen-photos", theirs);
    await setPriv(victim.id, {
      kitchen_photo_paths: [theirs],
      kitchen_status: "verified",
    });
    await setChef(victim.id, { chef_home_enabled: true });

    const extra = await chef.b.call(deleteDoc, {
      method: "DELETE",
      body: {
        kind: "kitchen_photo",
        path: kitchenPath(chef.id),
        chefId: victim.id,
      },
    });
    expect(extra.status).toBe(422);
    for (const path of [
      `${chef.id}/../${theirs}`,
      `${chef.id}/..`,
      "",
      5,
      null,
      undefined,
    ]) {
      const r = await chef.b.call(deleteDoc, {
        method: "DELETE",
        body: { kind: "kitchen_photo", path },
      });
      expect(r.status, JSON.stringify(path)).toBe(422);
    }
    const foreign = await chef.b.call(deleteDoc, {
      method: "DELETE",
      body: { kind: "kitchen_photo", path: theirs },
    });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe("FORBIDDEN");

    // the victim's photo, registration, MOCK check and chef's home are all intact
    expect(await objectExists("kitchen-photos", theirs)).toBe(true);
    const row = await privRow(victim.id);
    expect(row.kitchen_photo_paths).toEqual([theirs]);
    expect(row.kitchen_status).toBe("verified");
    expect((await chefRow(victim.id)).chef_home_enabled).toBe(true);
  });

  it("a path with another kind's file name is 422 and no object is deleted (tester T10)", async () => {
    const chef = await newChef();
    const id = idPath(chef.id);
    const photo = photoPath(chef.id);
    // the same names exist in the chef-documents / profile-photos buckets and in kitchen-photos
    await upload("chef-documents", id);
    await upload("kitchen-photos", id);
    await upload("profile-photos", photo);
    await upload("kitchen-photos", photo);
    await setPriv(chef.id, { kitchen_photo_paths: [id, photo] });
    for (const path of [id, photo]) {
      const r = await chef.b.call(deleteDoc, {
        method: "DELETE",
        body: { kind: "kitchen_photo", path },
      });
      expect(r.status, path).toBe(422);
      expect(r.body.error.fields.path).toBeTruthy();
    }
    expect(await objectExists("chef-documents", id)).toBe(true);
    expect(await objectExists("kitchen-photos", id)).toBe(true);
    expect(await objectExists("profile-photos", photo)).toBe(true);
    expect(await objectExists("kitchen-photos", photo)).toBe(true);
    expect((await privRow(chef.id)).kitchen_photo_paths).toEqual([id, photo]);
  });

  it("404 for a photo that is not registered, and the object is NOT deleted", async () => {
    const chef = await newChef();
    const p = kitchenPath(chef.id);
    await upload("kitchen-photos", p); // uploaded but never registered
    const r = await chef.b.call(deleteDoc, {
      method: "DELETE",
      body: { kind: "kitchen_photo", path: p },
    });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
    expect(await objectExists("kitchen-photos", p)).toBe(true);
  });

  it("removes the registration and the object, and applies the kitchen reset", async () => {
    const chef = await newChef();
    const keep = kitchenPath(chef.id);
    const drop = kitchenPath(chef.id);
    await upload("kitchen-photos", keep);
    await upload("kitchen-photos", drop);
    await setChef(chef.id, { location_options: BOTH, chef_home_enabled: true });
    await setPriv(chef.id, {
      kitchen_photo_paths: [keep, drop],
      kitchen_status: "verified",
      id_check_status: "verified",
    });
    const r = await chef.b.call(deleteDoc, {
      method: "DELETE",
      body: { kind: "kitchen_photo", path: drop },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.application.documents.kitchenPhotoPaths).toEqual([keep]);
    expect(r.body.application.checks.kitchen).toBe("pending");
    expect(r.body.application.checks.id).toBe("verified");
    expect(r.body.application.chefHomeEnabled).toBe(false);
    expect((await privRow(chef.id)).kitchen_photo_paths).toEqual([keep]);
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
    expect(await objectExists("kitchen-photos", drop)).toBe(false);
    expect(await objectExists("kitchen-photos", keep)).toBe(true);
    // removing it again: it is gone
    const again = await chef.b.call(deleteDoc, {
      method: "DELETE",
      body: { kind: "kitchen_photo", path: drop },
    });
    expect(again.status).toBe(404);
  });

  it.each(CHECK_STATUSES)(
    "removing a photo while the kitchen check is %s",
    async (status) => {
      const chef = await newChef();
      const p = kitchenPath(chef.id);
      await setChef(chef.id, { chef_home_enabled: true });
      await setPriv(chef.id, {
        kitchen_photo_paths: [p],
        kitchen_status: status,
      });
      const r = await chef.b.call(deleteDoc, {
        method: "DELETE",
        body: { kind: "kitchen_photo", path: p },
      });
      expect(r.status, r.text).toBe(200);
      expect(r.body.application.checks.kitchen).toBe(AFTER_CHANGE[status]);
      expect(r.body.application.chefHomeEnabled).toBe(false);
      expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
    },
  );

  it("a registered photo whose object is already gone can still be removed", async () => {
    const chef = await newChef();
    const p = kitchenPath(chef.id);
    await setPriv(chef.id, { kitchen_photo_paths: [p] });
    const r = await chef.b.call(deleteDoc, {
      method: "DELETE",
      body: { kind: "kitchen_photo", path: p },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.application.documents.kitchenPhotoPaths).toEqual([]);
  });
});

describe("the browser flow: upload with the chef's own session, then register", () => {
  it("works through Storage RLS end to end, and the chef cannot read the ID back", async () => {
    const chef = await newChef();
    const client = await chefClient(chef.email);
    const ids = idPath(chef.id, "png");
    const fh = fhPath(chef.id, "pdf");
    const k = kitchenPath(chef.id, "png");
    const ph = photoPath(chef.id, "png");
    const png = new Blob([PNG], { type: "image/png" });
    const pdf = new Blob([PDF], { type: "application/pdf" });
    for (const [bucket, path, blob] of [
      ["chef-documents", ids, png],
      ["chef-documents", fh, pdf],
      ["kitchen-photos", k, png],
      ["profile-photos", ph, png],
    ] as const) {
      const up = await client.storage
        .from(bucket)
        .upload(path, blob, { contentType: blob.type });
      expect(up.error, `${bucket}/${path}`).toBeNull();
    }
    expect(
      (await chef.b.call(postDoc, { body: { kind: "id_document", path: ids } }))
        .status,
    ).toBe(200);
    expect(
      (await chef.b.call(postDoc, { body: { kind: "food_handler", path: fh } }))
        .status,
    ).toBe(200);
    expect(
      (await chef.b.call(postDoc, { body: { kind: "kitchen_photo", path: k } }))
        .status,
    ).toBe(200);
    const r = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { photoPath: ph },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.photoPath).toBe(ph);
    expect(r.body.documents).toEqual({
      idDocumentPath: ids,
      foodHandlerPath: fh,
      kitchenPhotoPaths: [k],
    });
    // only the admin can read ID documents back (storage policy), never the chef
    const dl = await client.storage.from("chef-documents").download(ids);
    expect(dl.error).not.toBeNull();
  });
});

describe("lost-race handling (optimistic lock on chef_private)", () => {
  async function asChef(chef: Chef) {
    setCurrentJar(chef.b.jar);
    return requireChef();
  }

  it("an admin verdict that lands between the read and the write cannot leave a swapped kitchen photo verified", async () => {
    const chef = await newChef();
    const oldP = kitchenPath(chef.id);
    const newP = kitchenPath(chef.id);
    await upload("kitchen-photos", newP);
    await setChef(chef.id, {
      location_options: BOTH,
      chef_home_enabled: false,
    });
    await setPriv(chef.id, {
      kitchen_photo_paths: [oldP],
      kitchen_status: "pending",
    });

    const c = await asChef(chef);
    let reads = 0;
    await registerDocument(
      c,
      { kind: "kitchen_photo", bucket: "kitchen-photos", path: newP },
      {
        afterRead: async () => {
          if (reads++ > 0) return;
          // MOCK admin: verifies the OLD photos and enables chef's home while the chef's request is in flight
          await setPriv(chef.id, { kitchen_status: "verified" });
          await setChef(chef.id, { chef_home_enabled: true });
        },
      },
    );
    expect(reads).toBe(2); // the first write lost the race and was rebuilt from the new state
    const priv = await privRow(chef.id);
    expect(priv.kitchen_photo_paths).toEqual([oldP, newP]);
    expect(priv.kitchen_status).toBe("pending");
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
  });

  it("the same for a swapped ID document: verified in between -> pending after", async () => {
    const chef = await newChef();
    const oldP = idPath(chef.id);
    const newP = idPath(chef.id);
    await upload("chef-documents", newP);
    await setPriv(chef.id, {
      id_document_path: oldP,
      id_check_status: "pending",
    });
    const c = await asChef(chef);
    let reads = 0;
    await registerDocument(
      c,
      { kind: "id_document", bucket: "chef-documents", path: newP },
      {
        afterRead: async () => {
          if (reads++ === 0)
            await setPriv(chef.id, { id_check_status: "verified" });
        },
      },
    );
    const priv = await privRow(chef.id);
    expect(priv.id_document_path).toBe(newP);
    expect(priv.id_check_status).toBe("pending");
  });

  it("the same for a kitchen address change made with PATCH", async () => {
    const chef = await newChef();
    await setChef(chef.id, { location_options: BOTH });
    await setPriv(chef.id, {
      kitchen_address_line: "1 Old St",
      kitchen_city: "Mississauga",
      kitchen_postal_code: "L5B1A1",
      kitchen_status: "pending",
    });
    const c = await asChef(chef);
    let reads = 0;
    await patchApplication(
      c,
      {
        kitchenAddress: {
          line: "2 New St",
          city: "Mississauga",
          postalCode: "L5B1A1",
        },
      },
      {
        afterRead: async () => {
          if (reads++ > 0) return;
          await setPriv(chef.id, { kitchen_status: "verified" });
          await setChef(chef.id, { chef_home_enabled: true });
        },
      },
    );
    const priv = await privRow(chef.id);
    expect(priv.kitchen_address_line).toBe("2 New St");
    expect(priv.kitchen_status).toBe("pending");
    expect((await chefRow(chef.id)).chef_home_enabled).toBe(false);
  });

  it("removing a kitchen photo also survives a verdict landing in between", async () => {
    const chef = await newChef();
    const a = kitchenPath(chef.id);
    const b = kitchenPath(chef.id);
    await setPriv(chef.id, {
      kitchen_photo_paths: [a, b],
      kitchen_status: "pending",
    });
    const c = await asChef(chef);
    let reads = 0;
    await removeKitchenPhoto(
      c,
      { bucket: "kitchen-photos", path: b },
      {
        afterRead: async () => {
          if (reads++ === 0)
            await setPriv(chef.id, { kitchen_status: "verified" });
        },
      },
    );
    const priv = await privRow(chef.id);
    expect(priv.kitchen_photo_paths).toEqual([a]);
    expect(priv.kitchen_status).toBe("pending");
  });

  it("submit never overwrites a check that became verified in between (N2)", async () => {
    const chef = await readyChef();
    const c = await asChef(chef);
    let reads = 0;
    await submitApplication(c, {
      afterRead: async () => {
        if (reads++ === 0)
          await setPriv(chef.id, { id_check_status: "verified" }); // MOCK admin verdict
      },
    });
    const priv = await privRow(chef.id);
    expect(priv.id_check_status).toBe("verified");
    expect(priv.food_handler_status).toBe("pending");
  });

  it("gives up with 409 INVALID_STATE after repeated lost races, and registers nothing", async () => {
    const chef = await newChef();
    const p = kitchenPath(chef.id);
    await upload("kitchen-photos", p);
    const c = await asChef(chef);
    let reads = 0;
    await expect(
      registerDocument(
        c,
        { kind: "kitchen_photo", bucket: "kitchen-photos", path: p },
        {
          afterRead: async () => {
            reads++;
            await setPriv(chef.id, { reject_reason: uuid() }); // any change bumps updated_at
          },
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(reads).toBeGreaterThan(1);
    expect((await privRow(chef.id)).kitchen_photo_paths).toEqual([]);
  });

  // Any change to the row bumps updated_at, so the chef's conditional write loses every time.
  const loseEveryRace = (id: string) => ({
    afterRead: async () => {
      await setPriv(id, { reject_reason: uuid() });
    },
  });

  it("PATCH gives up the same way (409 INVALID_STATE): chef_private fields are not saved, but chefs fields of the same request already are (tester F2)", async () => {
    const chef = await newChef();
    await setChef(chef.id, {
      location_options: BOTH,
      chef_home_enabled: true,
      bio: "old bio",
    });
    await setPriv(chef.id, {
      kitchen_status: "verified",
      kitchen_address_line: "1 Old St",
      kitchen_city: "Mississauga",
      kitchen_postal_code: "L5B1A1",
    });
    const c = await asChef(chef);
    await expect(
      patchApplication(
        c,
        {
          bio: "saved anyway",
          hourlyRateCents: 4100,
          acknowledgeAllergenStatement: true,
          kitchenAddress: {
            line: "2 New St",
            city: "Mississauga",
            postalCode: "L5B1A1",
          },
        },
        loseEveryRace(chef.id),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    // chef_private: the conditional write never landed
    const priv = await privRow(chef.id);
    expect(priv.kitchen_address_line).toBe("1 Old St");
    expect(priv.allergen_ack_at).toBeNull();
    expect(priv.kitchen_status).toBe("verified");
    // chefs: written first, so these are already saved, including the safe switch-off of chef's home
    const row = await chefRow(chef.id);
    expect(row.bio).toBe("saved anyway");
    expect(row.hourly_rate_cents).toBe(4100);
    expect(row.chef_home_enabled).toBe(false);
  });

  it("removing a kitchen photo gives up the same way and keeps the photo and its object", async () => {
    const chef = await newChef();
    const p = kitchenPath(chef.id);
    await upload("kitchen-photos", p);
    await setPriv(chef.id, { kitchen_photo_paths: [p] });
    const c = await asChef(chef);
    await expect(
      removeKitchenPhoto(
        c,
        { bucket: "kitchen-photos", path: p },
        loseEveryRace(chef.id),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await privRow(chef.id)).kitchen_photo_paths).toEqual([p]);
    expect(await objectExists("kitchen-photos", p)).toBe(true);
  });

  it("submit gives up the same way and starts no check", async () => {
    const chef = await readyChef();
    const c = await asChef(chef);
    await expect(
      submitApplication(c, loseEveryRace(chef.id)),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    const priv = await privRow(chef.id);
    expect(priv.id_check_status).toBe("not_started");
    expect(priv.food_handler_status).toBe("not_started");
  });
});
