// T-105 Tester: loads the real next.config.ts headers() under different NODE_ENV values, the
// way the T-100 Reviewer did by hand, so the wiring (not only cspOptionsFromEnv) fails closed.
import { afterEach, describe, expect, it, vi } from "vitest";

async function cspFor(nodeEnv: string | undefined, supa?: string) {
  vi.resetModules();
  vi.unstubAllEnvs();
  if (nodeEnv === undefined)
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
  else vi.stubEnv("NODE_ENV", nodeEnv);
  if (supa) vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supa);
  else vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  const cfg = (await import("../../next.config")).default;
  const rules = await cfg.headers!();
  return rules[0].headers.find((h) => h.key === "Content-Security-Policy")!
    .value;
}

describe("next.config.ts CSP wiring", () => {
  const saved = process.env.NODE_ENV;
  afterEach(() => {
    vi.unstubAllEnvs();
    (process.env as Record<string, string | undefined>).NODE_ENV = saved;
  });

  it.each(["production", "test", "", "Development", undefined])(
    "NODE_ENV=%j gets the production policy",
    async (v) => {
      const csp = await cspFor(v, "https://abc.supabase.co");
      expect(csp).not.toContain("unsafe-eval");
      expect(csp).not.toContain("127.0.0.1");
      expect(csp).toContain(
        "connect-src 'self' https://abc.supabase.co wss://abc.supabase.co",
      );
      expect(csp).toContain("frame-ancestors 'none'");
    },
  );

  it("development adds unsafe-eval and the local stack", async () => {
    const csp = await cspFor("development");
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws://127.0.0.1:54321");
  });

  it("production without the Supabase URL fails closed", async () => {
    const csp = await cspFor("production");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/connect-src[^;]*(supabase|127\.0\.0\.1)/);
  });
});
