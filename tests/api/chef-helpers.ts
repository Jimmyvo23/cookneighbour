// Shared helpers for the chef application route tests (T-031). Runs against the LOCAL Supabase
// only (tests/api/setup.ts points the env at it).
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import {
  GET as getApp,
  PATCH as patchApp,
} from "@/app/api/chef/application/route";
import {
  DELETE as deleteDoc,
  POST as postDoc,
} from "@/app/api/chef/application/documents/route";
import { POST as submit } from "@/app/api/chef/application/submit/route";
import { POST as phone } from "@/app/api/me/phone/route";
import { POST as verify } from "@/app/api/me/phone/verify/route";
import { makeUser } from "../rls/helpers";
import { Browser, PASSWORD, newEmail, service, type Reply } from "./harness";

export {
  Browser,
  PASSWORD,
  newEmail,
  getApp,
  patchApp,
  postDoc,
  deleteDoc,
  submit,
  login,
  phone,
  verify,
};
export type { Reply };

export const svc = service();

// 1x1 PNG and a tiny PDF: real enough for the bucket MIME rules.
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
export const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");

const usedPhones = new Set<string>();
/**
 * A random, valid Canadian number that no earlier call returned. Verified numbers are unique per
 * account (D-11), so many "ready" chefs in one run need distinct numbers. The area codes differ
 * from the ones the other test files use, and exchange 555 is avoided.
 */
export function uniquePhone(): string {
  for (;;) {
    const area = ["416", "905", "437", "289"][Math.floor(Math.random() * 4)];
    const exchange = String(200 + Math.floor(Math.random() * 800));
    const line = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const phone = `+1${area}${exchange}${line}`;
    if (exchange !== "555" && !usedPhones.has(phone)) {
      usedPhones.add(phone);
      return phone;
    }
  }
}

export const uuid = () => randomUUID();
export const idPath = (chef: string, ext = "png") =>
  `${chef}/id-${uuid()}.${ext}`;
export const fhPath = (chef: string, ext = "pdf") =>
  `${chef}/food-handler-${uuid()}.${ext}`;
export const kitchenPath = (chef: string, ext = "png") =>
  `${chef}/kitchen-${uuid()}.${ext}`;
export const photoPath = (chef: string, ext = "png") =>
  `${chef}/photo-${uuid()}.${ext}`;

/** Uploads a tiny file with the service role (the chef's own upload is covered in one flow test). */
export async function upload(bucket: string, path: string): Promise<void> {
  const isPdf = path.endsWith(".pdf");
  const { error } = await svc.storage
    .from(bucket)
    .upload(path, isPdf ? PDF : PNG, {
      contentType: isPdf ? "application/pdf" : "image/png",
      upsert: false,
    });
  expect(error, `upload ${bucket}/${path}`).toBeNull();
}

export async function objectExists(
  bucket: string,
  path: string,
): Promise<boolean> {
  const { data } = await svc.storage.from(bucket).exists(path);
  return data === true;
}

/** A signed-up chef with a session. */
export interface Chef {
  b: Browser;
  id: string;
  email: string;
}

export async function newChef(name = "Test Chef"): Promise<Chef> {
  const b = new Browser();
  const email = newEmail("chef");
  const res = await b.call(signup, {
    body: { email, password: PASSWORD, role: "chef", displayName: name },
  });
  expect(res.status, res.text).toBe(201);
  return { b, id: res.body.user.id as string, email };
}

export async function newCustomer(name = "Test Customer"): Promise<Chef> {
  const b = new Browser();
  const email = newEmail("customer");
  const res = await b.call(signup, {
    body: { email, password: PASSWORD, role: "customer", displayName: name },
  });
  expect(res.status, res.text).toBe(201);
  return { b, id: res.body.user.id as string, email };
}

/** A real admin: profiles.role = 'admin' set by the service role, then a normal login. */
export async function newAdmin(metaRole?: string): Promise<Chef> {
  const p = await makeUser(svc, "admin", "chefapi-admin", metaRole);
  const b = new Browser();
  const res = await b.call(login, {
    body: { email: p.email, password: PASSWORD },
  });
  expect(res.status, res.text).toBe(200);
  expect(res.body.user.role).toBe("admin");
  return { b, id: p.id, email: p.email };
}

export async function application(b: Browser) {
  const r = await b.call(getApp, { method: "GET" });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

export async function privRow(id: string) {
  const { data, error } = await svc
    .from("chef_private")
    .select("*")
    .eq("chef_id", id)
    .single();
  expect(error).toBeNull();
  return data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function chefRow(id: string) {
  const { data, error } = await svc
    .from("chefs")
    .select("*")
    .eq("profile_id", id)
    .single();
  expect(error).toBeNull();
  return data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function setPriv(id: string, patch: Record<string, unknown>) {
  const { error } = await svc
    .from("chef_private")
    .update(patch)
    .eq("chef_id", id);
  expect(error).toBeNull();
}

export async function setChef(id: string, patch: Record<string, unknown>) {
  const { error } = await svc.from("chefs").update(patch).eq("profile_id", id);
  expect(error).toBeNull();
}

export type CheckStatus = "not_started" | "pending" | "verified" | "failed";
export const CHECK_STATUSES: CheckStatus[] = [
  "not_started",
  "pending",
  "verified",
  "failed",
];
/** What a changed document or kitchen does to each earlier status (N1 plus failed -> pending). */
export const AFTER_CHANGE: Record<CheckStatus, CheckStatus> = {
  not_started: "not_started",
  pending: "pending",
  verified: "pending",
  failed: "pending",
};

/** A client signed in as the chef (publishable key), like the browser: uploads go through RLS. */
export async function chefClient(email: string) {
  const c = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await c.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  expect(error).toBeNull();
  return c;
}

/**
 * A chef whose application is complete (nothing in `missing`): profile fields, photo, ID and
 * food-handler documents registered, allergen acknowledgement, verified MOCK phone, one dish with
 * a photo. With `chefHome` the kitchen address, a kitchen photo and the hygiene acknowledgement
 * are added too.
 */
export async function readyChef(
  opts: { chefHome?: boolean; name?: string } = {},
) {
  const c = await newChef(opts.name ?? "Ready Chef");
  const photo = photoPath(c.id);
  const idp = idPath(c.id);
  const fhp = fhPath(c.id);
  await upload("profile-photos", photo);
  await upload("chef-documents", idp);
  await upload("chef-documents", fhp);
  const patch = await c.b.call(patchApp, {
    method: "PATCH",
    body: {
      bio: "I cook Vietnamese home food.",
      photoPath: photo,
      cuisines: ["Vietnamese"],
      languages: ["English", "Vietnamese"],
      hourlyRateCents: 3000,
      servicePostalPrefix: "L5B",
      serviceRadiusKm: 20,
      locationOptions: opts.chefHome
        ? ["customer_home", "chef_home"]
        : ["customer_home"],
      acknowledgeAllergenStatement: true,
      ...(opts.chefHome
        ? {
            kitchenAddress: {
              line: "1 Fictional Street",
              city: "Mississauga",
              postalCode: "L5B 1A1",
            },
            acknowledgeKitchenHygiene: true,
          }
        : {}),
    },
  });
  expect(patch.status, patch.text).toBe(200);
  for (const [kind, path] of [
    ["id_document", idp],
    ["food_handler", fhp],
  ] as const) {
    const r = await c.b.call(postDoc, { body: { kind, path } });
    expect(r.status, r.text).toBe(200);
  }
  let kitchen: string | null = null;
  if (opts.chefHome) {
    kitchen = kitchenPath(c.id);
    await upload("kitchen-photos", kitchen);
    const r = await c.b.call(postDoc, {
      body: { kind: "kitchen_photo", path: kitchen },
    });
    expect(r.status, r.text).toBe(200);
  }
  // MOCK SMS: any 6 digits verify the (fictional) number.
  const phoneNumber = uniquePhone();
  const ph = await c.b.call(phone, { body: { phone: phoneNumber } });
  expect(ph.status, ph.text).toBe(200);
  const vf = await c.b.call(verify, { body: { code: "123456" } });
  expect(vf.status, vf.text).toBe(200);
  const dish = await svc.from("dishes").insert({
    chef_id: c.id,
    name: "Pho",
    cuisine: "Vietnamese",
    cook_minutes: 120,
    photo_path: `${c.id}/dish-${uuid()}.png`,
  });
  expect(dish.error).toBeNull();
  const app = await application(c.b);
  expect(app.missing, JSON.stringify(app.missing)).toEqual([]);
  return { ...c, photo, idp, fhp, kitchen, phoneNumber };
}
