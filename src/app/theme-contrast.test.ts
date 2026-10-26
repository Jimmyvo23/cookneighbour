import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function block(startMarker: string): string {
  const start = css.indexOf(startMarker);
  if (start < 0) throw new Error(`missing ${startMarker}`);
  const open = css.indexOf("{", css.indexOf(":root", start));
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error("unclosed block");
}

function tokens(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

const light = tokens(block(":root"));
const dark = {
  ...light,
  ...tokens(block("@media (prefers-color-scheme: dark)")),
};

function lum(hex: string): number {
  const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = n.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ["ink", "paper"],
  ["ink", "surface"],
  ["muted", "paper"],
  ["muted", "surface"],
  ["link", "paper"],
  ["on-primary", "primary"],
  ["on-primary", "primary-hover"],
  ["goldtext", "paper"],
  ["herb", "paper"],
  ["hero-ink", "hero"],
  ["hero-ink-soft", "hero"],
  ["mock-text", "mock-bg"],
];

function check(
  map: Record<string, string>,
  pairs: [string, string][],
  min: number,
) {
  for (const [fg, bg] of pairs) {
    expect(map[fg], `${fg} missing`).toBeTruthy();
    expect(map[bg], `${bg} missing`).toBeTruthy();
    expect(ratio(map[fg], map[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(
      min,
    );
  }
}

describe("clay-pot theme contrast", () => {
  it("light text pairs meet 4.5", () => check(light, TEXT_PAIRS, 4.5));
  it("dark text pairs meet 4.5", () => check(dark, TEXT_PAIRS, 4.5));
  it("focus meets 3 on paper and hero", () => {
    check(
      light,
      [
        ["focus", "paper"],
        ["focus", "hero"],
      ],
      3,
    );
    check(
      dark,
      [
        ["focus", "paper"],
        ["focus", "hero"],
      ],
      3,
    );
  });
  it("brand values are clay", () => {
    expect(light.primary).toBe("#a5482a");
    expect(light.paper).toBe("#faf3ea");
    expect(light.gold).toBe("#c98a3a");
  });
  it("no patterns", () => {
    expect(css).not.toContain("--gingham");
    expect(css).not.toContain("--cloth");
    expect(css).not.toContain("repeating-linear-gradient");
  });
});
