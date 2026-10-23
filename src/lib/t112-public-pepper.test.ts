// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_TEST_PEPPER } from "./domain/local-test-pepper";
import { checkPepper } from "./domain/pepper-rule";

vi.mock("server-only", () => ({}));
import { getHashPepper } from "./server/pepper";

afterEach(() => vi.unstubAllEnvs());

describe("T-112 shared rule", () => {
  it("refuses the public pepper (also padded) only when asked", () => {
    for (const v of [LOCAL_TEST_PEPPER, ` ${LOCAL_TEST_PEPPER}\n`]) {
      const r = checkPepper(v, { forbidPublicTestPepper: true });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message).toMatch(/public local test pepper/);
        expect(r.message).not.toContain(LOCAL_TEST_PEPPER);
      }
      expect(checkPepper(v).ok).toBe(true);
    }
    expect(
      checkPepper("z".repeat(40), { forbidPublicTestPepper: true }).ok,
    ).toBe(true);
  });

  it("the hosted seed branch asks for the refusal", () => {
    const src = readFileSync("scripts/seed.ts", "utf8");
    expect(src).toMatch(
      /checkPepper\(process\.env\.HASH_PEPPER,\s*\{\s*forbidPublicTestPepper: true,?\s*\}\)/,
    );
  });
});

describe("T-112 getHashPepper on Vercel", () => {
  it("refuses the public pepper when VERCEL is set, in any NODE_ENV", () => {
    for (const env of ["test", "production"]) {
      vi.stubEnv("NODE_ENV", env);
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("HASH_PEPPER", LOCAL_TEST_PEPPER);
      expect(() => getHashPepper()).toThrow(/public local test pepper/);
    }
  });

  it("accepts it when VERCEL is not set (local, CI, e2e)", () => {
    vi.stubEnv("VERCEL", "");
    for (const env of ["test", "production"]) {
      vi.stubEnv("NODE_ENV", env);
      vi.stubEnv("HASH_PEPPER", LOCAL_TEST_PEPPER);
      expect(getHashPepper()).toBe(LOCAL_TEST_PEPPER);
    }
  });

  it("still accepts a real pepper on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HASH_PEPPER", "r".repeat(40));
    expect(getHashPepper()).toBe("r".repeat(40));
  });
});

describe("T-112 scripts/seed.ts --hosted (process level)", () => {
  it("refuses the public pepper before any network call", () => {
    const r = spawnSync(
      process.execPath,
      ["--no-warnings", "scripts/seed.ts", "--hosted"],
      {
        env: {
          PATH: process.env.PATH ?? "",
          NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
          SUPABASE_SECRET_KEY: "fake-key",
          SEED_DEMO_CHEF_PASSWORD: "tester-chef-pw-123456",
          SEED_DEMO_CUSTOMER_PASSWORD: "tester-customer-pw-123456",
          HASH_PEPPER: ` ${LOCAL_TEST_PEPPER} `,
        } as unknown as NodeJS.ProcessEnv,
        encoding: "utf8",
        timeout: 20000,
      },
    );
    const out = `${r.stdout}${r.stderr}`;
    expect(r.status).toBe(1);
    expect(out).toMatch(/public local test pepper/);
    expect(out).not.toContain(LOCAL_TEST_PEPPER);
    expect(out).not.toMatch(/seeding HOSTED|fetch failed/);
  });
});
