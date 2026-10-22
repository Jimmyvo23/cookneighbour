// T-109: --hosted refuses a short HASH_PEPPER before any network call (dead URL, fake keys).
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const BASE = {
  PATH: process.env.PATH ?? "",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
  SUPABASE_SECRET_KEY: "fake-key",
  SEED_DEMO_CHEF_PASSWORD: "tester-chef-pw-123456",
  SEED_DEMO_CUSTOMER_PASSWORD: "tester-customer-pw-123456",
};

function seed(pepper: string | undefined) {
  const env: Record<string, string> = { ...BASE };
  if (pepper !== undefined) env.HASH_PEPPER = pepper;
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "scripts/seed.ts", "--hosted"],
    {
      env: env as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 20000,
    },
  );
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("scripts/seed.ts --hosted HASH_PEPPER length (T-109)", () => {
  it("refuses 31 characters without echoing the value or touching the network", () => {
    const short = "s".repeat(31);
    const r = seed(short);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/HASH_PEPPER/);
    expect(r.out).toMatch(/32/);
    expect(r.out).not.toContain(short);
    expect(r.out).not.toMatch(/seeding HOSTED|fetch failed/);
  });

  it("refuses 32 characters that are only 31 after trimming", () => {
    const r = seed(` ${"s".repeat(31)}`);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/32/);
  });

  it("refuses a missing pepper", () => {
    const r = seed(undefined);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/HASH_PEPPER/);
    expect(r.out).not.toMatch(/fetch failed/);
  });

  it("a 32 character pepper passes this check (it then starts seeding)", () => {
    const r = seed("s".repeat(32));
    expect(r.out).toMatch(/seeding HOSTED/);
  });
});
