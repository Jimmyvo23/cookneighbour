import { describe, expect, it } from "vitest";
import { getPublicSupabaseEnv, getServiceSupabaseEnv } from "./env";

describe("supabase env helpers", () => {
  it("returns public settings when set", () => {
    expect(
      getPublicSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://x.example",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "pub",
      }),
    ).toEqual({ url: "https://x.example", publishableKey: "pub" });
  });

  it("names the missing variable", () => {
    expect(() =>
      getPublicSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://x.example" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it("treats blank values as missing", () => {
    expect(() =>
      getServiceSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://x.example",
        SUPABASE_SERVICE_ROLE_KEY: "  ",
      }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("never includes a value in the error", () => {
    try {
      getServiceSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://secret-url.example",
      });
    } catch (e) {
      expect(String(e)).not.toContain("secret-url");
    }
  });
});
