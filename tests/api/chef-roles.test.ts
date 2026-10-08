// T-028 reviewer note: the role comes from profiles.role in the database, never from the JWT.
// `user_metadata` is user-editable and `app_metadata` is not trusted either.
import { beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { GET as getMe } from "@/app/api/me/route";
import { freshLimits } from "./harness";
import {
  Browser,
  PASSWORD,
  deleteDoc,
  getApp,
  login,
  newAdmin,
  newChef,
  newCustomer,
  patchApp,
  postDoc,
  submit,
  svc,
  type Chef,
} from "./chef-helpers";

beforeEach(() => freshLimits());

/** The claims inside a freshly issued access token for this user. */
async function claims(email: string) {
  const c = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await c.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  expect(error).toBeNull();
  const payload = data.session!.access_token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString()) as {
    role: string;
    user_metadata?: { role?: string };
    app_metadata?: { role?: string };
  };
}

/** Writes claims into the user's metadata, then returns a browser holding a NEW session carrying them. */
async function withClaims(
  who: Chef,
  meta: { user?: string; app?: string },
): Promise<Browser> {
  const upd = await svc.auth.admin.updateUserById(who.id, {
    ...(meta.user
      ? { user_metadata: { role: meta.user, display_name: "Sneaky" } }
      : {}),
    ...(meta.app ? { app_metadata: { role: meta.app } } : {}),
  });
  expect(upd.error).toBeNull();
  const b = new Browser();
  const res = await b.call(login, {
    body: { email: who.email, password: PASSWORD },
  });
  expect(res.status, res.text).toBe(200);
  return b;
}

async function chefRowsExist(id: string): Promise<boolean> {
  const c = await svc.from("chefs").select("profile_id").eq("profile_id", id);
  const p = await svc.from("chef_private").select("chef_id").eq("chef_id", id);
  return (c.data?.length ?? 0) + (p.data?.length ?? 0) > 0;
}

const CHEF_CALLS: [string, Parameters<Browser["call"]>[0], string, unknown][] =
  [
    ["GET application", getApp, "GET", undefined],
    ["PATCH application", patchApp, "PATCH", { bio: "x" }],
    ["POST documents", postDoc, "POST", { kind: "id_document", path: "x" }],
    [
      "DELETE documents",
      deleteDoc,
      "DELETE",
      { kind: "kitchen_photo", path: "x" },
    ],
    ["POST submit", submit, "POST", {}],
  ];

describe("a JWT role claim is ignored", () => {
  it("the test setup really puts role 'admin' into the token (so the tests below mean something)", async () => {
    const who = await newCustomer();
    await withClaims(who, { user: "admin", app: "admin" });
    const c = await claims(who.email);
    expect(c.user_metadata?.role).toBe("admin");
    expect(c.app_metadata?.role).toBe("admin");
    expect(c.role).toBe("authenticated"); // the Postgres role claim is not the app role
  });

  it("a customer whose user_metadata and app_metadata say 'admin' is still a customer", async () => {
    const who = await newCustomer();
    const b = await withClaims(who, { user: "admin", app: "admin" });
    const me = await b.call(getMe, { method: "GET" });
    expect(me.status).toBe(200);
    expect(me.body.profile.role).toBe("customer");
    expect(me.body.chef).toBeNull();
    for (const [name, h, method, body] of CHEF_CALLS) {
      const r = await b.call(h, { method, body });
      expect(r.status, name).toBe(403);
      expect(r.body.error.code).toBe("FORBIDDEN");
    }
    expect(await chefRowsExist(who.id)).toBe(false);
  });

  it("a customer whose metadata says 'chef' cannot use the chef routes and gets no chef rows", async () => {
    const who = await newCustomer();
    const b = await withClaims(who, { user: "chef", app: "chef" });
    for (const [name, h, method, body] of CHEF_CALLS) {
      const r = await b.call(h, { method, body });
      expect(r.status, name).toBe(403);
    }
    expect(await chefRowsExist(who.id)).toBe(false);
    const prof = await svc
      .from("profiles")
      .select("role")
      .eq("id", who.id)
      .single();
    expect(prof.data?.role).toBe("customer");
  });

  it("a chef whose metadata says 'admin' is still a chef: the chef routes work and /api/me says chef", async () => {
    const who = await newChef("Chef Metadata");
    const b = await withClaims(who, { user: "admin", app: "admin" });
    const me = await b.call(getMe, { method: "GET" });
    expect(me.body.profile.role).toBe("chef");
    const r = await b.call(getApp, { method: "GET" });
    expect(r.status, r.text).toBe(200);
    expect(r.body.displayName).toBe("Chef Metadata");
  });

  it("a real admin (profiles.role) is refused on chef routes whatever the metadata says", async () => {
    const admin = await newAdmin("chef");
    for (const [name, h, method, body] of CHEF_CALLS) {
      const r = await admin.b.call(h, { method, body });
      expect(r.status, name).toBe(403);
    }
    expect(await chefRowsExist(admin.id)).toBe(false);
  });
});
