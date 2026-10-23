// @vitest-environment node
// T-118: mock mode must never reach a Vercel build (see src/lib/mock-guard.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { isMockEnabled } from "@/lib/api/client";
import {
  mockAllowed,
  mockBlockedFlag,
  mockBuildProblem,
  onVercel,
} from "./mock-guard";

afterEach(() => vi.unstubAllEnvs());

const VERCEL_VARS = [
  { VERCEL: "1" },
  { VERCEL_ENV: "production" },
  { VERCEL_ENV: "preview" },
  { VERCEL_URL: "x.vercel.app" },
  { VERCEL_REGION: "iad1" },
  { NEXT_PUBLIC_VERCEL_ENV: "production" },
  { NEXT_PUBLIC_MOCK_BLOCKED: "1" },
];

describe("mockAllowed", () => {
  it("is on for exactly 1 away from Vercel", () => {
    expect(mockAllowed({ NEXT_PUBLIC_API_MOCK: "1" })).toBe(true);
    for (const v of [undefined, "", "0", "true", " 1"])
      expect(mockAllowed({ NEXT_PUBLIC_API_MOCK: v })).toBe(false);
  });
  it.each(VERCEL_VARS)("is off with mock=1 and %j", (extra) => {
    expect(mockAllowed({ NEXT_PUBLIC_API_MOCK: "1", ...extra })).toBe(false);
    expect(onVercel(extra)).toBe(true);
  });
  it("ignores blank Vercel variables", () => {
    expect(onVercel({ VERCEL: "", VERCEL_ENV: "  " })).toBe(false);
  });
});

describe("isMockEnabled (used by the page guards and every client reader)", () => {
  it("is true locally with the flag", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "1");
    expect(isMockEnabled()).toBe(true);
  });
  it.each([
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_URL",
    "NEXT_PUBLIC_VERCEL_ENV",
    "NEXT_PUBLIC_MOCK_BLOCKED",
  ])("is false on Vercel (%s set)", (name) => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "1");
    vi.stubEnv(name, name === "VERCEL" ? "1" : "production");
    expect(isMockEnabled()).toBe(false);
  });
});

describe("mockBuildProblem", () => {
  it("refuses any mock value in a Vercel build", () => {
    for (const extra of VERCEL_VARS)
      for (const v of ["1", "0", "true"]) {
        const msg = mockBuildProblem(
          { NEXT_PUBLIC_API_MOCK: v, ...extra },
          { production: true },
        );
        expect(msg).toMatch(/Vercel build/);
        expect(msg).toMatch(/NEXT_PUBLIC_API_MOCK/);
      }
  });
  it("allows a Vercel build with the flag unset or blank", () => {
    for (const v of [undefined, ""])
      expect(
        mockBuildProblem(
          { VERCEL: "1", NEXT_PUBLIC_API_MOCK: v },
          { production: true },
        ),
      ).toBeNull();
  });
  it("refuses a production build with mock=1 unless ALLOW_MOCK_BUILD=1", () => {
    expect(
      mockBuildProblem({ NEXT_PUBLIC_API_MOCK: "1" }, { production: true }),
    ).toMatch(/ALLOW_MOCK_BUILD/);
    expect(
      mockBuildProblem(
        { NEXT_PUBLIC_API_MOCK: "1", ALLOW_MOCK_BUILD: "1" },
        { production: true },
      ),
    ).toBeNull();
  });
  it("leaves dev (not a production build) and mock-off builds alone", () => {
    expect(
      mockBuildProblem({ NEXT_PUBLIC_API_MOCK: "1" }, { production: false }),
    ).toBeNull();
    expect(mockBuildProblem({}, { production: true })).toBeNull();
  });
  it("ALLOW_MOCK_BUILD does not override Vercel", () => {
    expect(
      mockBuildProblem(
        { NEXT_PUBLIC_API_MOCK: "1", ALLOW_MOCK_BUILD: "1", VERCEL: "1" },
        { production: true },
      ),
    ).not.toBeNull();
  });
});

describe("mockBlockedFlag", () => {
  it("is 1 on Vercel and empty elsewhere", () => {
    expect(mockBlockedFlag({ VERCEL: "1" })).toBe("1");
    expect(mockBlockedFlag({})).toBe("");
  });
});

describe("next.config.ts wiring", () => {
  // T-120: the config is a function of the Next phase, not of NODE_ENV.
  const BUILD = "phase-production-build";
  const SERVER = "phase-production-server";
  const DEV = "phase-development-server";
  async function load(env: Record<string, string>, phase = BUILD) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const fn = (await import("../../next.config")).default;
    return (fn as unknown as (p: string) => Promise<import("next").NextConfig>)(
      phase,
    );
  }
  const LOCAL = { VERCEL: "", ALLOW_MOCK_BUILD: "" };
  it("throws when Vercel and the mock flag are both set, in every phase", async () => {
    for (const phase of [BUILD, SERVER, DEV, "phase-test"])
      await expect(
        load({ VERCEL: "1", NEXT_PUBLIC_API_MOCK: "1" }, phase),
      ).rejects.toThrow(/NEXT_PUBLIC_API_MOCK/);
    await expect(
      load({ VERCEL: "1", NEXT_PUBLIC_API_MOCK: "0", ALLOW_MOCK_BUILD: "1" }),
    ).rejects.toThrow(/Vercel build/);
  });
  it.each(["production", "development", "test"])(
    "refuses a production build or `next start` with mock=1 and no opt-in (NODE_ENV=%s)",
    async (nodeEnv) => {
      for (const phase of [BUILD, SERVER])
        await expect(
          load(
            { NODE_ENV: nodeEnv, NEXT_PUBLIC_API_MOCK: "1", ...LOCAL },
            phase,
          ),
        ).rejects.toThrow(/ALLOW_MOCK_BUILD/);
    },
  );
  it("allows a production build with mock=1 and ALLOW_MOCK_BUILD=1", async () => {
    for (const nodeEnv of ["production", "development"])
      await expect(
        load(
          {
            NODE_ENV: nodeEnv,
            NEXT_PUBLIC_API_MOCK: "1",
            VERCEL: "",
            ALLOW_MOCK_BUILD: "1",
          },
          BUILD,
        ),
      ).resolves.toBeDefined();
  });
  it("leaves dev and test phases alone, even with NODE_ENV=production", async () => {
    for (const phase of [DEV, "phase-test", "phase-export"])
      for (const nodeEnv of ["production", "development"])
        await expect(
          load(
            { NODE_ENV: nodeEnv, NEXT_PUBLIC_API_MOCK: "1", ...LOCAL },
            phase,
          ),
        ).resolves.toBeDefined();
  });
  it("loads for a mock-off production build and for Vercel with the flag blank", async () => {
    await expect(
      load({ NODE_ENV: "production", NEXT_PUBLIC_API_MOCK: "", ...LOCAL }),
    ).resolves.toBeDefined();
    const cfg = await load({ VERCEL: "1", NEXT_PUBLIC_API_MOCK: "" });
    expect(cfg.env?.NEXT_PUBLIC_MOCK_BLOCKED).toBe("1");
  });
});
