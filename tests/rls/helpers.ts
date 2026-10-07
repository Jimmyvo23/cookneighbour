import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { expect } from "vitest";

export const PASSWORD = "Test-only-pw-1234!";

export interface Person {
  id: string;
  email: string;
}

export interface Fixtures {
  /** Day offset base: fixtures use baseDay+0..9, tests use baseDay+10 and up. */
  baseDay: string;
  admin: Person;
  c1: Person;
  c2: Person;
  h1: Person; // approved, both locations, chef home enabled
  h2: Person; // approved, customer home only
  hp: Person; // pending
  hr: Person; // rejected
  phones: { c1: string; h1: string };
  addresses: { c1: string; kitchen: string };
  hashes: { c1Phone: string; c1Address: string };
  bookings: {
    requestedC1H1: string;
    acceptedC1H1: string;
    acceptedChefHomeC1H1: string;
    requestedC2H2: string;
    declinedC1H1: string;
    completedC1H1: string;
  };
  pendingDishId: string;
  rejectedDishId: string;
  approvedDishId: string;
}

export function localEnv() {
  const url = process.env.API_URL ?? "";
  const anon = process.env.ANON_KEY ?? process.env.PUBLISHABLE_KEY ?? "";
  const service = process.env.SERVICE_ROLE_KEY ?? process.env.SECRET_KEY ?? "";
  const dbUrl = process.env.DB_URL ?? "";
  if (!url || !anon || !service || !dbUrl) {
    throw new Error(
      'Missing API_URL / ANON_KEY / SERVICE_ROLE_KEY / DB_URL. Run: eval "$(supabase status -o env)"',
    );
  }
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Refusing to run RLS tests against non-local URL ${host}`);
  }
  return { url, anon, service, dbUrl };
}

const noSession = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

export function serviceClient(): SupabaseClient {
  const e = localEnv();
  return createClient(e.url, e.service, noSession);
}

export function anonClient(): SupabaseClient {
  const e = localEnv();
  return createClient(e.url, e.anon, noSession);
}

/** A client signed in as the given user (subject to RLS). */
export async function clientFor(p: Person): Promise<SupabaseClient> {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({
    email: p.email,
    password: PASSWORD,
  });
  if (error) throw new Error(`sign-in failed for ${p.email}: ${error.message}`);
  return c;
}

export function rand(n = 8): string {
  return randomBytes(n).toString("hex");
}

export function fakePhone(): string {
  return `+1416555${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
}

export function dayPlus(base: string, n: number): string {
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function must<T>(
  res: { data: T | null; error: { message: string } | null },
  what: string,
): T {
  if (res.error || res.data === null)
    throw new Error(`${what}: ${res.error?.message ?? "no data"}`);
  return res.data;
}

export async function makeUser(
  svc: SupabaseClient,
  role: "customer" | "chef" | "admin",
  name: string,
  metaRole?: string,
): Promise<Person> {
  const email = `rls-${name}-${rand(4)}@example.test`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      display_name: name,
      role: metaRole ?? (role === "admin" ? "customer" : role),
    },
  });
  if (error || !data.user)
    throw new Error(`createUser ${name}: ${error?.message}`);
  if (role === "admin") {
    must(
      await svc
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", data.user.id)
        .select(),
      "promote admin",
    );
  }
  return { id: data.user.id, email };
}

export async function setPrivate(
  svc: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  must(
    await svc
      .from("profile_private")
      .update(patch)
      .eq("profile_id", id)
      .select(),
    "profile_private update",
  );
}

export async function makeCustomer(
  svc: SupabaseClient,
  name: string,
): Promise<Person> {
  const p = await makeUser(svc, "customer", name);
  await setPrivate(svc, p.id, {
    phone_e164: fakePhone(),
    phone_hash: `ph-${rand()}`,
    phone_verified: true,
    address_hash: `ah-${rand()}`,
  });
  return p;
}

export async function makeChef(
  svc: SupabaseClient,
  name: string,
  opts: {
    status?: "pending" | "approved" | "rejected";
    options?: string[];
    chefHomeEnabled?: boolean;
  } = {},
): Promise<Person> {
  const p = await makeUser(svc, "chef", name);
  must(
    await svc
      .from("chefs")
      .insert({
        profile_id: p.id,
        status: opts.status ?? "approved",
        display_name: name,
        bio: `bio of ${name}`,
        cuisines: ["Vietnamese"],
        languages: ["English"],
        hourly_rate_cents: 3000,
        location_options: opts.options ?? ["customer_home"],
        chef_home_enabled: opts.chefHomeEnabled ?? false,
      })
      .select(),
    "insert chef",
  );
  must(
    await svc
      .from("chef_private")
      .insert({
        chef_id: p.id,
        id_document_path: `${p.id}/id.pdf`,
        police_check_status: "pending",
        kitchen_address_line: "12 Kitchen Lane",
        kitchen_city: "Mississauga",
        kitchen_postal_code: "L5B1A1",
      })
      .select(),
    "insert chef_private",
  );
  return p;
}

export interface BookingOpts {
  customer: Person;
  chef: Person;
  dates: string[];
  status?: string;
  location?: "customer_home" | "chef_home";
  travelCents?: number;
}

/** Insert a booking plus its days through the service client (the server's job in the app). */
export async function makeBooking(
  svc: SupabaseClient,
  o: BookingOpts,
): Promise<{ id: string; dayIds: string[] }> {
  const id = randomUUID();
  const status = o.status ?? "requested";
  const { error } = await svc.from("bookings").insert({
    id,
    customer_id: o.customer.id,
    chef_id: o.chef.id,
    status,
    location_type: o.location ?? "customer_home",
    grocery_option: "customer_buys",
    hourly_rate_cents: 3000,
    est_travel_cents: o.travelCents ?? 0,
    ...(status === "cancelled"
      ? { cancelled_at: new Date().toISOString() }
      : {}),
  });
  if (error) throw new Error(`insert booking: ${error.message}`);
  const dayIds: string[] = [];
  for (let i = 0; i < o.dates.length; i++) {
    const { data, error: e2 } = await svc
      .from("booking_days")
      .insert({ booking_id: id, day_number: i + 1, visit_date: o.dates[i] })
      .select("id")
      .single();
    if (e2 || !data) throw new Error(`insert booking_day: ${e2?.message}`);
    dayIds.push(data.id as string);
  }
  return { id, dayIds };
}

type Res = { data: unknown; error: { code?: string; message: string } | null };

/**
 * A write was refused: either Postgres raised 42501 (no privilege, RLS check, guard trigger),
 * or RLS filtered every row so nothing changed. Always chain `.select()` on the write so that a
 * successful write returns rows and this assertion fails.
 */
export function expectDenied(res: Res): void {
  if (res.error) {
    expect(res.error.code, res.error.message).toBe("42501");
    return;
  }
  expect(res.data ?? []).toEqual([]);
}

/** A read returned no rows, or was refused outright (no table privilege). */
export function expectNoRows(res: Res): void {
  if (res.error) {
    expect(res.error.code, res.error.message).toBe("42501");
    return;
  }
  expect(res.data).toEqual([]);
}

export function expectRows(res: Res, count?: number): void {
  expect(res.error, res.error?.message).toBeNull();
  const rows = res.data as unknown[];
  expect(Array.isArray(rows)).toBe(true);
  if (count === undefined) expect(rows.length).toBeGreaterThan(0);
  else expect(rows.length).toBe(count);
}

export function expectCode(res: Res, code: string, messagePart?: string): void {
  expect(res.error, "expected an error").not.toBeNull();
  expect(res.error?.code, res.error?.message).toBe(code);
  if (messagePart) expect(res.error?.message).toContain(messagePart);
}

export function ids(res: Res): string[] {
  expect(res.error, res.error?.message).toBeNull();
  return (res.data as { id?: string; profile_id?: string }[]).map(
    (r) => (r.id ?? r.profile_id) as string,
  );
}
