// T-031 tester T8 and T5. The chef routes must never contact Storage for a path they refuse, and
// must not look again at a path that is already registered. A spy wraps the real objectExists
// (calls go through), so a probing implementation that ignores the result cannot pass.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/storage")>();
  return { ...actual, objectExists: vi.fn(actual.objectExists) };
});

import { objectExists as storageExists } from "@/lib/server/storage";
import { freshLimits } from "./harness";
import {
  deleteDoc,
  fhPath,
  idPath,
  kitchenPath,
  newChef,
  patchApp,
  photoPath,
  postDoc,
  privRow,
  setPriv,
  svc,
  upload,
} from "./chef-helpers";

const spy = vi.mocked(storageExists);

beforeEach(() => {
  freshLimits();
  spy.mockClear();
});

describe("a refused path never reaches Storage (tester T8)", () => {
  it("control: the spy is wired, so a legitimate new path is checked exactly once", async () => {
    const chef = await newChef();
    const p = idPath(chef.id);
    await upload("chef-documents", p);
    const r = await chef.b.call(postDoc, {
      body: { kind: "id_document", path: p },
    });
    expect(r.status, r.text).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0].slice(1)).toEqual(["chef-documents", p]);

    spy.mockClear();
    const photo = photoPath(chef.id);
    await upload("profile-photos", photo);
    const ok = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { photoPath: photo },
    });
    expect(ok.status, ok.text).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0].slice(1)).toEqual(["profile-photos", photo]);
  });

  it("a folder that is not the caller's is 403 on POST, DELETE and PATCH with zero storage calls", async () => {
    const chef = await newChef();
    const victim = await newChef();
    // foreign files that really exist, and ones that do not: the answer and the calls are the same
    const real = [
      ["id_document", "chef-documents", idPath(victim.id)],
      ["food_handler", "chef-documents", fhPath(victim.id)],
      ["kitchen_photo", "kitchen-photos", kitchenPath(victim.id)],
    ] as const;
    for (const [, bucket, path] of real) await upload(bucket, path);
    const ghosts = [
      ["id_document", idPath(victim.id)],
      ["food_handler", fhPath(victim.id)],
      ["kitchen_photo", kitchenPath(victim.id)],
    ] as const;

    for (const [kind, , path] of real) {
      const r = await chef.b.call(postDoc, { body: { kind, path } });
      expect(r.status, `POST ${kind}`).toBe(403);
    }
    for (const [kind, path] of ghosts) {
      const r = await chef.b.call(postDoc, { body: { kind, path } });
      expect(r.status, `POST ghost ${kind}`).toBe(403);
    }
    for (const path of [kitchenPath(victim.id), real[2][2]]) {
      const r = await chef.b.call(deleteDoc, {
        method: "DELETE",
        body: { kind: "kitchen_photo", path },
      });
      expect(r.status, "DELETE").toBe(403);
    }
    for (const path of [photoPath(victim.id), `${victim.id}/photo-x.png`]) {
      const r = await chef.b.call(patchApp, {
        method: "PATCH",
        body: { photoPath: path },
      });
      expect(r.status, "PATCH").toBe(403);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("a malformed path is 422 with zero storage calls", async () => {
    const chef = await newChef();
    const c = chef.id;
    for (const path of [
      `${c}/../x`,
      `/${c}/id-x.png`,
      `${c}/id-not-a-uuid.png`,
      `${c}/ID-00000000-0000-4000-8000-000000000000.PNG`,
      "",
      "x".repeat(300),
    ]) {
      const r = await chef.b.call(postDoc, {
        body: { kind: "id_document", path },
      });
      expect(r.status, JSON.stringify(path)).toBe(422);
      const d = await chef.b.call(deleteDoc, {
        method: "DELETE",
        body: { kind: "kitchen_photo", path },
      });
      expect(d.status, JSON.stringify(path)).toBe(422);
      const p = await chef.b.call(patchApp, {
        method: "PATCH",
        body: { photoPath: path },
      });
      expect(p.status, JSON.stringify(path)).toBe(422);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("DELETE of a registered or unregistered photo never calls objectExists", async () => {
    const chef = await newChef();
    const p = kitchenPath(chef.id);
    await upload("kitchen-photos", p);
    await setPriv(chef.id, { kitchen_photo_paths: [p] });
    const gone = await chef.b.call(deleteDoc, {
      method: "DELETE",
      body: { kind: "kitchen_photo", path: kitchenPath(chef.id) },
    });
    expect(gone.status).toBe(404);
    const ok = await chef.b.call(deleteDoc, {
      method: "DELETE",
      body: { kind: "kitchen_photo", path: p },
    });
    expect(ok.status, ok.text).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("a path that is already stored is not looked up again (tester T5)", () => {
  it("re-registering a stored ID, food-handler or kitchen path is 200 even if the object is gone, with no storage call", async () => {
    const chef = await newChef();
    const idp = idPath(chef.id);
    const fhp = fhPath(chef.id);
    const kp = kitchenPath(chef.id);
    await upload("chef-documents", idp);
    await upload("chef-documents", fhp);
    await upload("kitchen-photos", kp);
    for (const [kind, path] of [
      ["id_document", idp],
      ["food_handler", fhp],
      ["kitchen_photo", kp],
    ] as const) {
      const r = await chef.b.call(postDoc, { body: { kind, path } });
      expect(r.status, `first ${kind}`).toBe(200);
    }
    expect(spy).toHaveBeenCalledTimes(3);

    // the objects disappear (an admin cleaned up, or Storage lost them)
    expect(
      (await svc.storage.from("chef-documents").remove([idp, fhp])).error,
    ).toBeNull();
    expect(
      (await svc.storage.from("kitchen-photos").remove([kp])).error,
    ).toBeNull();
    spy.mockClear();
    for (const [kind, path] of [
      ["id_document", idp],
      ["food_handler", fhp],
      ["kitchen_photo", kp],
    ] as const) {
      const r = await chef.b.call(postDoc, { body: { kind, path } });
      expect(r.status, `again ${kind}`).toBe(200);
    }
    expect(spy).not.toHaveBeenCalled();
    const priv = await privRow(chef.id);
    expect(priv.id_document_path).toBe(idp);
    expect(priv.kitchen_photo_paths).toEqual([kp]);

    // a different path whose object is missing is still 404, and that one does look
    const ghost = await chef.b.call(postDoc, {
      body: { kind: "id_document", path: idPath(chef.id) },
    });
    expect(ghost.status).toBe(404);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("PATCH photoPath equal to the stored one is 200 with no storage call, even if the object is gone", async () => {
    const chef = await newChef();
    const photo = photoPath(chef.id);
    await upload("profile-photos", photo);
    expect(
      (
        await chef.b.call(patchApp, {
          method: "PATCH",
          body: { photoPath: photo },
        })
      ).status,
    ).toBe(200);
    expect(
      (await svc.storage.from("profile-photos").remove([photo])).error,
    ).toBeNull();
    spy.mockClear();
    const again = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { photoPath: photo, bio: "same photo, new bio" },
    });
    expect(again.status, again.text).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });
});
