// T-030 demo seed. SERVER-ONLY: uses the Supabase secret key (bypasses RLS). Never import this
// from application code and never run it in a browser.
//
//   npm run db:seed -- --local     seed the local Supabase stack (URL/key from `supabase status`)
//   npm run db:seed -- --hosted    seed the hosted project (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY)
//   add --verify                   check the seed result only (writes nothing)
//
// Idempotent: users are found by email, every other row is upserted by a fixed key, so it is safe
// to run again. It refuses to run without an explicit target.
// Seed data is fictional. Verification statuses are MOCK values. Nothing is verified or charged.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ADMIN_EMAIL,
  ADMIN_NAME,
  DEMO_CHEF_PASSWORD,
  DEMO_CUSTOMER_PASSWORD,
  chefs,
  customers,
} from "./seed-data.ts";
import {
  addressHash,
  parsePostalPrefixes,
  phoneHash,
  stableUuid,
} from "./seed-lib.ts";

const USAGE = `CookNeighbour demo seed (fictional data, MOCK statuses)

Usage:
  npm run db:seed -- --local            seed the local Supabase stack
  npm run db:seed -- --hosted           seed the hosted project
  npm run db:seed -- --local --verify   only check that the seed is in place

--hosted needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, HASH_PEPPER and SEED_ADMIN_PASSWORD.
--local reads URL and key from \`supabase status\` (the stack must be running).
The admin account is only created when SEED_ADMIN_PASSWORD is set in the environment.
`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function die(msg: string): never {
  console.error(`seed: ${msg}`);
  process.exit(1);
}

function localConfig(): { url: string; key: string } {
  let out: string;
  try {
    out = execFileSync(
      "npx",
      ["--no-install", "supabase", "status", "-o", "env"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch {
    return die(
      "could not read `supabase status`. Is the local stack running (supabase start)?",
    );
  }
  const env: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) env[m[1]] = m[2];
  }
  const url = env.API_URL;
  const key = env.SECRET_KEY || env.SERVICE_ROLE_KEY;
  if (!url || !key)
    die("`supabase status` did not return API_URL and a secret/service key.");
  return { url, key };
}

type Db = SupabaseClient;

function must<T>(
  res: { data?: T; error: { message: string } | null },
  what: string,
): T {
  if (res.error) die(`${what}: ${res.error.message}`);
  return res.data as T;
}

async function findUserId(db: Db, email: string): Promise<string | null> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) die(`list users: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureUser(
  db: Db,
  email: string,
  password: string,
  role: "customer" | "chef" | "admin",
  displayName: string,
): Promise<string> {
  const meta = {
    display_name: displayName,
    role: role === "chef" ? "chef" : "customer",
  };
  let id = await findUserId(db, email);
  if (id) {
    const { error } = await db.auth.admin.updateUserById(id, {
      password,
      email_confirm: true,
      user_metadata: meta,
    });
    if (error) die(`update user ${email}: ${error.message}`);
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: meta,
    });
    if (error || !data.user) die(`create user ${email}: ${error?.message}`);
    id = data.user.id;
  }
  // The sign-up trigger creates profile + profile_private. Admin is set here by the server only.
  must(
    await db
      .from("profiles")
      .upsert({ id, role, display_name: displayName }, { onConflict: "id" }),
    `profile ${email}`,
  );
  must(
    await db
      .from("profile_private")
      .upsert({ profile_id: id }, { onConflict: "profile_id" }),
    `profile_private ${email}`,
  );
  return id;
}

function isoDay(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const DAYS_AHEAD = 21;

async function seed(db: Db, pepper: string, adminPassword: string | undefined) {
  const prefixRows = parsePostalPrefixes(
    readFileSync(resolve(root, "supabase/seed.sql"), "utf8"),
  );
  must(
    await db
      .from("postal_prefixes")
      .upsert(prefixRows, { onConflict: "prefix" }),
    "postal prefixes",
  );
  console.log(`postal prefixes: ${prefixRows.length}`);

  if (adminPassword) {
    await ensureUser(db, ADMIN_EMAIL, adminPassword, "admin", ADMIN_NAME);
    console.log(`admin: ${ADMIN_EMAIL}`);
  } else {
    console.log(
      "admin: SKIPPED (SEED_ADMIN_PASSWORD is not set; the script never uses a default)",
    );
  }

  for (const c of customers) {
    const id = await ensureUser(
      db,
      c.email,
      DEMO_CUSTOMER_PASSWORD,
      "customer",
      c.displayName,
    );
    must(
      await db.from("profile_private").upsert(
        {
          profile_id: id,
          phone_e164: c.phone,
          phone_hash: phoneHash(c.phone, pepper),
          phone_verified: true, // MOCK SMS verification
          address_line: c.addressLine,
          city: c.city,
          postal_code: c.postalCode,
          postal_prefix: c.postalCode.slice(0, 3),
          address_hash: addressHash(c.addressLine, c.postalCode, pepper),
        },
        { onConflict: "profile_id" },
      ),
      `customer private ${c.email}`,
    );
  }
  console.log(`customers: ${customers.length}`);

  let dishCount = 0;
  for (const c of chefs) {
    const id = await ensureUser(
      db,
      c.email,
      DEMO_CHEF_PASSWORD,
      "chef",
      c.displayName,
    );
    must(
      await db.from("chefs").upsert(
        {
          profile_id: id,
          status: c.status,
          display_name: c.displayName,
          bio: c.bio,
          cuisines: c.cuisines,
          languages: c.languages,
          hourly_rate_cents: c.hourlyRateCents,
          service_postal_prefix: c.servicePrefix,
          service_radius_km: c.radiusKm,
          location_options: c.locationOptions,
          chef_home_enabled: c.chefHomeEnabled,
          // Demo-only cached rating (no review rows behind it).
          rating_avg: c.rating.avg,
          review_count: c.rating.count,
        },
        { onConflict: "profile_id" },
      ),
      `chef ${c.email}`,
    );
    const now = new Date().toISOString();
    must(
      await db.from("chef_private").upsert(
        {
          chef_id: id,
          reject_reason: c.rejectReason ?? null,
          // MOCK statuses: nobody checked anything.
          police_check_status: c.checks.police,
          id_check_status: c.checks.id,
          food_handler_status: c.checks.foodHandler,
          kitchen_status: c.checks.kitchen,
          kitchen_address_line: c.kitchen?.line ?? null,
          kitchen_city: c.kitchen?.city ?? null,
          kitchen_postal_code: c.kitchen?.postalCode ?? null,
          allergen_ack_at: now,
          kitchen_hygiene_ack_at: c.chefHomeEnabled ? now : null,
        },
        { onConflict: "chef_id" },
      ),
      `chef_private ${c.email}`,
    );
    const dishRows = c.dishes.map((d) => ({
      id: stableUuid(`dish:${c.key}:${d.name}`),
      chef_id: id,
      name: d.name,
      description: d.description,
      cuisine: d.cuisine,
      cook_minutes: d.cookMinutes,
      ingredient_cost_cents: d.ingredientCostCents,
      servings: d.servings,
      allergens: d.allergens,
      shelf_life_days: d.shelfLifeDays,
      is_active: true,
    }));
    must(
      await db.from("dishes").upsert(dishRows, { onConflict: "id" }),
      `dishes ${c.email}`,
    );
    dishCount += dishRows.length;

    const days = [];
    for (let i = 1; i <= DAYS_AHEAD; i++) {
      const day = isoDay(i);
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      days.push({
        chef_id: id,
        day,
        available: !c.unavailableWeekdays.includes(weekday),
      });
    }
    must(
      await db.from("availability").upsert(days, { onConflict: "chef_id,day" }),
      `availability ${c.email}`,
    );
  }
  console.log(
    `chefs: ${chefs.length} (dishes: ${dishCount}, availability: next ${DAYS_AHEAD} days)`,
  );
}

/** Read-only check that the seed is in place. Exits non-zero when it is not. */
async function verify(db: Db) {
  const problems: string[] = [];
  const { data: prefixes, error: pe } = await db
    .from("postal_prefixes")
    .select("prefix")
    .eq("city", "Mississauga");
  if (pe) die(`verify prefixes: ${pe.message}`);
  const miss = new Set((prefixes ?? []).map((p) => p.prefix as string));
  const { data: rows, error } = await db
    .from("chefs")
    .select(
      "status, cuisines, service_postal_prefix, location_options, chef_home_enabled",
    );
  if (error) die(`verify chefs: ${error.message}`);
  const list = rows ?? [];
  const viet = list.filter(
    (c) =>
      c.status === "approved" &&
      (c.cuisines as string[]).includes("Vietnamese") &&
      miss.has(c.service_postal_prefix as string) &&
      (c.location_options as string[]).includes("customer_home") &&
      (c.location_options as string[]).includes("chef_home") &&
      c.chef_home_enabled,
  );
  if (viet.length < 1)
    problems.push(
      "no approved Vietnamese chef in Mississauga offering both locations",
    );
  if (!list.some((c) => c.status === "pending"))
    problems.push("no pending chef");
  if (!list.some((c) => c.status === "rejected"))
    problems.push("no rejected chef");
  const { count } = await db
    .from("dishes")
    .select("id", { count: "exact", head: true });
  if (!count) problems.push("no dishes");
  if (problems.length) die(`verify failed: ${problems.join("; ")}`);
  console.log(
    `verify ok: ${list.length} chefs, ${viet.length} approved Vietnamese in Mississauga, ${count} dishes`,
  );
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const local = args.has("--local");
  const hosted = args.has("--hosted");
  if (local === hosted) {
    console.log(USAGE);
    process.exit(local && hosted ? 1 : 0);
  }

  let url: string;
  let key: string;
  if (local) {
    ({ url, key } = localConfig());
  } else {
    url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    key = process.env.SUPABASE_SECRET_KEY ?? "";
    if (!url || !key)
      die(
        "--hosted needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.",
      );
  }
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (args.has("--verify")) return verify(db);

  const adminPassword = process.env.SEED_ADMIN_PASSWORD || undefined;
  let pepper = process.env.HASH_PEPPER ?? "";
  if (!pepper) {
    // A local throwaway stack may use a fixed pepper. A hosted project must use its real one,
    // otherwise the seeded free-trial hashes would never match what the app computes.
    if (hosted)
      die(
        "--hosted needs HASH_PEPPER in the environment (must match the app's pepper).",
      );
    pepper = "local-dev-pepper";
  }
  console.log(`seeding ${local ? "LOCAL" : "HOSTED"} ${url}`);
  await seed(db, pepper, adminPassword);
  console.log("done");
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
