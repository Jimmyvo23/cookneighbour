// Tester (T-099): process-level checks that --hosted never falls back to the public demo passwords.
// Uses a dead URL (127.0.0.1:1) and fake keys; every case must exit before any network call.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_CUSTOMER_PASSWORD } from "../../scripts/seed-data";

const BASE = {
  PATH: process.env.PATH ?? "",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
  SUPABASE_SECRET_KEY: "fake-key",
  HASH_PEPPER: "fake-pepper-0123456789-0123456789",
};
const GOOD_CHEF = "tester-chef-pw-123456";

function seed(args: string[], extra: Record<string, string> = {}) {
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "scripts/seed.ts", ...args],
    {
      env: { ...BASE, ...extra } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 20000,
    },
  );
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("scripts/seed.ts --hosted demo passwords (T-099, process level)", () => {
  it("refuses without any demo password variable, before any network call", () => {
    const r = seed(["--hosted"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/SEED_DEMO_CHEF_PASSWORD/);
    expect(r.out).not.toMatch(/seeding HOSTED|fetch failed/);
  });

  it("refuses with only one of the two variables", () => {
    const r = seed(["--hosted"], { SEED_DEMO_CHEF_PASSWORD: GOOD_CHEF });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/SEED_DEMO_CUSTOMER_PASSWORD/);
    expect(r.out).not.toMatch(/fetch failed/);
  });

  it("refuses the repo default and never echoes any password value", () => {
    const r = seed(["--hosted"], {
      SEED_DEMO_CHEF_PASSWORD: GOOD_CHEF,
      SEED_DEMO_CUSTOMER_PASSWORD: DEMO_CUSTOMER_PASSWORD,
    });
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/fetch failed/);
    expect(r.out).not.toContain(DEMO_CUSTOMER_PASSWORD);
    expect(r.out).not.toContain(GOOD_CHEF);
  });

  it("a short chef password is refused without echoing it", () => {
    const r = seed(["--hosted"], {
      SEED_DEMO_CHEF_PASSWORD: "tooshort-pw",
      SEED_DEMO_CUSTOMER_PASSWORD: "tester-customer-pw-123456",
    });
    expect(r.code).toBe(1);
    expect(r.out).not.toContain("tooshort-pw");
    expect(r.out).not.toMatch(/fetch failed/);
  });

  it("an empty-string variable counts as missing", () => {
    const r = seed(["--hosted"], {
      SEED_DEMO_CHEF_PASSWORD: "",
      SEED_DEMO_CUSTOMER_PASSWORD: "tester-customer-pw-123456",
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/SEED_DEMO_CHEF_PASSWORD/);
  });

  it("--verify returns before passwords are resolved and uses no password", () => {
    const src = readFileSync("scripts/seed.ts", "utf8");
    const verifyAt = src.indexOf('args.has("--verify")');
    expect(verifyAt).toBeGreaterThan(0);
    expect(
      src.slice(src.indexOf("async function verify"), verifyAt),
    ).not.toMatch(/demo\.|ensureUser|createUser/);
  });

  it("still refuses to run without a target", () => {
    const r = seed([]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Usage/);
    expect(r.out).not.toMatch(/seeding/);
    expect(seed(["--local", "--hosted"]).code).toBe(1);
  });
});

describe("seed code never logs password values (T-099, source check)", () => {
  const src = readFileSync("scripts/seed.ts", "utf8");
  const lib = readFileSync("scripts/seed-lib.ts", "utf8");
  it("no console call or die() interpolates a password", () => {
    const calls = src.match(/(console\.\w+|die)\([^;]*\);/g) ?? [];
    for (const c of calls) {
      expect(c).not.toMatch(/demo\.|PASSWORD|adminPassword|DEMO_/);
    }
  });
  it("seed.ts no longer imports the public constants", () => {
    expect(src).not.toMatch(/^\s+DEMO_(CHEF|CUSTOMER)_PASSWORD,/m);
    expect(src).not.toMatch(
      /\bDEMO_(CHEF|CUSTOMER)_PASSWORD\b(?!\s*\w)\s*[,)]/,
    );
    expect(src).toMatch(/resolveDemoPasswords/);
  });
  it("error messages in resolveDemoPasswords do not interpolate the value", () => {
    expect(lib).not.toMatch(/\$\{value\}|\$\{env\[/);
  });
});

describe("docs are accurate and value-free (T-099)", () => {
  it(".env.example names both variables with no value", () => {
    const env = readFileSync(".env.example", "utf8");
    expect(env).toMatch(/^SEED_DEMO_CHEF_PASSWORD=$/m);
    expect(env).toMatch(/^SEED_DEMO_CUSTOMER_PASSWORD=$/m);
  });
  it("README names both variables for --hosted", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain("SEED_DEMO_CHEF_PASSWORD");
    expect(readme).toContain("SEED_DEMO_CUSTOMER_PASSWORD");
  });
});
