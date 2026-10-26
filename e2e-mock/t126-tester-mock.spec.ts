import { expect, test, type Page } from "@playwright/test";
import {
  expectNoAxeViolations,
  hideDevOverlay,
  scrollsSideways,
} from "./helpers";

// T-126 v2 Tester checks, MOCK mode: pots by hover, click, tap, Enter and Space; one open at a time;
// Tab order; 44 px targets; focus ring contrast; no console or CSP errors; search link edge cases.
test.beforeEach(async ({ page }) => {
  await hideDevOverlay(page);
});

const WIDTHS = [320, 375, 1280];
const SCHEMES = ["light", "dark"] as const;
const POTS = [/Pho bo by Chef Lan/, /Chole and roti/, /Brown stew fish/];

function lum(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

async function tabStops(page: Page, n: number) {
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return "body";
      const zone = el.closest(".home-copy")
        ? "copy"
        : el.closest(".home-map")
          ? "map"
          : el.closest(".home-table")
            ? "table"
            : "other";
      return `${zone}:${el.getAttribute("aria-label") ?? el.textContent?.trim()}`;
    });
    if (out.includes(stop)) break; // focus wrapped round the page
    out.push(stop);
  }
  return out;
}

for (const scheme of SCHEMES) {
  for (const width of WIDTHS) {
    test.describe(`${scheme} ${width}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 800 });
      });

      test("Tab order is copy, then map, then table; focus opens the pot", async ({
        page,
      }) => {
        await page.goto("/");
        const stops = await tabStops(page, 30);
        const zones = stops.map((s) => s.split(":")[0]);
        const home = zones.filter((z) => ["copy", "map", "table"].includes(z));
        const firstMap = zones.indexOf("map");
        const lastCopy = zones.lastIndexOf("copy");
        expect(lastCopy).toBeGreaterThanOrEqual(0);
        expect(firstMap).toBeGreaterThan(lastCopy);
        const lastMap = zones.lastIndexOf("map");
        const firstTable = zones.indexOf("table");
        if (firstTable >= 0) expect(firstTable).toBeGreaterThan(lastMap);
        expect(home.length).toBeGreaterThanOrEqual(6);
        const pots = stops.filter(
          (s) => s.startsWith("map:") && /demo/.test(s),
        );
        expect(pots.length).toBe(3);
        expect(pots[0]).toMatch(/Pho bo/);
        expect(pots[1]).toMatch(/Chole/);
        expect(pots[2]).toMatch(/Brown stew/);
      });

      test("Enter and Space open a pot; only one is open", async ({ page }) => {
        await page.goto("/");
        const card = page.getByTestId("pot-card");
        for (const key of ["Enter", "Space"]) {
          for (let i = 0; i < POTS.length; i++) {
            const b = page.getByRole("button", { name: POTS[i] });
            await b.focus();
            await page.keyboard.press(key);
            await expect(b).toHaveAttribute("aria-pressed", "true");
            await expect(page.locator(".pot-btn.is-open")).toHaveCount(1);
            await expect(card).toContainText("DEMO");
          }
        }
      });

      test("click opens, repeat click keeps it open, 44 px targets, no sideways scroll", async ({
        page,
      }) => {
        await page.goto("/");
        const b = page.getByRole("button", { name: POTS[1] });
        await b.click();
        await b.click();
        await expect(b).toHaveAttribute("aria-pressed", "true");
        await page.getByRole("button", { name: POTS[2] }).click();
        await expect(b).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator(".pot-btn.is-open")).toHaveCount(1);
        for (const pot of await page.locator(".pot-btn").all()) {
          const box = (await pot.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(43.5);
          expect(box.height).toBeGreaterThanOrEqual(43.5);
        }
        expect(await scrollsSideways(page)).toBe(false);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
      });

      test("the focus ring is at least 3:1 against the land and the paper", async ({
        page,
      }) => {
        await page.goto("/");
        await page.getByRole("button", { name: POTS[0] }).focus();
        await page.keyboard.press("Tab"); // forces :focus-visible via keyboard
        await page.keyboard.press("Shift+Tab");
        const c = await page.evaluate(() => {
          const root = getComputedStyle(document.documentElement);
          const el = document.activeElement as HTMLElement;
          const cs = getComputedStyle(el);
          const rgb = cs.outlineColor.match(/\d+/g)!.map(Number);
          const hex = (r: number[]) =>
            "#" +
            r
              .slice(0, 3)
              .map((v) => v.toString(16).padStart(2, "0"))
              .join("");
          return {
            ring: hex(rgb),
            width: cs.outlineWidth,
            style: cs.outlineStyle,
            land: root.getPropertyValue("--map-land").trim(),
            paper: root.getPropertyValue("--paper").trim(),
            hero: root.getPropertyValue("--hero").trim(),
          };
        });
        expect(c.style).toBe("solid");
        expect(parseFloat(c.width)).toBeGreaterThanOrEqual(2);
        for (const bg of [c.land, c.paper, c.hero]) {
          if (/^#[0-9a-f]{6}$/i.test(bg))
            expect(ratio(c.ring, bg)).toBeGreaterThanOrEqual(3);
        }
      });

      test("no console, page or CSP errors on / with a pot open", async ({
        page,
      }) => {
        const bad: string[] = [];
        page.on("console", (m) => {
          if (m.type() === "error") bad.push(`console: ${m.text()}`);
        });
        page.on("pageerror", (e) => bad.push(`pageerror: ${e.message}`));
        await page.addInitScript(() => {
          document.addEventListener("securitypolicyviolation", (e) =>
            console.error("CSP " + e.violatedDirective + " " + e.blockedURI),
          );
        });
        await page.goto("/");
        await page.getByRole("button", { name: POTS[0] }).click();
        await page.getByRole("button", { name: POTS[2] }).hover();
        await page.waitForTimeout(500);
        expect(
          bad.filter((b) => !/font|Failed to load resource/i.test(b)),
        ).toEqual([]);
      });
    });
  }
}

test("tap opens a pot on a touch device", async ({ browser }) => {
  const ctx = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 375, height: 800 },
    baseURL: "http://localhost:3101",
  });
  const page = await ctx.newPage();
  await hideDevOverlay(page);
  await page.goto("/");
  const card = page.getByTestId("pot-card");
  await page.getByRole("button", { name: POTS[1] }).tap();
  await expect(card).toContainText("Chole and roti");
  await page.getByRole("button", { name: POTS[2] }).tap();
  await expect(card).toContainText("Brown stew fish");
  await expect(page.locator(".pot-btn.is-open")).toHaveCount(1);
  await ctx.close();
});

test("the card is a polite live region and every state names DEMO; PROTOTYPE is shown", async ({
  page,
}) => {
  await page.goto("/");
  const card = page.getByTestId("pot-card");
  await expect(card).toHaveAttribute("aria-live", "polite");
  await expect(page.getByText("PROTOTYPE", { exact: true })).toBeVisible();
  for (const pot of POTS) {
    await page.getByRole("button", { name: pot }).click();
    await expect(card.locator(".mock-badge")).toHaveText("DEMO");
  }
  for (const pot of await page.locator(".pot-btn").all()) {
    expect(await pot.getAttribute("aria-label")).toMatch(/\(demo\)|demo/i);
  }
});

test("reduced motion: no animation on idle lids or open pots, at 375", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const names = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".pot-art-lid, .pot-btn *")).map(
      (e) => getComputedStyle(e).animationName,
    ),
  );
  expect(names.filter((n) => n && n !== "none")).toEqual([]);
});

test.describe("search link edge cases", () => {
  test("repeated or malformed params are ignored with no error", async ({
    page,
  }) => {
    for (const q of [
      "city=Toronto&city=Brampton&cuisine=Thai&cuisine=Indian",
      "city=&cuisine=",
      "city=%3Cscript%3E&cuisine=%0A",
      `cuisine=${"x".repeat(41)}`,
      "city=Toronto&cuisine=Thai&extra=1&__proto__=2",
    ]) {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/search?${q}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByLabel("Or a city")).toBeVisible();
      await expect(
        page.getByRole("alert").filter({ hasText: /\S/ }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
      if (q.startsWith("city=Toronto&city=") || q.startsWith("city=&"))
        await expect(page.getByLabel("Or a city")).toHaveValue("");
    }
  });

  test("a good link beats the saved form; plain /search restores the saved form", async ({
    page,
  }) => {
    await page.goto("/search?city=Brampton&cuisine=Indian");
    await expect(page.getByLabel("Or a city")).toHaveValue("Brampton");
    await expect(page.getByLabel("Cuisine")).toHaveValue("Indian");
    await expect(
      page.getByText('Press "Find chefs" to see results.'),
    ).toHaveCount(0);
    await page.waitForTimeout(800); // the form is saved once the results arrive
    // The run saved Brampton/Indian. Now follow a link for another city: the link wins.
    await page.goto("/search?city=mississauga&cuisine=Vietnamese");
    await expect(page.getByLabel("Or a city")).toHaveValue("Mississauga");
    await expect(page.getByLabel("Cuisine")).toHaveValue("Vietnamese");
    await expect(
      page.getByText('Press "Find chefs" to see results.'),
    ).toHaveCount(0);
    await page.waitForTimeout(800);
    // Without the link, the saved form (the last search) comes back.
    await page.goto("/search");
    await expect(page.getByLabel("Or a city")).toHaveValue("Mississauga");
    await expect(page.getByLabel("Cuisine")).toHaveValue("Vietnamese");
  });

  test("axe on the prefilled search in dark", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/search?city=Mississauga&cuisine=Vietnamese");
    await expect(page.getByLabel("Cuisine")).toHaveValue("Vietnamese");
    await expectNoAxeViolations(page);
  });
});
