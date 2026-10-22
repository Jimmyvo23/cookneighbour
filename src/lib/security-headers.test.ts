import { describe, expect, it } from "vitest";
import { buildCsp, securityHeaders } from "./security-headers";

const SUPA = "https://abc.supabase.co";

describe("buildCsp", () => {
  it("locks down framing, base, forms and objects", () => {
    const csp = buildCsp({ supabaseUrl: SUPA, dev: false });
    for (const d of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ])
      expect(csp).toContain(d);
  });
  it("allows Supabase over https and wss, and OSM tiles for images", () => {
    const csp = buildCsp({ supabaseUrl: SUPA, dev: false });
    expect(csp).toMatch(
      /connect-src [^;]*'self'[^;]*https:\/\/abc\.supabase\.co/,
    );
    expect(csp).toMatch(/connect-src [^;]*wss:\/\/abc\.supabase\.co/);
    expect(csp).toMatch(
      /img-src [^;]*data: blob:[^;]*https:\/\/abc\.supabase\.co/,
    );
    expect(csp).toMatch(/img-src [^;]*https:\/\/tile\.openstreetmap\.org/);
  });
  it("never allows unsafe-eval or local hosts in production", () => {
    const csp = buildCsp({ supabaseUrl: SUPA, dev: false });
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("127.0.0.1");
  });
  it("allows eval (React refresh) and the local stack in dev", () => {
    const csp = buildCsp({ supabaseUrl: "http://127.0.0.1:54321", dev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws://127.0.0.1:54321");
    expect(csp).toContain("http://127.0.0.1:54321");
  });
  it("works with no Supabase URL (mock mode) and ignores a malformed one", () => {
    expect(buildCsp({ supabaseUrl: "", dev: false })).toContain(
      "connect-src 'self'",
    );
    expect(buildCsp({ supabaseUrl: "not a url", dev: false })).toContain(
      "connect-src 'self'",
    );
  });
});

describe("securityHeaders", () => {
  it("returns the fixed headers", () => {
    const h = Object.fromEntries(
      securityHeaders({ supabaseUrl: SUPA, dev: false }).map((x) => [
        x.key,
        x.value,
      ]),
    );
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });
});
