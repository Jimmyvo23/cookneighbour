import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// T-126, MOCK mode: the 3D pot on the home page. Headless Chromium needs the SwiftShader flags to
// have WebGL. The test hooks used here exist only outside a production build: canvas data-t,
// data-plate-box / data-lid-box / data-spoon-box, ?t=<seconds> and the "pot:seek" event.
test.use({
  launchOptions: {
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  },
});

const SIZES = [
  { name: "phone 375", width: 375, height: 812 },
  { name: "desktop 1280", width: 1280, height: 800 },
];

const H1 = "A home cook from your culture, in your kitchen or theirs.";

/** Collect console errors, page errors and CSP violations for the whole page life. */
async function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp ??= [];
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI}`,
      );
    });
  });
  return errors;
}
const cspViolations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);

const readT = (page: Page) =>
  page
    .getByTestId("pot-canvas")
    .evaluate((c) => (c as HTMLCanvasElement).dataset.t ?? "");

async function waitPlaying(page: Page) {
  await expect(page.locator(".hero")).toHaveAttribute(
    "data-pot-state",
    "playing",
    {
      timeout: 45_000,
    },
  );
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("home copy: promise headline, prototype badge, cook link, find button", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(H1);
      await expect(page).toHaveTitle("CookNeighbour — prototype");
      await expect(page.locator(".hero").getByTestId("mock-badge")).toHaveText(
        /Prototype · nothing is real or charged/,
      );
      const cook = page.getByRole("link", { name: /I'm a home cook/ });
      await expect(cook).toHaveAttribute("href", "/signup");
      await expect(
        page.getByRole("link", { name: "Find a home cook" }),
      ).toHaveAttribute("href", "/search");
    });

    test("no WebGL: the drawn pot stays, no canvas, no button, no errors", async ({
      page,
    }) => {
      const errors = await watchErrors(page);
      await page.addInitScript(() => {
        const orig = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          this: HTMLCanvasElement,
          type: string,
          ...rest: unknown[]
        ) {
          if (/webgl/.test(type)) return null;
          return (orig as (...a: unknown[]) => unknown).call(
            this,
            type,
            ...rest,
          );
        } as typeof orig;
      });
      await page.goto("/");
      await expect(page.locator(".hero")).toHaveAttribute(
        "data-pot-state",
        "fallback",
        {
          timeout: 20_000,
        },
      );
      await expect(page.locator(".hero-art")).toBeVisible();
      await expect(page.getByTestId("pot-canvas")).toHaveCount(0);
      await expect(page.getByTestId("pot-toggle")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(H1);
      expect(errors).toEqual([]);
    });

    test("no WebGL: also a failed script load keeps the drawn pot", async ({
      page,
    }) => {
      // Block the lazy chunk (the scene) so it cannot load.
      await page.route(/PotScene|three/, (r) => r.abort());
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(H1);
      await page.waitForTimeout(3000);
      await expect(page.locator(".hero-art")).toBeVisible();
      await expect(page.getByTestId("pot-toggle")).toHaveCount(0);
    });

    test("the 3D pot plays; Pause stops it, by keyboard; Play resumes it", async ({
      page,
    }) => {
      const errors = await watchErrors(page);
      await page.goto("/");
      await waitPlaying(page);
      await expect(page.getByTestId("pot-canvas")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      const toggle = page.getByTestId("pot-toggle");
      await expect(toggle).toHaveText("Pause animation");
      const box = await toggle.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);

      // It is moving.
      const t1 = await readT(page);
      await page.waitForTimeout(700);
      expect(parseFloat(await readT(page))).toBeGreaterThan(parseFloat(t1));

      // Keyboard: Tab to the button, press Enter. It is the last stop after the hero links.
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("Tab");
        if (await toggle.evaluate((el) => el === document.activeElement)) break;
      }
      await expect(toggle).toBeFocused();
      // Visible focus ring.
      const ring = await toggle.evaluate((el) => {
        const s = getComputedStyle(el);
        return { w: parseFloat(s.outlineWidth), style: s.outlineStyle };
      });
      expect(ring.w).toBeGreaterThanOrEqual(2);
      expect(ring.style).not.toBe("none");
      await page.keyboard.press("Enter");
      await expect(page.locator(".hero")).toHaveAttribute(
        "data-pot-state",
        "paused",
      );
      await expect(toggle).toHaveText("Play animation");
      const frozen = await readT(page);
      await page.waitForTimeout(800);
      expect(await readT(page)).toBe(frozen);

      await page.keyboard.press("Enter");
      await expect(page.locator(".hero")).toHaveAttribute(
        "data-pot-state",
        "playing",
      );
      await expect(toggle).toHaveText("Pause animation");
      await page.waitForTimeout(700);
      expect(parseFloat(await readT(page))).toBeGreaterThan(parseFloat(frozen));
      expect(errors).toEqual([]);
      expect(await cspViolations(page)).toEqual([]);
    });

    test("nothing moves when the canvas swaps in (no layout shift)", async ({
      page,
    }) => {
      await page.goto("/");
      const rects = () =>
        page.evaluate(() => {
          const r = (s: string) => {
            const b = document.querySelector(s)!.getBoundingClientRect();
            const top = document
              .querySelector(".hero")!
              .getBoundingClientRect().y;
            return [b.x, b.y - top, b.width, b.height].map(Math.round);
          };
          return { hero: r(".hero"), h1: r("h1"), cell: r(".hero-art-cell") };
        });
      const before = await rects();
      await waitPlaying(page);
      expect(await rects()).toEqual(before);
    });

    test("reduced motion: one still frame, no loop, no button", async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await expect(page.locator(".hero")).toHaveAttribute(
        "data-pot-state",
        "still",
        {
          timeout: 45_000,
        },
      );
      await expect(page.getByTestId("pot-toggle")).toHaveCount(0);
      const t = await readT(page);
      await page.mouse.move(size.width / 2, 300);
      await page.waitForTimeout(900);
      expect(await readT(page)).toBe(t);
    });

    test("a frozen test frame has no loop and no button", async ({ page }) => {
      await page.goto("/?t=0");
      await expect(page.locator(".hero")).toHaveAttribute(
        "data-pot-state",
        "frozen",
        {
          timeout: 45_000,
        },
      );
      // Frozen test frames have no loop and no button.
      await expect(page.getByTestId("pot-toggle")).toHaveCount(0);
    });

    test("no horizontal scroll, and axe finds nothing while the pot plays", async ({
      page,
    }) => {
      await page.goto("/");
      await waitPlaying(page);
      const over = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(over).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`),
      ).toEqual([]);
    });

    test("lid, plate and spoon stay inside the screen and off the buttons, all through a cycle", async ({
      page,
    }) => {
      await page.goto("/?t=0");
      await expect(page.locator(".hero")).toHaveAttribute(
        "data-pot-state",
        "frozen",
        {
          timeout: 45_000,
        },
      );
      const canvas = page.getByTestId("pot-canvas");
      const hero = await page.locator(".hero").boundingBox();
      const rectOf = async (name: string | RegExp) => {
        const b = (await page.getByRole("link", { name }).boundingBox())!;
        return [
          b.x - hero!.x,
          b.y - hero!.y,
          b.x - hero!.x + b.width,
          b.y - hero!.y + b.height,
        ];
      };
      const find = await rectOf("Find a home cook");
      const cook = await rectOf(/I'm a home cook/);
      const parse = (s: string) => s.split(",").map(Number);
      const hit = (a: number[], b: number[]) =>
        a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
      for (const t of [
        0, 1.3, 1.9, 2.2, 3, 4.5, 6.4, 6.8, 7.4, 8.3, 8.5, 9.5,
      ]) {
        await canvas.evaluate(
          (c, to) =>
            c.dispatchEvent(new CustomEvent("pot:seek", { detail: to })),
          t,
        );
        const d = await canvas.evaluate((c) => ({
          ...(c as HTMLCanvasElement).dataset,
        }));
        for (const key of ["plateBox", "lidBox", "spoonBox"] as const) {
          const b = parse(d[key]!);
          expect(b[0], `${key} left at t=${t}`).toBeGreaterThanOrEqual(0);
          expect(b[2], `${key} right at t=${t}`).toBeLessThanOrEqual(
            hero!.width,
          );
          expect(b[1], `${key} top at t=${t}`).toBeGreaterThanOrEqual(0);
        }
        const spoon = parse(d.spoonBox!);
        expect(hit(spoon, find), `spoon over the Find button at t=${t}`).toBe(
          false,
        );
        expect(hit(spoon, cook), `spoon over the cook link at t=${t}`).toBe(
          false,
        );
      }
    });
  });
}

test("other pages carry no hero canvas and no three.js script", async ({
  page,
}) => {
  const scripts: string[] = [];
  page.on("response", (r) => {
    if (r.request().resourceType() === "script") scripts.push(r.url());
  });
  await page.goto("/search");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("pot-canvas")).toHaveCount(0);
  expect(scripts.filter((u) => /PotScene|three/i.test(u))).toEqual([]);
});
