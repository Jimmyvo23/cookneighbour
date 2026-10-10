// Tester (T-041 round 2): isSafeStoragePath and the photo URL builders against encoded and odd paths.
import { describe, expect, it } from "vitest";
import { dishPhotoUrl, isSafeStoragePath } from "@/lib/chef/dishes";
import { profilePhotoUrl } from "@/lib/search/search";

const BASE = "https://example-project.supabase.co";
const ID = "00000000-0000-4000-8000-000000001001";

describe("isSafeStoragePath (tester)", () => {
  it.each([
    "",
    "/",
    "/abs/x.png",
    "..",
    ".",
    "../x.png",
    "a/../x.png",
    "a/./x.png",
    "a//x.png",
    "a/",
    "a/..",
    "a\\..\\x.png",
    "a\\x.png",
    "a/x\u0000.png",
    "a/x\n.png",
    "a/x\u007f.png",
  ])("rejects %j", (p) => {
    expect(isSafeStoragePath(p)).toBe(false);
  });

  it.each([
    `${ID}/photo-abc.png`,
    "a/b/c.png",
    "...",
    "a/.../x",
    ".hidden/x.png",
    "a/x..png",
    "with space/x y.png",
    "café/写真.png",
    "a/%2e%2e/x.png",
    "a/%2F/x.png",
  ])("accepts %j and keeps it inside the bucket once encoded", (p) => {
    expect(isSafeStoragePath(p)).toBe(true);
    for (const url of [profilePhotoUrl(p, BASE), dishPhotoUrl(p, BASE)]) {
      const u = new URL(url!);
      expect(u.origin).toBe(BASE);
      expect(u.pathname).toMatch(
        /^\/storage\/v1\/object\/public\/(profile|dish)-photos\/[^/]/,
      );
      expect(u.search).toBe("");
      expect(u.hash).toBe("");
      expect(u.pathname.split("/")).not.toContain("..");
    }
  });

  it("percent-encoded and double-encoded dots are literal after encoding (never a dot segment)", () => {
    for (const p of ["%2e%2e/x", "a/%2e%2e", "%252e%252e/x", "a/%2E%2E/x"]) {
      const u = new URL(profilePhotoUrl(p, BASE)!);
      expect(u.pathname).toContain("%25"); // the % itself is encoded
      expect(
        u.pathname.startsWith("/storage/v1/object/public/profile-photos/"),
      ).toBe(true);
    }
  });

  it("unicode dot look-alikes are encoded, not treated as dots", () => {
    for (const p of ["．．/x", "a/․․/x", "‥/x"]) {
      const u = new URL(profilePhotoUrl(p, BASE)!);
      expect(
        u.pathname.startsWith("/storage/v1/object/public/profile-photos/"),
      ).toBe(true);
      expect(u.pathname).toContain("%E");
    }
  });

  it("returns null for unsafe paths and for a missing base", () => {
    expect(profilePhotoUrl("../x", BASE)).toBeNull();
    expect(dishPhotoUrl("a/../x", BASE)).toBeNull();
    expect(profilePhotoUrl(`${ID}/p.png`, undefined)).toBeNull();
    expect(dishPhotoUrl(null, BASE)).toBeNull();
  });
});
