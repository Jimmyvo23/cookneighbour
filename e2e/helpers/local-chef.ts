// A complete, submitted chef application for the real-route Playwright tests. Only for the
// THROWAWAY LOCAL Supabase stack (it refuses any other host). The chef signs up and edits through
// the real /api routes; the files and the sample dish are put in place with the local service role,
// exactly as tests/api/chef-helpers.ts does (the browser upload path has its own spec).
// MOCK: the phone code, and every check, are simulated.
import { createClient } from "@supabase/supabase-js";
import { expect, type APIRequestContext } from "@playwright/test";

const PASSWORD = "e2e-password-1";
const json = { "Content-Type": "application/json" };
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");

let phoneCounter = 0;
function phone() {
  // Never an N11 code (211, 911 and so on): phone validation refuses those (T-037).
  const rnd = (lo: number, hi: number): number => {
    const n = lo + Math.floor(Math.random() * (hi - lo + 1));
    return n % 100 === 11 ? rnd(lo, hi) : n;
  };
  const line = (Date.now() + phoneCounter++ * 7919) % 10000;
  return `${rnd(200, 999)}${rnd(200, 999)}${String(line).padStart(4, "0")}`;
}
export function uniq() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function localService() {
  const url = process.env.API_URL ?? "";
  const key = process.env.SERVICE_ROLE_KEY ?? process.env.SECRET_KEY ?? "";
  const host = url ? new URL(url).hostname : "";
  if (!key || (host !== "127.0.0.1" && host !== "localhost"))
    throw new Error("local-chef only runs against the local Supabase stack");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface SubmittedChef {
  id: string;
  email: string;
  name: string;
  password: string;
  idPath: string;
  foodHandlerPath: string;
  kitchenPaths: string[];
}

/**
 * Signs a chef up on `request` (so the context holds the chef's session), fills in everything the
 * server asks for and submits. The ID and food-handler checks end up `pending`.
 */
export async function createSubmittedChef(
  request: APIRequestContext,
  name: string,
  opts: { chefHome?: boolean } = {},
): Promise<SubmittedChef> {
  const svc = localService();
  const email = `e2e-chef-${uniq()}@example.com`;
  const signup = await request.post("/api/auth/signup", {
    headers: json,
    data: { email, password: PASSWORD, displayName: name, role: "chef" },
  });
  expect(signup.status()).toBe(201);
  const id = (await (await request.get("/api/me")).json()).profile.id as string;

  const up = async (bucket: string, path: string, pdf = false) => {
    const r = await svc.storage.from(bucket).upload(path, pdf ? PDF : PNG, {
      contentType: pdf ? "application/pdf" : "image/png",
      upsert: false,
    });
    expect(r.error, `upload ${bucket}/${path}`).toBeNull();
  };
  const photo = `${id}/photo-${crypto.randomUUID()}.png`;
  const idPath = `${id}/id-${crypto.randomUUID()}.png`;
  const foodHandlerPath = `${id}/food-handler-${crypto.randomUUID()}.pdf`;
  await up("profile-photos", photo);
  await up("chef-documents", idPath);
  await up("chef-documents", foodHandlerPath, true);

  const patch = await request.patch("/api/chef/application", {
    headers: json,
    data: {
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
  expect(patch.status(), await patch.text()).toBe(200);

  const register = async (kind: string, path: string) => {
    const r = await request.post("/api/chef/application/documents", {
      headers: json,
      data: { kind, path },
    });
    expect(r.status(), await r.text()).toBe(200);
  };
  await register("id_document", idPath);
  await register("food_handler", foodHandlerPath);
  const kitchenPaths: string[] = [];
  if (opts.chefHome) {
    for (let i = 0; i < 2; i++) {
      const p = `${id}/kitchen-${crypto.randomUUID()}.png`;
      await up("kitchen-photos", p);
      await register("kitchen_photo", p);
      kitchenPaths.push(p);
    }
  }

  const ph = await request.post("/api/me/phone", {
    headers: json,
    data: { phone: phone() },
  });
  expect(ph.status(), await ph.text()).toBe(200);
  const vf = await request.post("/api/me/phone/verify", {
    headers: json,
    data: { code: "123456" },
  });
  expect(vf.status(), await vf.text()).toBe(200);

  const dishPhoto = `${id}/dish-${crypto.randomUUID()}.png`;
  await up("dish-photos", dishPhoto);
  const dish = await svc.from("dishes").insert({
    chef_id: id,
    name: "Pho",
    cuisine: "Vietnamese",
    cook_minutes: 120,
    photo_path: dishPhoto,
  });
  expect(dish.error).toBeNull();

  const submit = await request.post("/api/chef/application/submit", {
    headers: json,
    data: {},
  });
  expect(submit.status(), await submit.text()).toBe(200);
  return {
    id,
    email,
    name,
    password: PASSWORD,
    idPath,
    foodHandlerPath,
    kitchenPaths,
  };
}
