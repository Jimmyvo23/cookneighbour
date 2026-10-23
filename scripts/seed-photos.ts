// T-121: placeholder pictures for the demo seed (pure helpers, unit-tested in src/lib/seed-photos.test.ts).
// The pictures are original flat food icons drawn by scripts/make-seed-images.mjs. No people.
// Imports use the .ts extension because the seed runs under plain Node (lessons-learned section 3).
import { newObjectPath, type UploadKind } from "../src/lib/chef/upload.ts";
import { stableUuid } from "./seed-lib.ts";

export const ICON_NAMES = ["bowl", "pot", "pan", "plate"] as const;
export type IconName = (typeof ICON_NAMES)[number];
export const ICON_CONTENT_TYPE = "image/png";

/** A stable icon for a seeded asset (the same chef or dish always gets the same one). */
export function iconFor(key: string): IconName {
  const n = parseInt(stableUuid(`icon:${key}`).slice(0, 8), 16);
  return ICON_NAMES[n % ICON_NAMES.length];
}

/**
 * Where the seeded picture of one asset lives: `<owner id>/<prefix>-<uuid>.png`, the same shape
 * the app accepts (and `chefs/dishes.photo_path` own-folder checks require). The uuid comes from the
 * asset key, so a re-run (or a run that died half way) finds the same name instead of piling up
 * new objects. Objects are never overwritten: see ensurePhotoPath.
 */
export function seedObjectPath(
  kind: Extract<UploadKind, "profile_photo" | "dish_photo">,
  ownerId: string,
  assetKey: string,
): { bucket: string; path: string } {
  return newObjectPath(
    kind,
    ownerId,
    ICON_CONTENT_TYPE,
    stableUuid(`photo:${kind}:${assetKey}`),
  );
}

export interface StorageError {
  message: string;
  statusCode?: string | number;
}
export interface PhotoStore {
  upload(
    bucket: string,
    path: string,
    bytes: Buffer,
    options: { upsert: false; contentType: string },
  ): Promise<{ error: StorageError | null }>;
}

/** Storage answers 409 / "already exists" when an insert-only upload meets an existing name. */
export function isAlreadyThere(error: StorageError): boolean {
  return (
    String(error.statusCode ?? "") === "409" ||
    /already exists|duplicate/i.test(error.message)
  );
}

/**
 * Makes sure one seeded row has a picture and returns the path to store.
 * - The row already has a photo (an earlier run, or a chef changed it): left alone, nothing uploaded.
 * - Otherwise the picture is uploaded insert-only (upsert false). If the object is already there
 *   (an earlier run died before the row was updated) it is adopted as it is, never overwritten.
 * Error text from storage is not repeated (it may name buckets or policies).
 */
export async function ensurePhotoPath(opts: {
  store: PhotoStore;
  kind: Extract<UploadKind, "profile_photo" | "dish_photo">;
  ownerId: string;
  key: string;
  bytes: Buffer;
  contentType: string;
  currentPath: string | null;
}): Promise<{ path: string; action: "kept" | "uploaded" | "existed" }> {
  if (opts.currentPath) return { path: opts.currentPath, action: "kept" };
  const { bucket, path } = seedObjectPath(opts.kind, opts.ownerId, opts.key);
  const { error } = await opts.store.upload(bucket, path, opts.bytes, {
    upsert: false,
    contentType: opts.contentType,
  });
  if (!error) return { path, action: "uploaded" };
  if (isAlreadyThere(error)) return { path, action: "existed" };
  throw new Error(
    `upload ${bucket} failed (status ${error.statusCode ?? "unknown"})`,
  );
}
