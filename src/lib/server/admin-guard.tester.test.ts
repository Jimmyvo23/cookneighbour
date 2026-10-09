// Tester (T-036): static guards so the admin area cannot silently lose its server-side checks.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
function walk(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

describe("admin pages and routes keep their server guard", () => {
  it("the admin layout calls requireAdminPage before it renders any child", () => {
    const src = read("app/admin/layout.tsx");
    expect(src).toMatch(/await requireAdminPage\(\)/);
    const guarded = src.slice(src.indexOf("async function Guarded"));
    expect(guarded.indexOf("await requireAdminPage()")).toBeLessThan(
      guarded.indexOf("{children}"),
    );
  });

  it("the chef layout comment no longer promises more than the layout does", () => {
    const src = read("app/chef/layout.tsx").replace(/\n\/\/ ?/g, " ");
    expect(src).not.toMatch(/pages under \/chef\s+therefore need no guard/i);
    expect(src).toMatch(/does not run again on in-app navigation/);
    expect(src).toMatch(/must call\s+requireChefPage\(\) itself/);
  });

  it("no admin page or admin component reads private data on the server or renders raw HTML", () => {
    const files = [...walk("app/admin"), ...walk("components/admin")].filter(
      (f) => /\.tsx?$/.test(f) && !/\.test\./.test(f),
    );
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = read(f).replace(/^\s*\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML/);
      expect(src, f).not.toMatch(/@\/lib\/supabase\/(admin|server)/);
      expect(src, f).not.toMatch(/innerHTML\s*=/);
    }
  });

  it("every /api/admin route handler checks the admin role first", () => {
    const routes = walk("app/api/admin").filter((f) => f.endsWith("route.ts"));
    expect(routes.length).toBe(6);
    for (const f of routes) {
      const src = read(f);
      const handlers = src.match(
        /export (?:async )?function (GET|POST|PATCH)/g,
      );
      expect(handlers?.length, f).toBeGreaterThan(0);
      // each handler body calls requireAdmin() before anything else touches data
      for (const body of src.split(/export (?:async )?function /).slice(1)) {
        const first = body.indexOf("requireAdmin(");
        expect(first, f).toBeGreaterThan(-1);
        for (const bad of ["readJsonObject(", "json(", "parse"]) {
          const at = body.indexOf(bad);
          if (at !== -1 && bad !== "json(")
            expect(at, `${f}: ${bad} before requireAdmin`).toBeGreaterThan(
              first,
            );
        }
      }
    }
  });
});
