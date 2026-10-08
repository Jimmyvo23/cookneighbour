import { describe, expect, it, vi } from "vitest";
import { checkStoragePath } from "@/lib/domain/chef-application";
import {
  newObjectPath,
  uploadChefFile,
  validateUploadFile,
  UploadError,
  type ChefUploader,
} from "@/lib/chef/upload";

const USER = "11111111-1111-4111-8111-111111111111";
const png = { type: "image/png", size: 1000 };

describe("validateUploadFile", () => {
  it("accepts allowed types and sizes", () => {
    expect(
      validateUploadFile("id_document", { type: "application/pdf", size: 5 }),
    ).toBeNull();
    expect(
      validateUploadFile("kitchen_photo", { type: "image/webp", size: 5 }),
    ).toBeNull();
    expect(validateUploadFile("profile_photo", png)).toBeNull();
  });
  it("rejects a PDF for photos and webp for documents", () => {
    expect(
      validateUploadFile("kitchen_photo", { type: "application/pdf", size: 5 }),
    ).toMatch(/JPEG, PNG or WebP/);
    expect(
      validateUploadFile("id_document", { type: "image/webp", size: 5 }),
    ).toMatch(/JPEG, PNG or PDF/);
  });
  it("rejects files over the limit and empty files", () => {
    expect(
      validateUploadFile("id_document", {
        type: "image/png",
        size: 10 * 1024 * 1024 + 1,
      }),
    ).toMatch(/10 MB/);
    expect(
      validateUploadFile("kitchen_photo", {
        type: "image/png",
        size: 5 * 1024 * 1024 + 1,
      }),
    ).toMatch(/5 MB/);
    expect(
      validateUploadFile("kitchen_photo", { type: "image/png", size: 0 }),
    ).toMatch(/empty/);
  });
  it("asks for a file when there is none", () => {
    expect(validateUploadFile("id_document", null)).toMatch(/Choose a file/);
  });
});

describe("newObjectPath", () => {
  it.each([
    ["id_document", "image/png", "chef-documents"],
    ["food_handler", "application/pdf", "chef-documents"],
    ["kitchen_photo", "image/jpeg", "kitchen-photos"],
    ["profile_photo", "image/webp", "profile-photos"],
  ] as const)("%s path passes the server rule", (target, type, bucket) => {
    const r = newObjectPath(target, USER, type);
    expect(r.bucket).toBe(bucket);
    expect(r.path).toBe(r.path.toLowerCase());
    const c = checkStoragePath(target, USER, r.path);
    expect(c.ok).toBe(true);
  });
  it("uses a fresh name every time, in the user's own folder", () => {
    const a = newObjectPath("id_document", USER, "image/png").path;
    const b = newObjectPath("id_document", USER, "image/png").path;
    expect(a).not.toBe(b);
    expect(a.startsWith(`${USER}/id-`)).toBe(true);
  });
  it("lower-cases whatever uuid it is given", () => {
    const r = newObjectPath(
      "id_document",
      USER,
      "image/png",
      "ABCDEF12-1234-4234-8234-ABCDEF123456",
    );
    expect(r.path).toBe(`${USER}/id-abcdef12-1234-4234-8234-abcdef123456.png`);
  });
});

describe("uploadChefFile", () => {
  it("uploads once with upsert false and returns the path", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const uploader: ChefUploader = { upload };
    const file = new File(["x"], "scan.png", { type: "image/png" });
    const r = await uploadChefFile("id_document", USER, file, uploader);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith("chef-documents", r.path, file, {
      upsert: false,
      contentType: "image/png",
    });
    expect(r.path.startsWith(`${USER}/id-`)).toBe(true);
  });
  it("throws UploadError with a safe message when storage fails", async () => {
    const uploader: ChefUploader = {
      upload: vi.fn().mockResolvedValue({
        error: { message: "secret internals bucket xyz" },
      }),
    };
    const file = new File(["x"], "a.png", { type: "image/png" });
    const err = await uploadChefFile(
      "kitchen_photo",
      USER,
      file,
      uploader,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err.message).not.toMatch(/secret/);
    expect(err.message).toMatch(/could not upload/i);
  });
  it("throws UploadError when the uploader itself throws", async () => {
    const uploader: ChefUploader = {
      upload: vi.fn().mockRejectedValue(new Error("offline")),
    };
    const file = new File(["x"], "a.png", { type: "image/png" });
    await expect(
      uploadChefFile("kitchen_photo", USER, file, uploader),
    ).rejects.toBeInstanceOf(UploadError);
  });
  it("does not upload an invalid file", async () => {
    const upload = vi.fn();
    const file = new File(["x"], "a.gif", { type: "image/gif" });
    await expect(
      uploadChefFile("kitchen_photo", USER, file, { upload }),
    ).rejects.toBeInstanceOf(UploadError);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("dish photos (T-034)", () => {
  it("builds a fresh lower-case dish-photos path the server accepts", () => {
    const upper = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const { bucket, path } = newObjectPath(
      "dish_photo",
      USER,
      "image/webp",
      upper,
    );
    expect(bucket).toBe("dish-photos");
    expect(path).toBe(`${USER}/dish-${upper.toLowerCase()}.webp`);
    expect(checkStoragePath("dish_photo", USER, path).ok).toBe(true);
  });
  it("uses a new name each time and never overwrites", async () => {
    const calls: { path: string; upsert: boolean }[] = [];
    const uploader: ChefUploader = {
      upload: vi.fn(async (_b, path, _f, o) => {
        calls.push({ path, upsert: o.upsert });
        return { error: null };
      }),
    };
    const file = new File([new Uint8Array(10)], "pho.png", {
      type: "image/png",
    });
    const a = await uploadChefFile("dish_photo", USER, file, uploader);
    const b = await uploadChefFile("dish_photo", USER, file, uploader);
    expect(a.path).not.toBe(b.path);
    expect(calls.every((c) => c.upsert === false)).toBe(true);
  });
  it("refuses PDFs and files over 5 MB", () => {
    expect(
      validateUploadFile("dish_photo", { type: "application/pdf", size: 5 }),
    ).toMatch(/JPEG, PNG or WebP/);
    expect(
      validateUploadFile("dish_photo", {
        type: "image/png",
        size: 5 * 1024 * 1024 + 1,
      }),
    ).toMatch(/5 MB/);
  });
});
