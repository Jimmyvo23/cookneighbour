import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chefs } from "../../scripts/seed-data";
import {
  ICON_NAMES,
  ensurePhotoPath,
  iconFor,
  isAlreadyThere,
  seedObjectPath,
  type PhotoStore,
} from "../../scripts/seed-photos";
import { UPLOAD_RULES } from "./chef/upload";
import { isSafeStoragePath } from "./chef/dishes";
import { isListable } from "./domain/search";

const OWNER = "11111111-2222-4333-8444-555555555555";

function fakeStore() {
  const objects = new Map<string, Buffer>();
  const calls: { bucket: string; path: string; upsert: boolean | undefined }[] =
    [];
  const store: PhotoStore = {
    async upload(bucket, path, bytes, options) {
      calls.push({ bucket, path, upsert: options.upsert });
      const key = `${bucket}/${path}`;
      if (objects.has(key))
        return {
          error: { message: "The resource already exists", statusCode: "409" },
        };
      objects.set(key, bytes);
      return { error: null };
    },
  };
  return { store, objects, calls };
}

describe("placeholder icons", () => {
  it("are committed PNG files, small, and fit the bucket limits", () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(3);
    for (const name of ICON_NAMES) {
      const file = `scripts/seed-images/${name}.png`;
      expect(existsSync(file), file).toBe(true);
      const bytes = readFileSync(file);
      expect([...bytes.subarray(0, 8)]).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      expect(bytes.length).toBeLessThan(20 * 1024);
      expect(bytes.length).toBeLessThanOrEqual(
        UPLOAD_RULES.profile_photo.maxBytes,
      );
      expect(bytes.length).toBeLessThanOrEqual(
        UPLOAD_RULES.dish_photo.maxBytes,
      );
    }
    expect(Object.keys(UPLOAD_RULES.profile_photo.types)).toContain(
      "image/png",
    );
    expect(Object.keys(UPLOAD_RULES.dish_photo.types)).toContain("image/png");
  });
  it("are picked by a stable rule", () => {
    expect(iconFor("chef:lan-vietnamese")).toBe(iconFor("chef:lan-vietnamese"));
    for (const c of chefs) expect(ICON_NAMES).toContain(iconFor(c.key));
  });
});

describe("seedObjectPath", () => {
  it("has the shape the app accepts: own folder, lower case, right prefix and extension", () => {
    const p = seedObjectPath("profile_photo", OWNER, "chef:lan");
    expect(p.bucket).toBe("profile-photos");
    expect(p.path).toMatch(new RegExp(`^${OWNER}/photo-[0-9a-f-]{36}\\.png$`));
    expect(isSafeStoragePath(p.path)).toBe(true);
    const d = seedObjectPath("dish_photo", OWNER, "dish:lan:pho");
    expect(d.bucket).toBe("dish-photos");
    expect(d.path).toMatch(new RegExp(`^${OWNER}/dish-[0-9a-f-]{36}\\.png$`));
    expect(isSafeStoragePath(d.path)).toBe(true);
  });
  it("is stable for the same asset and different for different assets", () => {
    expect(seedObjectPath("dish_photo", OWNER, "a").path).toBe(
      seedObjectPath("dish_photo", OWNER, "a").path,
    );
    expect(seedObjectPath("dish_photo", OWNER, "a").path).not.toBe(
      seedObjectPath("dish_photo", OWNER, "b").path,
    );
  });
});

describe("ensurePhotoPath", () => {
  const bytes = Buffer.from("png-bytes");
  const base = {
    kind: "profile_photo" as const,
    ownerId: OWNER,
    key: "chef:lan",
    bytes,
    contentType: "image/png",
  };

  it("uploads once, insert-only (upsert false), and returns the new path", async () => {
    const { store, objects, calls } = fakeStore();
    const r = await ensurePhotoPath({ ...base, store, currentPath: null });
    expect(r.action).toBe("uploaded");
    expect(r.path).toMatch(/^11111111-2222-4333-8444-555555555555\/photo-/);
    expect(objects.size).toBe(1);
    expect(calls.every((c) => c.upsert === false)).toBe(true);
  });
  it("does nothing when the row already has a photo (re-run, or a chef changed it)", async () => {
    const { store, calls } = fakeStore();
    const r = await ensurePhotoPath({
      ...base,
      store,
      currentPath: `${OWNER}/photo-own-choice.jpg`,
    });
    expect(r).toEqual({
      action: "kept",
      path: `${OWNER}/photo-own-choice.jpg`,
    });
    expect(calls).toHaveLength(0);
  });
  it("adopts a leftover object from an earlier run that died before the row was updated, without overwriting it", async () => {
    const { store, objects } = fakeStore();
    const first = await ensurePhotoPath({ ...base, store, currentPath: null });
    const before = objects.get(`profile-photos/${first.path}`);
    const second = await ensurePhotoPath({ ...base, store, currentPath: null });
    expect(second.action).toBe("existed");
    expect(second.path).toBe(first.path);
    expect(objects.size).toBe(1);
    expect(objects.get(`profile-photos/${first.path}`)).toBe(before);
  });
  it("fails loudly on any other storage error, without echoing details", async () => {
    const store: PhotoStore = {
      async upload() {
        return { error: { message: "Bucket not found", statusCode: "404" } };
      },
    };
    await expect(
      ensurePhotoPath({ ...base, store, currentPath: null }),
    ).rejects.toThrow(/upload profile-photos/);
  });
});

describe("isAlreadyThere", () => {
  it("recognises the storage duplicate answers only", () => {
    expect(isAlreadyThere({ message: "x", statusCode: "409" })).toBe(true);
    expect(isAlreadyThere({ message: "The resource already exists" })).toBe(
      true,
    );
    expect(isAlreadyThere({ message: "Duplicate" })).toBe(true);
    expect(
      isAlreadyThere({ message: "Bucket not found", statusCode: "404" }),
    ).toBe(false);
  });
});

describe("what a seeded photo does for search (A-20)", () => {
  it("an approved seeded chef with a seeded photo passes isListable; without one it does not", () => {
    const lan = chefs.find((c) => c.key === "lan-vietnamese")!;
    const { path } = seedObjectPath("profile_photo", OWNER, "chef:lan");
    expect(
      isListable({
        bio: lan.bio,
        photoPath: path,
        activeDishCount: lan.dishes.length,
      }),
    ).toBe(true);
    expect(
      isListable({
        bio: lan.bio,
        photoPath: null,
        activeDishCount: lan.dishes.length,
      }),
    ).toBe(false);
  });
});
