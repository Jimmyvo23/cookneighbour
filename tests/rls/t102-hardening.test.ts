import pg from "pg";
import { describe, expect, it } from "vitest";
import { anonClient, localEnv, PASSWORD, rand, serviceClient } from "./helpers";

// T-102 (security review LOW-3): the sign-up trigger applies the app's display-name rules, so a
// direct call to Supabase Auth cannot skip them. A name that breaks a rule fails the whole sign-up.
const svc = serviceClient();

async function create(name: string) {
  return svc.auth.admin.createUser({
    email: `dn-${rand(5)}@example.test`,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
}

const GOOD = [
  "Nguyễn Thị Mai",
  "Mai Tran",
  "Đặng Văn A",
  "Mai 👩‍🍳",
  "A".repeat(80),
  "😀".repeat(40), // 80 UTF-16 units, the same count as JavaScript's .length
  "Mai 2026-10-31",
  "Room 12345",
  "Suite 4 and 7 and 12",
  "李小龍",
];
const BAD: [string, string][] = [
  ["a".repeat(81), "too long"],
  ["😀".repeat(41), "82 UTF-16 units"],
  ["Mai\u0007", "control character"],
  ["Mai​", "zero-width space"],
  ["Ma‮i", "bidi control"],
  ["Mai﻿ Tran", "BOM inside"],
  ["‌‍", "only joiners"],
  ["́̂", "only accent marks"],
  ["´", "only a spacing accent"],
  ["Call 416 555 0199", "phone with spaces"],
  ["416-555-0199", "phone with dashes"],
  ["+1 (416) 555-0199", "phone with plus and brackets"],
  ["４１６５５５０１９９", "full-width digits"],
  ["ref 12345 416 555 0199", "phone after other digits"],
  ["mai@example.com", "email"],
  ["mai＠example.com", "full-width at sign"],
  ["www.mai.ca", "web address"],
  ["https://mai", "url scheme"],
];

describe("LOW-3: handle_new_user applies the display-name rules", () => {
  it.each(GOOD)("accepts %j and stores it unchanged", async (name) => {
    const { data, error } = await create(name);
    expect(error).toBeNull();
    const prof = await svc
      .from("profiles")
      .select("display_name")
      .eq("id", data.user!.id)
      .single();
    expect(prof.data?.display_name).toBe(name);
  });

  it.each(BAD)("refuses %j (%s), no account is created", async (name) => {
    const email = `dn-bad-${rand(5)}@example.test`;
    const { data, error } = await svc.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: name },
    });
    expect(error, name).not.toBeNull();
    expect(data.user).toBeNull();
    const list = await svc.auth.admin.listUsers({ perPage: 1000 });
    expect(list.data.users.some((u) => u.email === email)).toBe(false);
  });

  it("a blank name is still 'New user' (unchanged)", async () => {
    const { data, error } = await create("   ");
    expect(error).toBeNull();
    const prof = await svc
      .from("profiles")
      .select("display_name")
      .eq("id", data.user!.id)
      .single();
    expect(prof.data?.display_name).toBe("New user");
  });

  it("direct anonymous sign-up through Auth is held to the same rules", async () => {
    const res = await anonClient().auth.signUp({
      email: `dn-direct-${rand(5)}@example.test`,
      password: PASSWORD,
      options: {
        data: { display_name: "Call 416 555 0199", role: "customer" },
      },
    });
    expect(res.error).not.toBeNull();
    expect(res.data.user).toBeNull();
  });

  it("display_name_problem is not callable from the browser", async () => {
    const r = await anonClient().rpc("display_name_problem", { p_name: "x" });
    expect(r.error).not.toBeNull();
  });
});

describe("LOW-3: minimum password length is 8 (local config)", () => {
  it("Auth refuses a 7-character password and accepts 8", async () => {
    const short = await anonClient().auth.signUp({
      email: `pw-${rand(5)}@example.test`,
      password: "Abcdef1",
    });
    expect(short.error?.code).toBe("weak_password");
    const ok = await anonClient().auth.signUp({
      email: `pw-${rand(5)}@example.test`,
      password: "Abcdef12",
    });
    expect(ok.error).toBeNull();
  });
});

describe("LOW-5: public photo buckets are insert-only for owners, chefs only for profile photos", () => {
  it("the policies are exactly the expected set", async () => {
    const client = new pg.Client({ connectionString: localEnv().dbUrl });
    await client.connect();
    try {
      const res = await client.query(
        `select policyname, cmd from pg_policies
          where schemaname = 'storage' and tablename = 'objects'
            and (policyname like 'profile_photos%' or policyname like 'dish_photos%'
                 or policyname like 'public_photos%')
          order by policyname`,
      );
      expect(res.rows).toEqual([
        { policyname: "dish_photos_insert_own", cmd: "INSERT" },
        { policyname: "profile_photos_insert_own", cmd: "INSERT" },
        { policyname: "public_photos_select_admin", cmd: "SELECT" },
        { policyname: "public_photos_select_own", cmd: "SELECT" },
      ]);
    } finally {
      await client.end();
    }
  });
});
