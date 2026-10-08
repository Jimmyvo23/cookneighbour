// Chef file uploads (T-033). The browser uploads straight to Supabase Storage with the chef's own
// session, then registers the path with the API (docs/api-contract.md section 5). File names are
// fresh and lower case, in the chef's own folder, and never overwrite (upsert: false), because the
// chef has no update right on these buckets and the server only accepts names of this shape.
import type { StorageTarget } from "@/lib/domain/chef-application";

const MB = 1024 * 1024;

interface Rule {
  bucket: string;
  prefix: string;
  maxBytes: number;
  /** MIME type -> lower-case extension. Mirrors the bucket limits in the storage migration. */
  types: Record<string, string>;
  /** For example "JPEG, PNG or PDF". */
  kindsText: string;
  allowedText: string;
}

const PHOTO_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const DOC_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

/** Everything a chef can upload: the application files and, since T-034, dish photos. */
export type UploadKind = StorageTarget | "dish_photo";

export const UPLOAD_RULES: Record<UploadKind, Rule> = {
  dish_photo: {
    bucket: "dish-photos",
    prefix: "dish",
    maxBytes: 5 * MB,
    types: PHOTO_TYPES,
    kindsText: "JPEG, PNG or WebP",
    allowedText: "JPEG, PNG or WebP, up to 5 MB",
  },
  id_document: {
    bucket: "chef-documents",
    prefix: "id",
    maxBytes: 10 * MB,
    types: DOC_TYPES,
    kindsText: "JPEG, PNG or PDF",
    allowedText: "JPEG, PNG or PDF, up to 10 MB",
  },
  food_handler: {
    bucket: "chef-documents",
    prefix: "food-handler",
    maxBytes: 10 * MB,
    types: DOC_TYPES,
    kindsText: "JPEG, PNG or PDF",
    allowedText: "JPEG, PNG or PDF, up to 10 MB",
  },
  kitchen_photo: {
    bucket: "kitchen-photos",
    prefix: "kitchen",
    maxBytes: 5 * MB,
    types: PHOTO_TYPES,
    kindsText: "JPEG, PNG or WebP",
    allowedText: "JPEG, PNG or WebP, up to 5 MB",
  },
  profile_photo: {
    bucket: "profile-photos",
    prefix: "photo",
    maxBytes: 5 * MB,
    types: PHOTO_TYPES,
    kindsText: "JPEG, PNG or WebP",
    allowedText: "JPEG, PNG or WebP, up to 5 MB",
  },
};

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

/** Returns a message for the user, or null when the file may be uploaded. */
export function validateUploadFile(
  target: UploadKind,
  file: { type: string; size: number } | null | undefined,
): string | null {
  if (!file) return "Choose a file first.";
  const rule = UPLOAD_RULES[target];
  if (!Object.prototype.hasOwnProperty.call(rule.types, file.type)) {
    return `That file type is not allowed. Use ${rule.kindsText}.`;
  }
  if (file.size <= 0) return "That file is empty.";
  if (file.size > rule.maxBytes)
    return `That file is too large. The limit is ${rule.maxBytes / MB} MB.`;
  return null;
}

/** A fresh object name: `<userId>/<prefix>-<uuid>.<ext>`, all lower case. */
export function newObjectPath(
  target: UploadKind,
  userId: string,
  mimeType: string,
  uuid: string = crypto.randomUUID(),
): { bucket: string; path: string } {
  const rule = UPLOAD_RULES[target];
  const ext = rule.types[mimeType];
  return {
    bucket: rule.bucket,
    path: `${userId}/${rule.prefix}-${uuid.toLowerCase()}.${ext}`.toLowerCase(),
  };
}

export interface ChefUploader {
  upload(
    bucket: string,
    path: string,
    file: File,
    options: { upsert: false; contentType: string },
  ): Promise<{ error: { message: string } | null }>;
}

/** Uploads one file and returns where it went. Never retries into the same name. */
export async function uploadChefFile(
  target: UploadKind,
  userId: string,
  file: File,
  uploader: ChefUploader,
): Promise<{ bucket: string; path: string }> {
  const problem = validateUploadFile(target, file);
  if (problem) throw new UploadError(problem);
  const { bucket, path } = newObjectPath(target, userId, file.type);
  let error: { message: string } | null;
  try {
    ({ error } = await uploader.upload(bucket, path, file, {
      upsert: false,
      contentType: file.type,
    }));
  } catch {
    error = { message: "network" };
  }
  // The storage message is not shown: it may name buckets or policies.
  if (error)
    throw new UploadError(
      "Could not upload the file. Check your connection and try again.",
    );
  return { bucket, path };
}

/** The real uploader: the browser Supabase client with the chef's session. */
export async function browserUploader(): Promise<ChefUploader> {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  return {
    upload: async (bucket, path, file, options) => {
      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, file, options);
      return { error };
    },
  };
}

/** MOCK uploader for NEXT_PUBLIC_API_MOCK=1: nothing is stored anywhere. */
export const mockUploader: ChefUploader = {
  upload: async () => ({ error: null }),
};

/** Uploads with the right uploader for the run mode (MOCK mode stores nothing) and returns the path. */
export async function uploadForChef(
  target: UploadKind,
  userId: string,
  file: File,
): Promise<string> {
  const { isMockEnabled } = await import("@/lib/api/client");
  const uploader = isMockEnabled() ? mockUploader : await browserUploader();
  return (await uploadChefFile(target, userId, file, uploader)).path;
}
